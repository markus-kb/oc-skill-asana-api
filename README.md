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
- create tasks
- update tasks
- create subtasks
- move tasks between sections
- add comments to tasks
- get project status updates
- create project status updates
- create new projects with starter sections

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
opencode.json
README.md
tests/
  asana_core.test.ts
  skill_automation.sh
  run_all.sh
```

## Requirements

- Node.js 22+
- an Asana Personal Access Token in `ASANA_PAT`
- access to the Asana workspace and team where you want to operate

## Installation

There is no local npm installation step for normal use.

To use the skill, keep these files in the project:
- `.opencode/tools/`
- `.opencode/skills/asana-api/`
- `opencode.json`

OpenCode will discover them from the project directory.

For a global install, copy or symlink these into `~/.config/opencode/`:
- `.opencode/skills/asana-api/` -> `~/.config/opencode/skills/asana-api/`
- `.opencode/tools/asana-core.ts` -> `~/.config/opencode/tools/asana-core.ts`
- `.opencode/tools/asana_api.ts` -> `~/.config/opencode/tools/asana_api.ts`

If you want the skill enabled globally, add the same permission entry to `~/.config/opencode/opencode.json`.

When OpenCode executes the custom tools, it may generate local runtime artifacts inside `.opencode/`, including:
- `.opencode/package.json`
- `.opencode/bun.lock`
- `.opencode/node_modules/`

Those files are generated runtime support files, not part of the intended distributable payload.

## Configuration

Export your Asana token before using the tools or running the tests:

```bash
export ASANA_PAT="your-token-here"
```

`ASANA_PAT` is read at runtime and is never written to project files.

The OpenCode config is already included in `opencode.json` and allows the skill:

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
- `asana_api_create_task`
- `asana_api_update_task`
- `asana_api_create_subtask`
- `asana_api_move_task_to_section`
- `asana_api_add_comment`
- `asana_api_get_project_status_updates`
- `asana_api_create_project_status_update`
- `asana_api_create_project`

Typical workflow:
1. Resolve the project with `asana_api_find_project`
2. Resolve the section with `asana_api_list_project_sections`
3. Resolve or create tasks with the relevant `asana_api_*` tools

## Automated Tests

Normal usage does not install OpenCode or any npm dependencies locally.

The automated tests use two mechanisms:
- `node --experimental-default-type=module --experimental-strip-types` for core integration tests
- `npx --yes opencode-ai@1.3.10` for skill automation tests

That means OpenCode is downloaded only when you explicitly run the skill automation tests.

Run the full automated suite with:

```bash
bash tests/run_all.sh
```

Run only the core integration tests with:

```bash
node --experimental-default-type=module --experimental-strip-types --test --test-concurrency=1 tests/asana_core.test.ts
```

Run only the skill automation tests with:

```bash
bash tests/skill_automation.sh
```

The suite covers:
- end-to-end tool happy path
- failure-path behavior
- skill-guided natural-language workflows through `opencode-ai run`
- edge cases including multi-project memberships and pagination

The tests create temporary Asana projects and tasks in your workspace.

## Notes

- `asana_api_get_task` returns both convenience fields and full memberships:
  - top-level `project` and `section`
  - `memberships` array with all project/section pairs
- `asana_api_find_tasks` intentionally caps returned results at 50 even when the underlying project has more tasks
