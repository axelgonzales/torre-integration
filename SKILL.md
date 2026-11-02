---
name: torre-integration
description: |
  Ejecuta CUALQUIER tarea (desarrollo, documentos, investigación, análisis, operaciones) siguiendo
  un Flujo de Trabajo de Torre de Control (web). El trabajo se divide en etapas y actividades, cada
  actividad la ejecuta un sub-agente, y todo se trackea por MCP (servidor `torre`) con tiempo,
  tokens y costo, sumados por actividad, etapa, proyecto y goal.
  Use when: el usuario pide "hacé/registrá esto en Torre", "continuá el requerimiento <id> de
  Torre", "usá el flujo X de Torre", "trackeá esta tarea", "cuánto costó/tardó X", "creá un
  sub-agente en Torre", o el prompt trae un bloque "[Contexto de Torre de Control ...]". También
  para conectar Claude Code a Torre por primera vez ("configurá Torre", "no veo las tools de Torre").
  No usar para editar el grafo del flujo a mano si el usuario no lo pidió: el flujo lo diseña el
  usuario en la web; vos lo ejecutás.
---

# Torre de Control: ejecución trackeada por MCP

Torre de Control es el **plano de control**. Guarda:

- los Flujos de Trabajo (etapas, actividades, sub-agentes, loops, gates de aprobación);
- el estado de cada requerimiento;
- los sub-agentes de la cuenta.

**Vos ejecutás** el trabajo en local y Torre muestra en la web el avance, el tiempo y el costo en
tiempo real. Toda la comunicación va por las tools MCP del servidor `torre` (`mcp__torre__*`).
Nunca uses `curl` ni inventes endpoints.

## Paso 0: verificar (o instalar) la conexión

Esta skill necesita el servidor MCP `torre`. Llamá `whoami`.

**Si la tool `whoami` no existe**, el MCP no está instalado:

1. Verificá que el usuario tenga la variable `TORRE_API_KEY` (`echo $TORRE_API_KEY` o
   `$env:TORRE_API_KEY`). Si no la tiene, pedile su API key (`tdc_...`). Si no tiene una, la crea
   un admin de su organización en la web, en **Cuenta → API keys**. Indicale que la exporte:
   - PowerShell: `setx TORRE_API_KEY "tdc_..."`.
   - bash/zsh: `export TORRE_API_KEY=tdc_...` en `~/.bashrc` o `~/.zshrc`.
2. Registrá el MCP a nivel usuario. Las comillas simples dejan la referencia a la variable y no
   copian el secreto al archivo de configuración. Pedí confirmación antes de ejecutarlo:
   ```
   claude mcp add --transport http --scope user torre https://torre-de-control-two.vercel.app/mcp --header 'Authorization: Bearer ${TORRE_API_KEY}'
   ```
   Si usa una instancia propia, reemplazá la URL por la suya, terminada en `/mcp`.
3. Pedile que reinicie Claude Code (las tools MCP se cargan al iniciar) y que vuelva a pedir la tarea.

**Si `whoami` devuelve 401**: la key es inválida o fue revocada. Volvé al punto 1.

No sigas hasta que `whoami` responda. **Nunca** escribas la key en archivos del repo.

## Paso 1: ubicar o crear el requerimiento

- **Si el usuario dio un id**: llamá `get_project(projectId)`.
- **Si es un pedido nuevo**: elegí el flujo con `list_workflows`.
  - Si el usuario nombró un flujo, usá ese.
  - Si es desarrollo de software, usá `builtin-dev`.
  - Para cualquier otra tarea, usá **`builtin-task`** (Entender → Ejecutar → Verificar).

  Después llamá `create_project` con:
  - `name`: corto.
  - `prompt`: el texto original del usuario, tal cual.
  - `workflowId`.
  - `cwd`: la ruta absoluta del directorio de trabajo.
  - `goal`: solo si la tarea es parte de un proceso grande dividido en varios requerimientos.
    Usá el mismo `goal` en todos, así Torre suma su costo y tiempo.

  Decile al usuario el `id` y que lo puede seguir en la web, en la pestaña **Proyectos**.

