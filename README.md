# torre-integration: skill de Claude Code para Torre de Control

Skill que conecta Claude Code con **Torre de Control**, el plano de control web para ejecutar y
trackear con IA cualquier tarea (desarrollo, documentos, investigación, operaciones). Con la API key de tu cuenta, Claude Code:

- ejecuta el **Flujo de Trabajo** que diseñaste en la web (etapas, sub-agentes, loops, gates);
- reporta en vivo cada etapa, hito y sub-agente, y lo ves en la web mientras trabaja;
- frena en los **gates de aprobación** hasta que los apruebes desde la web;
- crea y reutiliza **sub-agentes de tu organización**, disponibles para todo el equipo.

| Recurso                | Link                                                |
| ---------------------- | --------------------------------------------------- |
| Web (Torre de Control) | https://torre-de-control-two.vercel.app                 |
| Endpoint MCP           | https://torre-de-control-two.vercel.app/mcp             |
| Skill (este repo)      | https://github.com/axelgonzales/torre-integration   |

## Requisitos

- **Claude Code.**
- **Una API key de Torre** (`tdc_...`). La crea el admin de tu organización en la web, en
  **Cuenta → API keys**.
- **El servidor MCP `torre`.** No hace falta configurarlo a mano: si falta, la skill lo detecta,
  te pide la key y lo registra (paso 2).

## Instalación

### 1. Clonar la skill

```bash
# macOS / Linux
git clone https://github.com/axelgonzales/torre-integration ~/.claude/skills/torre-integration
```

```powershell
# Windows (PowerShell)
git clone https://github.com/axelgonzales/torre-integration "$HOME\.claude\skills\torre-integration"
```

### 2. Exportar la API key y registrar el MCP

```powershell
setx TORRE_API_KEY "tdc_..."          # Windows; reabrí la terminal después
```

```bash
echo 'export TORRE_API_KEY=tdc_...' >> ~/.zshrc   # macOS / Linux (o ~/.bashrc)
```

```bash
claude mcp add --transport http --scope user torre https://torre-de-control-two.vercel.app/mcp \
  --header 'Authorization: Bearer ${TORRE_API_KEY}'
```

Reiniciá Claude Code y verificá con `/mcp` que `torre` figure como conectado.

Para actualizar la skill: `git -C ~/.claude/skills/torre-integration pull`.

## Uso

```
continuá el requerimiento alta-de-clientes-60bc4f de Torre
```

```
registrá en Torre un requerimiento nuevo con el flujo "Desarrollo": endpoint de alta de clientes
```

```
creá en Torre un sub-agente "build-foo-checker" que revise ... y sumalo a la etapa Pruebas
```

## Cómo trackea

- **Cualquier tarea, no solo código.** Si no nombrás un flujo, usa `builtin-task`
  (Entender → Ejecutar → Verificar).
- **Etapas y actividades.** El trabajo se divide en etapas y cada etapa en actividades.
- **Un sub-agente por actividad.** Si no existe uno aplicable, el trabajo se registra como
  `direct_work` con su motivo, así nada queda sin mapear.
- **Una sola tool de tracking, `track`,** con eventos idempotentes (`id` estable): reenviar un lote
  tras un fallo no duplica nada. Si Torre no responde, los eventos esperan en
  `.torre/pending-events.json` y se reenvían.
- **Etapas con evidencia.** El servidor no deja cerrar una etapa sin ejecución registrada.
- **Totales por nivel.** Tiempo, tokens y costo se suman por actividad, etapa, proyecto y **goal**
  (varios requerimientos de un mismo proceso grande).
- **Vista Proyectos.** En la web, la pestaña **Proyectos** muestra los proyectos activos, terminados
  e históricos, agrupados por goal.

## Tools MCP que usa la skill

| Tool                   | Para qué                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| `whoami`               | Verifica la key: organización y rol                                    |
| `list_workflows`       | Flujos disponibles (builtin + de tu organización)                      |
| `get_workflow`         | Grafo completo de un flujo                                             |
| `save_workflow`        | Crea o reemplaza un flujo de la organización                           |
| `create_project`       | Registra un requerimiento (opcional: `goal`)                           |
| `list_projects`        | Cartera: estado (active/completed/inactive), avance y totales          |
| `get_project`          | Estado de un requerimiento                                             |
| `get_project_workflow` | Flujo resuelto del requerimiento (fuente de verdad)                    |
| `track`                | Única vía de tracking: lote de eventos idempotentes                    |
| `check_gate`           | ¿El usuario ya aprobó la etapa stop?                                   |
| `get_summary`          | Tiempo, tokens y costo por actividad/etapa/proyecto, o por goal        |
| `upload_doc`           | Publica un documento de la etapa para revisión                         |
| `update_project`       | Patch parcial (mode, plan, próximos agentes)                           |
| `list_subagents`       | Sub-agentes de la cuenta                                               |
| `get_subagent_file`    | AGENT.md listo para `.claude/agents/`                                  |
| `save_subagent`        | Crea o actualiza un sub-agente de la cuenta                            |
| `add_agent_to_stage`   | Suma un sub-agente a una etapa de un flujo                             |

## Seguridad

- La key viaja siempre en `Authorization: Bearer`, y el servidor guarda solo su hash (SHA-256).
- Cada key pertenece a una organización y nunca ve datos de otra.
- El servidor **no ejecuta código ni accede a tu disco**: todo lo ejecuta tu Claude Code en local.
- Si una key se compromete, revocala desde la web (**Cuenta → API keys**).
