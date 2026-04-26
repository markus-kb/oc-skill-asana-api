# Asana API for OpenCode

Private OpenCode integration for Asana project work using a Personal Access Token.

This project provides:
- a reusable OpenCode skill: `asana-api`
- project-local custom tools: `asana_api_*`

Supported operations:
- find projects
- list project sections
- find tasks in a project
- get task details
- list subtasks
- get project details
- create tasks
- update tasks
- update task custom fields
- create subtasks
- move tasks between sections
- add/remove tasks from multiple projects
- add comments to tasks
- list task comments
- list/add/remove task dependencies
- get project status updates
- create project status updates
- create new projects with starter sections
- update projects
- create/rename/reorder sections
- list project custom fields

Not included:
- user management
- workspace or team administration
- SCIM or audit/admin APIs
- attachments
- webhooks
- portfolios

## Files

```text
.opencode/
  tools/
    asana-core.ts
    asana_api.ts
  skills/
    asana-api/
      SKILL.md
opencode.json.example
README.md
tests/
  asana_test_env.mjs
  asana_core.unit.test.ts
  asana_core.test.ts
  opencode_session.mjs
  opencode_session.test.mjs
  run_all.ps1
  run_all.sh
  skill_automation.mjs
  skill_automation.sh
  run_all.mjs
```

## Requirements

- Node.js 22+
- an Asana Personal Access Token in `ASANA_PAT`
- access to the Asana workspace and team where you want to operate

## Installation

There is no local npm installation step for normal use.

This integration combines a `SKILL.md` with custom tools.

### Project-local install

To use the skill in a single project, keep these files in the project:
- `.opencode/tools/`
- `.opencode/skills/asana-api/`
- `opencode.json`

OpenCode will discover them from the project directory.

Layout:

```text
your-project/
  .opencode/
    tools/
      asana-core.ts
      asana_api.ts
    skills/
      asana-api/
        SKILL.md
  opencode.json
```

### Global install

Based on OpenCode's official docs and latest source, skill definitions in `SKILL.md` are also discovered from `~/.agents/skills/<name>/SKILL.md`. Therefore, this skill can be placed globally in either:
- `~/.config/opencode/skills/asana-api/SKILL.md`
- `~/.agents/skills/asana-api/SKILL.md`

For custom tools, the only confirmed global location in the latest OpenCode source and tests is `~/.config/opencode/tools/`. `~/.agents/tools/` is not treated as a supported global location in this README.

To install globally, copy or symlink:
- `.opencode/skills/asana-api/` -> `~/.config/opencode/skills/asana-api/`
- `.opencode/skills/asana-api/SKILL.md` -> `~/.agents/skills/asana-api/SKILL.md` (if placing only the skill definition in `~/.agents`)
- `.opencode/tools/asana-core.ts` -> `~/.config/opencode/tools/asana-core.ts`
- `.opencode/tools/asana_api.ts` -> `~/.config/opencode/tools/asana_api.ts`

Notes:
- Placing in `~/.agents/skills/` is the "agent-compatible" global skill layout supported by OpenCode's skills discovery
- The confirmed custom tools search paths in the latest source are project-local `.opencode/tool` / `.opencode/tools` and global `~/.config/opencode/tools`
- This README only documents paths that have been confirmed in the source and tests
- To enable the skill globally, add the same permission entry to `~/.config/opencode/opencode.json`

Layout:

```text
~/.agents/
  skills/
    asana-api/
      SKILL.md

~/.config/opencode/
  tools/
    asana-core.ts
    asana_api.ts
  skills/
    asana-api/
      SKILL.md
  opencode.json
```

When OpenCode executes the custom tools, it may generate local runtime artifacts inside `.opencode/`, including:
- `.opencode/package.json`
- `.opencode/bun.lock`
- `.opencode/node_modules/`

These are generated runtime support files, not part of the intended distributable payload.

## Configuration

The Asana Personal Access Token must be set as the `ASANA_PAT` environment variable before running `opencode`. There is no way to configure it in `opencode.json` — the OpenCode config schema does not support custom keys.