## Paso 2: leer el flujo (fuente de verdad)

`get_project_workflow(projectId)` devuelve el grafo ya resuelto:

- **`nodes`**: las etapas. Ordenalas por `x` ascendente: ese es el orden de ejecución.
  - `kind="stage"`: etapa de trabajo.
  - `kind="stop"`: gate de aprobación del usuario.
  - `kind="decision"`: ruteo puro, no se trackea.
- **De cada nodo**, usá estos campos:
  - `instructions`: qué producir y el criterio de salida.
  - `activities[]`: las actividades predefinidas, cada una con su `agent`.
  - `agents[].matched_skill`: el sub-agente o skill de la etapa.
- **`edges`**: las conexiones. Las de `kind="loop"` son reintentos: volvé a la etapa `to`
  como máximo `max_retries` veces y después escalá al usuario.
- **`subagents`**: los sub-agentes de la cuenta que este flujo usa.

No reinventes etapas que no estén en el grafo.

## Paso 3: dividir cada etapa en actividades

Antes de ejecutar una etapa, partila en **actividades**. Cada actividad es una unidad de trabajo
con un resultado verificable, por ejemplo "relevar fuentes", "redactar sección 2" o "revisar cifras".

- **Si el nodo trae `activities[]`**: usá esas, con su `id` y su `agent`.
- **Si no trae**: definí 1 a 6 actividades vos. Dales un `activity` estable en kebab-case
  (`redactar-resumen`) y un `activityName` legible.

Cada actividad tiene su propio costo y tiempo en Torre. Por eso no juntes trabajos distintos en una
sola actividad.

## Paso 4: ejecutar cada actividad con un sub-agente (obligatorio)

Elegí el sub-agente de cada actividad en este orden:

1. El `agent` de la actividad o el `matched_skill` de la etapa.
2. Un sub-agente de la cuenta (`subagents` / `list_subagents`). Si no está en
   `.claude/agents/<name>/AGENT.md`, llamá `get_subagent_file(name)` y escribí `content` en `path`
   tal cual.
3. Un sub-agente del proyecto o un builtin de Claude Code (`Explore`, `general-purpose`, `Plan`...)
   que encaje con la actividad.

**Solo si ninguno es aplicable**, hacé la actividad vos mismo y reportala como `direct_work`. Tiene
que incluir un `reason` concreto, por ejemplo: "no hay sub-agente de redacción legal en la cuenta
ni en el proyecto". El `direct_work` queda mapeado en Torre con agente `main`.

Si una actividad del mismo tipo se repite seguido sin sub-agente, proponé al usuario crear uno con
`save_subagent` y sumarlo al flujo con `add_agent_to_stage`.

## Paso 5: trackear con `track` (única vía)

Todo el avance va por **una sola tool**, `track(projectId, events[])`. Cada evento lleva un
**`id` estable y único** con el formato `<stage>:<activity>:<type>:<n>`, por ejemplo
`execute:redactar-resumen:agent_done:1`. Para un reintento por loop, subí `n`.

| Momento                        | Evento                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| Antes de despachar el sub-agente | `agent_start` con `agent`, `activity`, `activityName` y `skill` si una skill guía la actividad |
| Al terminar el sub-agente      | `agent_done` con `agent`, `activity`, `tokens`, `model`, y `durationMs`/`costUsd` si los tenés |
| Antes de una actividad directa | `agent_start` con `agent: "main"`, `activity`, `activityName`                                 |
| Al terminar la actividad directa | `direct_work` con `activity`, `text` y `reason`                                             |
| Gasto que no es de tokens (API paga, servicio, horas) | `expense` con `activity`, `text` y `costUsd` (USD) |
| Hito, rechazo u observación    | `note` con `text` y `kind: "reject"` o `"revise"` si es un retroceso                          |
| Etapa terminada                | `stage_done`                                                                                  |

