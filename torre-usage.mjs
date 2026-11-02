#!/usr/bin/env node
// Reporta a Torre de Control el consumo REAL de una sesión de Claude Code,
// leído de su transcript (~/.claude/projects/<proyecto>/<sesión>.jsonl):
//   - agente principal: usage de cada respuesta (deduplicado por message.id);
//   - cada sub-agente: <sesión>/subagents/agent-*.jsonl + su .meta.json;
//   - si existe, la línea `cost-state` con el costo exacto que calculó Claude Code.
// El envío es idempotente (Torre reemplaza el reporte de esa sesión).
//
// Uso:
//   node torre-usage.mjs                      # sesión más reciente del directorio actual
//   node torre-usage.mjs --cwd <dir> --all    # todas las sesiones de ese directorio
//   node torre-usage.mjs --session <id> [--project <id de Torre>]
//   (como hook Stop/SubagentStop/SessionEnd: recibe el payload por stdin)
// Requiere TORRE_API_KEY; TORRE_URL opcional.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const URL_BASE = (process.env.TORRE_URL || 'https://torre-de-control-two.vercel.app').replace(/\/+$/, '');
const KEY = process.env.TORRE_API_KEY;
const PROJECTS = join(homedir(), '.claude', 'projects');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hookMode = !process.stdin.isTTY && args.length === 0;

function lines(file) {
  const out = [];
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      // línea a medio escribir (sesión en curso): se ignora
    }
  }
  return out;
}

const empty = (model) => ({ model, input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, webSearches: 0 });

/** Uso por modelo de un transcript, deduplicando las líneas repetidas de una misma respuesta. */
function usageOf(file) {
  const byModel = new Map();
  const seen = new Set();
  for (const l of lines(file)) {
    const m = l.type === 'assistant' ? l.message : null;
    if (!m?.usage || !m.model || seen.has(m.id)) continue;
    seen.add(m.id);
    const u = m.usage;
    const t = byModel.get(m.model) ?? empty(m.model);
    t.input += u.input_tokens ?? 0;
    t.output += u.output_tokens ?? 0;
    t.cacheRead += u.cache_read_input_tokens ?? 0;
    const cc = u.cache_creation;
    if (cc) {
      t.cacheWrite5m += cc.ephemeral_5m_input_tokens ?? 0;
      t.cacheWrite1h += cc.ephemeral_1h_input_tokens ?? 0;
    } else {
      t.cacheWrite5m += u.cache_creation_input_tokens ?? 0;
    }
    t.webSearches += u.server_tool_use?.web_search_requests ?? 0;
    byModel.set(m.model, t);
  }
  return [...byModel.values()];
}

function costState(file) {
  const cs = lines(file).filter((l) => l.type === 'cost-state').pop();
  if (!cs) return null;
  const models = Object.entries(cs.modelUsage ?? {}).map(([model, u]) => ({
    model,
    input: u.inputTokens ?? 0,
    output: u.outputTokens ?? 0,
    cacheWrite5m: u.cacheCreationEphemeral5mInputTokens ?? 0,
    cacheWrite1h: u.cacheCreationEphemeral1hInputTokens ?? 0,
    cacheRead: u.cacheReadInputTokens ?? 0,
    webSearches: u.webSearchRequests ?? 0,
    costUsd: u.costUSD ?? null,
  }));
  return { totalCostUsd: cs.totalCostUSD ?? null, models };
}