Optionally, you can also set `ASANA_WORKSPACE_GID` and `ASANA_TEAM_GID` to skip the automatic workspace/team discovery on each run.

### Set for the current session

**macOS / Linux**
```bash
export ASANA_PAT="your-pat-token-here"
opencode
```

**Windows (PowerShell)**
```powershell
$env:ASANA_PAT = "your-pat-token-here"
opencode
```

### Set permanently in your shell profile

**macOS / Linux** — add to `~/.zshrc`, `~/.bashrc`, or equivalent:
```bash
export ASANA_PAT="your-pat-token-here"
```

**Windows (PowerShell profile)** — add to `$PROFILE`:
```powershell
$env:ASANA_PAT = "your-pat-token-here"
```

**Windows (System environment variables)** — set via System Properties → Advanced → Environment Variables.

### opencode.json

The only setting in `opencode.json` is the skill permission. An example is provided as `opencode.json.example`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "skill": {
      "asana-api": "allow"
    }
  }
}
```

Copy `opencode.json.example` to `opencode.json` to get started (the latter is gitignored since it may contain user-specific config).

## Usage

Open OpenCode in this project directory and load the skill:

```text
asana-api
```

The available custom tools are:
- `asana_api_find_project`
- `asana_api_list_project_sections`
- `asana_api_find_tasks`
- `asana_api_get_task`
- `asana_api_list_subtasks`
- `asana_api_get_project`
- `asana_api_create_task`
- `asana_api_update_task`
- `asana_api_update_task_custom_fields`
- `asana_api_create_subtask`
- `asana_api_move_task_to_section`
- `asana_api_add_task_to_project`
- `asana_api_remove_task_from_project`
- `asana_api_add_comment`
- `asana_api_list_task_comments`
- `asana_api_list_task_dependencies`
- `asana_api_add_task_dependency`
- `asana_api_remove_task_dependency`
- `asana_api_get_project_status_updates`
- `asana_api_create_project_status_update`
- `asana_api_create_project`
- `asana_api_update_project`
- `asana_api_create_section`
- `asana_api_update_section`
- `asana_api_reorder_section`
- `asana_api_list_project_custom_fields`

Typical workflow:
1. Resolve the project with `asana_api_find_project`
2. Resolve the section with `asana_api_list_project_sections`
3. Resolve or create tasks with the relevant `asana_api_*` tools

### Tool selection policy

- Always prefer this repository's custom tools when an `asana_api_*` equivalent exists for an operation
- Specifically for project status updates, prefer `asana_api_create_project_status_update` over built-in or MCP Asana status-update tools
- Do not silently fall back to another Asana tool family for operations outside this integration's scope — explicitly state they are unsupported

### Project status updates

- Create: resolve the project GID with `asana_api_find_project`, then use `asana_api_create_project_status_update`
- The body must specify exactly one of `text` or `html_text`
- Wrap `html_text` in `<body>...</body>` tags
- `color` accepts `green`, `yellow`, `red`, `blue`, `complete`, mapping to `on_track`, `at_risk`, `off_track`, `on_hold`, `complete`
- Read: `asana_api_get_project_status_updates` defaults to 5 updates, max 20
- Status updates are project-level updates, not task comments

Example:

```text
Load the skill named asana-api. Post a weekly status update to the code-pdf-diff project titled 'Week 14 Update' saying 'Completed the initial mockups.'
```

```text
Load the skill named asana-api. Post a weekly status update to the code-pdf-diff project titled 'Week 14 Update' with html_text '<body><strong>Completed</strong> the initial mockups.</body>' and color blue.
```

### Task comments

- `asana_api_add_comment` accepts exactly one of `text` or `html_text`
- `asana_api_list_task_comments` returns only human-authored comments

### Section management

- `asana_api_create_section` adds a new section
- `asana_api_update_section` renames an existing section
- `asana_api_reorder_section` accepts exactly one of `insert_before` or `insert_after`

### Multi-project task membership

- `asana_api_add_task_to_project` adds a task to another project, optionally in a specific section
- `asana_api_remove_task_from_project` removes a task from a project

### Dependencies

- `asana_api_list_task_dependencies` returns both dependencies and dependents
- `asana_api_add_task_dependency` / `asana_api_remove_task_dependency` update blocker relationships

### Custom fields

- `asana_api_list_project_custom_fields` shows custom fields configured on a project, including enum options
- `asana_api_update_task_custom_fields` accepts `custom_fields` as a JSON object string keyed by field GIDs

Example:

```text
Load the skill named asana-api. Show me the comments on the 'Design homepage' task in the Website Refresh project.
```

```text
Load the skill named asana-api. Add the 'Launch checklist' task in the Website Refresh project to the Executive Review project, Incoming section.
```

```text
Load the skill named asana-api. Rename the QA section in the Website Refresh project to UAT and move it before Review.
```

```text
Load the skill named asana-api. What custom fields are configured on the Website Refresh project?
```

```text
Load the skill named asana-api. Update the custom fields on the 'Launch checklist' task in the Website Refresh project with custom_fields '{"1200000000000001":"1200000000000002"}'.
```

## Automated Tests

Normal usage does not install OpenCode or any npm dependencies locally.

The automated tests use three mechanisms:
- `node --test` for OpenCode session management unit tests
- `npx --yes tsx --test` for core integration tests
- `npx --yes opencode-ai@<version>` for skill automation tests

That means OpenCode is downloaded only when you explicitly run the skill automation tests.

### Required environment variables

| Variable | Required by | Description |
|---|---|---|
| `ASANA_PAT` | All tests | Asana Personal Access Token |
| `ASANA_WORKSPACE_GID` | Core + edge-case tests | GID of the Asana workspace where test data is created |
| `ASANA_TEAM_GID` | Core + edge-case tests | GID of the team within that workspace |

### Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENCODE_VERSION` | `opencode-ai@1.3.10` | npm package specifier for the OpenCode CLI used in skill automation tests |
| `OPENCODE_MODEL` | `openai/gpt-5.4-mini` | Model identifier passed to `opencode run` in skill automation tests |