### Skills de cada actividad

Torre registra qué skills se usaron en cada tarea. Para que la atribución sea exacta:

- **`skill` en los eventos.** Si una skill guía la actividad (por ejemplo `doc-orquestador`, `doc-voz`
  o la que trae el flujo), mandá su nombre en el campo `skill` de `agent_start`, `agent_done` y
  `direct_work`.
- **Descripción del sub-agente.** Empezá la `description` de cada sub-agente que despaches con
  `[<activity>]`, por ejemplo `[medir-voz] Medir la voz del informe`. Con eso el reporter une el
  transcript del sub-agente con su actividad y le asigna sus tokens exactos.
- **Detección automática.** Además, `torre-usage.mjs` detecta en el transcript las skills invocadas,
  los slash commands, los scripts de skills ejecutados y los `SKILL.md` leídos. Lo que declares en
  los eventos se suma a eso; no lo reemplaza.

Reglas que aplica el servidor (no las simules, respetá su respuesta):

- **`stage_done` sin evidencia se rechaza.** La etapa necesita al menos un `agent_done` o un
  `direct_work`. Si te lo rechaza, te faltó ejecutar o trackear una actividad.
- **Transiciones automáticas.** El primer evento de una etapa la activa, y `stage_done` activa la
  siguiente. No hace falta `stage_start` salvo para marcar el inicio antes del primer sub-agente.
- **Tiempo.** Si no mandás `durationMs`, el servidor lo mide entre `agent_start` y `agent_done` o
  `direct_work`. Nunca estimes duraciones a mano: abrí siempre la actividad con `agent_start`.
- **Tokens y costo.** Informá lo que devuelve el resultado del sub-agente:
  - Si trae el desglose, mandá `tokens: {input, output, cacheCreation, cacheRead}`.
  - Si solo trae `total_tokens`, mandá `tokens: {total}` y no lo cargues como `input`.
  - `durationMs` es el `duration_ms` del resultado.
  - `costUsd` va solo si tenés el costo real. Si no, Torre lo estima con su tabla de precios o lo
    marca como incompleto.
- **`stage` por defecto** es la etapa activa. Indicalo explícito cuando trackees otra.

### Que nunca se pierda un evento

- **Enviá en lotes chicos**, uno por actividad: `agent_start` antes del sub-agente y `agent_done`
  apenas termina. No acumules una etapa entera.
- **Revisá `results[]`** de cada respuesta:
  - `applied` y `duplicate` están bien.
  - `rejected` trae un `error`: corregí el evento y reenvialo con el **mismo** `id`.
- **Si la tool falla** (red, Torre caído), guardá los eventos pendientes en
  `.torre/pending-events.json` del directorio de trabajo y seguí trabajando.
  - Antes del siguiente `track`, reenviá primero ese archivo completo. Los ids repetidos vuelven
    como `duplicate`, así que reenviar es seguro.
  - Borrá el archivo cuando todo vuelva `applied` o `duplicate`.
- **Al terminar la tarea**, si quedó `.torre/pending-events.json`, decíselo al usuario.

## Paso 6: gates (`kind="stop"`)

1. Publicá con `upload_doc` lo que el usuario tiene que aprobar.
2. Mandá `stage_done` de la etapa stop. Torre lo deja en `blocked` hasta que el usuario apruebe
   desde la web. Es lo esperado.
3. Decile al usuario: "Aprobá la etapa <nombre> en Torre (o respondé acá)".
4. Consultá `check_gate(projectId, stageKey)`.
   - **`confirmed=false`**: no avances. Esperá la respuesta del usuario y volvé a consultar.
   - **El usuario aprobó en el chat pero el gate sigue sin confirmar**: indicale que lo confirme en
     la web y dejá un `note` en el historial. No lo saltees.
