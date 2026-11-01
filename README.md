# torre-integration: skill de Claude Code para Torre de Control

Skill que conecta Claude Code con **Torre de Control**, el plano de control web de flujos de
desarrollo con IA. Con la API key de tu cuenta, Claude Code:

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

## Tools MCP que usa la skill

| Tool                   | Para qué                                              |
| ---------------------- | ----------------------------------------------------- |
| `whoami`               | Verifica la key: organización y rol                   |
| `list_workflows`       | Flujos disponibles (builtin + de tu organización)     |
| `get_workflow`         | Grafo completo de un flujo                            |
| `save_workflow`        | Crea o reemplaza un flujo de la organización          |
| `create_project`       | Registra un requerimiento nuevo                       |
| `list_projects`        | Requerimientos con su progreso                        |
| `get_project`          | Estado de un requerimiento                            |
| `get_project_workflow` | Flujo resuelto del requerimiento (fuente de verdad)   |
| `set_stage_status`     | Cambia el status de una etapa (respeta los gates)     |
| `check_gate`           | ¿El usuario ya aprobó la etapa stop?                  |
| `add_history`          | Hito en el historial                                  |
| `track_subagent`       | Alta o baja de un sub-agente en curso                 |
| `upload_doc`           | Publica un documento de la etapa para revisión        |
| `update_project`       | Patch parcial (mode, plan, próximos agentes)          |
| `list_subagents`       | Sub-agentes de la cuenta                              |
| `get_subagent_file`    | AGENT.md listo para `.claude/agents/`                 |
| `save_subagent`        | Crea o actualiza un sub-agente de la cuenta           |
| `add_agent_to_stage`   | Suma un sub-agente a una etapa de un flujo            |

## Seguridad

- La key viaja siempre en `Authorization: Bearer`, y el servidor guarda solo su hash (SHA-256).
- Cada key pertenece a una organización y nunca ve datos de otra.
- El servidor **no ejecuta código ni accede a tu disco**: todo lo ejecuta tu Claude Code en local.
- Si una key se compromete, revocala desde la web (**Cuenta → API keys**).