**Finding your GIDs:** Open a workspace in the Asana web UI and navigate to any project. The URL contains the workspace GID. The team GID can be found via the Asana API (`GET /teams`) or from a team URL in Asana.

Run the full automated suite with:

```bash
node tests/run_all.mjs
```

**Windows (PowerShell)**
```powershell
powershell -File tests/run_all.ps1
```

Run only the core integration tests with:

```bash
npx --yes tsx --test tests/asana_core.unit.test.ts tests/asana_core.test.ts
```

Run only the skill automation tests with:

```bash
node tests/skill_automation.mjs
```

Skill automation test behavior:
- Each test run creates exactly one temporary OpenCode session
- Subsequent natural-language steps continue by specifying that session ID
- On test completion, only the session ID created by that test is deleted
- No directory-level or bulk recent-session deletion is performed

`tests/run_all.mjs` execution order:
- `node --test tests/opencode_session.test.mjs`
- `npx --yes tsx --test tests/asana_core.unit.test.ts tests/asana_core.test.ts`
- `node tests/skill_automation.mjs`

The test suite covers:
- end-to-end tool happy paths
- failure-path behavior
- skill-guided natural-language workflows through `opencode-ai run`
- OpenCode session reuse and safe cleanup
- edge cases including multi-project memberships and pagination

The tests create temporary Asana projects and tasks in your workspace.

## Notes

- `asana_api_get_task` returns both convenience fields and full memberships:
  - top-level `project` and `section`
  - `memberships` array with all project/section pairs
- `asana_api_find_tasks` intentionally caps returned results at 50 even when the underlying project has more tasks

## References

- OpenCode docs: Agent Skills - `https://opencode.ai/docs/skills/`
- OpenCode docs: Custom Tools - `https://opencode.ai/docs/custom-tools/`