5. Si el requerimiento se creó con `autoApprove`, los stop llegan como `stage` con una instrucción
   de no frenar. Respetala.

## Costos de cualquier proveedor

El trackeo sirve para cualquier IA o gasto, no solo para Claude:

- **Otro modelo** (OpenAI, Gemini, local): informá su `model` y sus `tokens` en `agent_done`. Torre
  calcula el costo con la tabla de precios de la organización. Revisala con `list_prices`; un admin
  carga los precios que falten con `set_price`.
- **Gasto que no es de tokens:** usá `expense` con el monto real, por ejemplo una API paga, un
  servicio externo u horas de una persona.

## Estado y archivado

- **Proyecto activo:** tiene sub-agentes corriendo, es decir, un `agent_start` sin su `agent_done`.
  Por eso cerrá siempre cada `agent_start`, o el proyecto queda como activo.
- **Proyecto inactivo:** no está terminado y no corre nada.
- **Ocultar un proyecto:** si el usuario no lo quiere ver, usá
  `archive_project(projectId, archived: true)`. No borra nada y el proyecto sigue aceptando
  tracking. `false` lo vuelve a mostrar.

## Paso 6b: medir el consumo real (obligatorio)

Los eventos `track` solo traen lo que vos sabés de los sub-agentes, y vos no conocés tu propio
consumo como agente principal. El consumo real está en el transcript de esta sesión. Reportalo con
el script que viene con esta skill: suma todos tus tokens, los de cada sub-agente y, cuando existe,
el costo exacto que calculó Claude Code.

```
node ~/.claude/skills/torre-integration/torre-usage.mjs --cwd "<directorio de trabajo>"
```

- Si la skill está instalada en el proyecto, la ruta es `.claude/skills/torre-integration/torre-usage.mjs`.
- **Cuándo:** al cerrar cada etapa y al terminar la tarea. Es idempotente, así que podés correrlo
  todas las veces que quieras sin duplicar nada.
- Si el script responde `tracked: false`, pasale el proyecto con `--project <projectId>`.
- **Automático (opcional):** el usuario puede agregar el script como hook `Stop` en
  `.claude/settings.json`. Pedí confirmación antes de tocar esa configuración.

## Paso 7: cierre y resumen de costo y tiempo

Al terminar, corré el reporter del Paso 6b y después llamá `get_summary(projectId)`, o `get_summary(goal)` si la tarea es parte de un goal.
Informale al usuario el tiempo, los tokens y el costo por etapa y por actividad.

Si el resumen dice `costIncomplete: true`, alguna ejecución no trajo costo. Aclaralo y no inventes
cifras.

## Crear o editar sub-agentes en la cuenta

Cuando el usuario pida un sub-agente nuevo para su flujo:

1. Llamá `save_subagent` con:
   - `name`: kebab-case.
   - `description`: cuándo usarlo.
   - `prompt`: el system prompt completo.
   - `model` y `tools`: opcionales.
2. Para sumarlo a una etapa, llamá `add_agent_to_stage(workflowId, stageKey, agent, purpose)`.
   - **Si el flujo es builtin**: el cambio queda como versión propia de la organización.
3. Materializalo localmente como en el Paso 4 si lo vas a usar en esta sesión.

## Reglas

- La única fuente de verdad del flujo es `get_project_workflow`.
- Toda actividad se ejecuta con un sub-agente, o queda como `direct_work` con un `reason` real.
  Nunca trabajes sin trackear.
- Nunca marques `done` lo posterior a un gate sin confirmar.
- Errores de una tool:
  - **401/403**: corresponde al Paso 0.
  - **"no existe"**: verificá el id con `list_projects`.
  - **Torre caído**: usá `.torre/pending-events.json`.
- No pegues secretos, `.env` ni la API key en `track`, `upload_doc` ni `note`.