function sum(lists) {
  const t = new Map();
  for (const m of lists.flat()) {
    const x = t.get(m.model) ?? empty(m.model);
    for (const k of ['input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'webSearches']) x[k] += m[k];
    t.set(m.model, x);
  }
  return [...t.values()];
}

function report(transcript) {
  const sid = basename(transcript, '.jsonl');
  const main = usageOf(transcript);
  const subDir = join(dirname(transcript), sid, 'subagents');
  const subagents = [];
  if (existsSync(subDir)) {
    for (const f of readdirSync(subDir).filter((x) => x.endsWith('.jsonl'))) {
      const metaPath = join(subDir, f.replace(/\.jsonl$/, '.meta.json'));
      let meta = {};
      try {
        meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      } catch {
        // sin meta: se reporta igual, sin tipo
      }
      subagents.push({
        agentId: f.replace(/\.jsonl$/, ''),
        agentType: meta.agentType ?? '',
        description: meta.description ?? '',
        models: usageOf(join(subDir, f)),
      });
    }
  }
  const cs = costState(transcript);
  return {
    claudeSessionId: sid,
    totalCostUsd: cs?.totalCostUsd ?? null,
    models: cs?.models.length ? cs.models : sum([main, ...subagents.map((s) => s.models)]),
    main,
    subagents,
  };
}

function cwdOf(file) {
  try {
    const head = readFileSync(file, 'utf8').slice(0, 200_000).split('\n');
    for (const l of head) {
      const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(l);
      if (m) return JSON.parse(`"${m[1]}"`);
    }
  } catch {
    // ilegible: se ignora
  }
  return null;
}

/** Transcripts de sesión (no de sub-agentes) cuyo cwd es `dir`, del más reciente al más viejo. */
function transcriptsFor(dir) {
  const want = resolve(dir).toLowerCase();
  const found = [];
  if (!existsSync(PROJECTS)) return found;
  for (const p of readdirSync(PROJECTS)) {
    const pd = join(PROJECTS, p);
    let entries;
    try {
      entries = readdirSync(pd).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of entries) {
      const file = join(pd, f);
      const cwd = cwdOf(file);
      if (cwd && resolve(cwd).toLowerCase() === want) found.push({ file, mtime: statSync(file).mtimeMs });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).map((x) => x.file);
}

function findSession(id) {
  if (!existsSync(PROJECTS)) return null;
  for (const p of readdirSync(PROJECTS)) {
    const f = join(PROJECTS, p, `${id}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

async function send(rep, cwd, projectId) {
  const res = await fetch(`${URL_BASE}/api/usage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ projectId, cwd, report: rep }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

const tokens = (ms) => ms.reduce((n, m) => n + m.input + m.output + m.cacheWrite5m + m.cacheWrite1h + m.cacheRead, 0);

async function main() {
  if (!KEY) throw new Error('falta TORRE_API_KEY');
  let files = [];
  let cwd = opt('--cwd') ?? process.cwd();
  if (hookMode) {
    let raw = '';
    for await (const c of process.stdin) raw += c;
    const p = JSON.parse(raw || '{}');
    cwd = p.cwd ?? cwd;
    const t = p.transcript_path ?? (p.session_id ? findSession(p.session_id) : null);
    if (t && existsSync(t)) files = [t];
  } else if (opt('--session')) {
    const f = findSession(opt('--session'));
    if (!f) throw new Error(`no encontré el transcript de la sesión ${opt('--session')}`);
    files = [f];
  } else {
    const all = transcriptsFor(cwd);
    files = args.includes('--all') ? all : all.slice(0, 1);
  }
  if (!files.length) throw new Error(`no hay transcripts de Claude Code para ${cwd}`);
  const out = [];
  for (const f of files) {
    const rep = report(f);
    const r = await send(rep, cwd, opt('--project'));
    out.push({
      claudeSessionId: rep.claudeSessionId,
      tracked: r.tracked,
      projectId: r.projectId ?? null,
      tokens: tokens(rep.models),
      mainTokens: tokens(rep.main),
      subagents: rep.subagents.length,
      costUsd: rep.totalCostUsd,
      costSource: rep.totalCostUsd === null ? 'estimado en Torre' : 'claude-code (exacto)',
    });
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  // En modo hook nunca se bloquea el flujo.
  console.error(`torre-usage: ${e.message}`);
  process.exit(hookMode ? 0 : 1);
});
