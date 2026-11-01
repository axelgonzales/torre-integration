---
name: torre-integration
description: |
  Ejecuta un requerimiento de desarrollo siguiendo el Flujo de Trabajo que el usuario definió en
  Torre de Control (web), reportando cada etapa, hito y sub-agente por MCP (servidor `torre`).
  Use when: el usuario pide "continuá/arrancá el requerimiento <id> de Torre", "registrá esto en
  Torre", "usá el flujo X de Torre", "creá un sub-agente en Torre", o cuando el prompt trae un
  bloque "[Contexto de Torre de Control ...]". También para conectar Claude Code a Torre por
  primera vez ("configurá Torre", "no veo las tools de Torre").
  No usar para editar el grafo del flujo a mano si el usuario no lo pidió: el flujo lo diseña
  el usuario en la web; vos lo ejecutás.
---

# Torre de Control: integración por MCP

Torre de Control es el **plano de control**: guarda los Flujos de Trabajo (etapas, sub-agentes,
loops, gates de aprobación), el estado de cada requerimiento y los sub-agentes de la cuenta.
**Vos ejecutás** el trabajo en el repo local y Torre muestra el avance en la web en tiempo real.
Toda la comunicación va por las tools MCP del servidor `torre` (`mcp__torre__*`); nunca uses
`curl` ni inventes endpoints.

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

## Paso 1: ubicar el requerimiento

- **Si el usuario dio un id**: `get_project(projectId)`.
- **Si es un pedido nuevo**: `list_workflows` y elegí el flujo que el usuario nombró. Si no nombró
  ninguno, usá `builtin-dev`. Después llamá `create_project` con:
  - `name`: corto.
  - `prompt`: el texto original del usuario, tal cual.
  - `workflowId`.
  - `cwd`: la ruta absoluta del repo, para que los hooks asocien los sub-agentes.

  Decile al usuario el `id` y que puede seguirlo en la web.

## Paso 2: leer el flujo (fuente de verdad)

`get_project_workflow(projectId)` devuelve el grafo ya resuelto:

- **`nodes`**: las etapas. Ordenalas por `x` ascendente: ese es el orden de ejecución.
  - `kind="stage"`: etapa de trabajo.
  - `kind="stop"`: gate de aprobación del usuario.
  - `kind="decision"`: ruteo puro, no se reporta.
- **De cada nodo**, usá estos campos:
  - `instructions`: qué producir y el criterio de salida.
  - `activities[]`: los pasos, cada uno con su `agent` asignado.
  - `agents[].matched_skill`: el sub-agente o skill que ejecuta la etapa.
- **`edges`**: las conexiones. Las de `kind="loop"` son reintentos: volvé a la etapa `to`
  como máximo `max_retries` veces y después escalá al usuario.
- **`subagents`**: los sub-agentes de la cuenta que este flujo usa.

No reinventes etapas que no estén en el grafo. Si el grafo está vacío o incompleto, avisá y seguí
con tu mejor criterio.

## Paso 3: materializar los sub-agentes de la cuenta

Hacé esto para cada nombre de `subagents` que no exista en `.claude/agents/<name>/AGENT.md` del repo:

1. Llamá `get_subagent_file(name)`.
2. Escribí `content` en `path`, sin modificarlo.
3. Contale al usuario qué agentes agregaste.

Si un `matched_skill` no está ni en la cuenta ni en el repo, ejecutá la etapa vos mismo y
dejá constancia con `add_history`.

## Paso 4: ejecutar etapa por etapa

En cada etapa, en orden:

1. `set_stage_status(projectId, stageKey, "active")`.
2. Para cada sub-agente que despaches, llamá `track_subagent(start)` antes y `track_subagent(stop)`
   al terminar.
3. Cada hito relevante va a `add_history(projectId, text, detail, stage)`. Usá `kind:"reject"` o
   `kind:"revise"` cuando una validación devuelva el trabajo a una etapa anterior.
4. Cada documento que el usuario deba revisar (propuesta técnica, Gherkin, reporte) se publica con
   `upload_doc(projectId, key=<stageKey>, label, file, raw)`.
5. Cerrá la etapa con `set_stage_status(..., "done")` y pasá a la siguiente.

### Gates (`kind="stop"`)

1. Publicá con `upload_doc` lo que el usuario tiene que aprobar.
2. Llamá `set_stage_status(..., "done")`. Torre lo deja en `blocked` hasta que el usuario apruebe
   desde la web. Es lo esperado.
3. Decile al usuario: "Aprobá la etapa <nombre> en Torre (o respondé acá)".
4. Consultá `check_gate(projectId, stageKey)`.
   - **`confirmed=false`**: no avances. Esperá la respuesta del usuario y volvé a consultar.
   - **El usuario aprobó en el chat pero el gate sigue sin confirmar**: indicale que lo confirme en
     la web. No lo saltees.
5. Si el requerimiento se creó con `autoApprove`, los stop llegan como `stage` con una instrucción
   de no frenar. Respetala.

## Crear o editar sub-agentes en la cuenta

Cuando el usuario pida un sub-agente nuevo para su flujo:

1. Llamá `save_subagent` con:
   - `name`: kebab-case.
   - `description`: cuándo usarlo.
   - `prompt`: el system prompt completo.
   - `model` y `tools`: opcionales.
2. Para sumarlo a una etapa, llamá `add_agent_to_stage(workflowId, stageKey, agent, purpose)`.
   - **Si el flujo es builtin**: el cambio queda como versión propia de la organización.
3. Materializalo localmente como en el Paso 3 si lo vas a usar en esta sesión.

Queda disponible para todas las personas de la organización que usen Torre.

## Reglas

- La única fuente de verdad del flujo es `get_project_workflow`. No la reemplaces con un pipeline
  de memoria.
- Nunca marques `done` lo posterior a un gate sin confirmar. Torre lo corrige igual, pero el
  usuario vería un avance falso.
- Errores de una tool:
  - **401/403**: corresponde al Paso 0.
  - **"no existe"**: verificá el id con `list_projects`.
  - **Torre caído**: seguí trabajando y reportá el avance acumulado cuando vuelva.
- No pegues secretos, `.env` ni la API key en `add_history` ni en `upload_doc`.
