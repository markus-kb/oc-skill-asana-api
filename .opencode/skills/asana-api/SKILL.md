---
name: asana-api
description: Manage Asana project work through custom tools for tasks, subtasks, sections, comments, status updates, and project creation
compatibility: opencode
metadata:
  scope: project-work
  auth: pat
---

# Asana Project Workflow Skill

You have access to custom Asana tools for managing project work. Use these tools instead of any MCP-based or built-in Asana tools when an `asana_api_*` equivalent exists.

## Tool Priority

- If a supported operation has an `asana_api_*` tool, use it.
- Do not switch to another Asana tool family for overlapping operations such as project lookup, task lookup, task creation, task updates, comments, section moves, or project status updates.
- If the user asks for an operation outside this integration's scope, explain that it is unsupported rather than silently falling back to another Asana tool family.
- Project status updates are a priority case for this rule. Prefer `asana_api_create_project_status_update` over any similarly named Asana status-update tool.

## Available Tools

| Tool | Purpose |
|------|---------|
| `asana_api_find_project` | Find a project by name (fuzzy typeahead search) |
| `asana_api_list_project_sections` | List all sections in a project |
| `asana_api_find_tasks` | Find tasks in a project by text query, section, or completion state |
| `asana_api_get_task` | Get full details for a single task |
| `asana_api_list_subtasks` | List subtasks under a task |
| `asana_api_get_project` | Get project metadata |
| `asana_api_create_task` | Create a new task in a project and section |
| `asana_api_update_task` | Update task name, notes, assignee, due date, or completion |
| `asana_api_update_task_custom_fields` | Update task custom field values |
| `asana_api_create_subtask` | Create a subtask under a parent task |
| `asana_api_move_task_to_section` | Move a task to a different section (workflow stage) |
| `asana_api_add_task_to_project` | Add a task to another project |
| `asana_api_remove_task_from_project` | Remove a task from a project |
| `asana_api_add_comment` | Add a comment to a task |
| `asana_api_list_task_comments` | List comments on a task |
| `asana_api_list_task_dependencies` | List dependencies and dependents for a task |
| `asana_api_add_task_dependency` | Add a dependency to a task |
| `asana_api_remove_task_dependency` | Remove a dependency from a task |
| `asana_api_get_project_status_updates` | Get recent status updates for a project |
| `asana_api_create_project_status_update` | Post a status update to a project |
| `asana_api_create_project` | Create a new project with optional starter sections |
| `asana_api_update_project` | Update project metadata |
| `asana_api_create_section` | Create a new section in a project |
| `asana_api_update_section` | Rename a section |
| `asana_api_reorder_section` | Move a section before or after another section |
| `asana_api_list_project_custom_fields` | List custom fields configured on a project |

## Name Resolution Rules

- **Always resolve names to GIDs before writes.** If the user says "Marketing Launch project", call `asana_api_find_project` first to get the GID.
- **Always resolve section names to GIDs.** If the user says "move to In Progress", call `asana_api_list_project_sections` first to find the section GID.
- **Always resolve task names to GIDs.** If the user references a task by name, call `asana_api_find_tasks` to locate it.

## Preferred Lookup Order

1. **Project-scoped lookups first.** When searching for tasks, always scope to a specific project.
2. **Use typeahead for projects.** The `asana_api_find_project` tool uses Asana's fuzzy typeahead, so partial names work.
3. **Use text search for tasks.** The `asana_api_find_tasks` tool searches task names and descriptions within a project.

## Ambiguity Handling

- If `asana_api_find_project` returns multiple matches, present the options to the user and ask which one they mean.
- If `asana_api_find_tasks` returns multiple matches, present the list and ask the user to clarify.
- If a section name is ambiguous (duplicate names in the same project), present the options with GIDs.
- **Never guess** when multiple matches exist. Always ask.

## Section Moves

- **Always use `asana_api_move_task_to_section`** to change a task's workflow stage.
- **Never** try to move tasks via `asana_api_update_task` because that tool cannot change sections.
- The move tool reports both the source and target section names for confirmation.

## Write Verification

- After creating or updating a task, the tool returns the new state. No need for a separate read-back.
- After moving a task, the tool confirms the from/to sections.
- After creating a project with sections, the tool reports which sections were created.
- `asana_api_add_comment` accepts exactly one body field: `text` for plain text or `html_text` for rich text wrapped in `<body>` tags.
- `asana_api_create_project_status_update` accepts exactly one body field: `text` for plain text or `html_text` for rich text wrapped in `<body>` tags.
- `asana_api_update_task_custom_fields` expects `custom_fields` as a JSON object string keyed by custom field GIDs.

## Excluded Operations

Never attempt these operations — they are outside the scope of this integration:

- User management or workspace administration
- Team management
- SCIM or audit/admin APIs
- Attachment uploads
- Webhook creation
- Portfolio management

If the user asks for any of these, explain that they are not supported by this integration.

## Output Style

- Keep confirmations short and clear.
- Always include the GID and name of created/modified objects.
- Use the structured JSON output from the tools directly — do not reformat unnecessarily.

## Example Workflows

### Create a task in a named project and section

1. `asana_api_find_project` with the project name → get project GID
2. `asana_api_list_project_sections` with the project GID → get section GIDs
3. `asana_api_create_task` with project GID, section GID, task name, and optional fields

### Move a task between sections

1. `asana_api_find_project` → project GID (if not already known)
2. `asana_api_find_tasks` with the project GID and task name → get task GID
3. `asana_api_list_project_sections` → get target section GID
4. `asana_api_move_task_to_section` with task GID and section GID

### Create a subtask

1. `asana_api_find_tasks` to locate the parent task → parent GID
2. `asana_api_create_subtask` with parent GID and subtask details

### List subtasks

1. `asana_api_find_tasks` to locate the parent task → task GID
2. `asana_api_list_subtasks` with the parent task GID

### Add a comment to a task

1. `asana_api_find_tasks` to locate the task → task GID
2. `asana_api_add_comment` with task GID and exactly one of `text` or `html_text`

### List comments on a task

1. `asana_api_find_tasks` to locate the task → task GID
2. `asana_api_list_task_comments` with task GID

### Update project metadata

1. `asana_api_find_project` → project GID
2. `asana_api_update_project` with project GID and changed fields

### Create, rename, and reorder sections

1. `asana_api_find_project` → project GID
2. `asana_api_create_section` with project GID and section name
3. `asana_api_update_section` with section GID and new name if needed
4. `asana_api_reorder_section` with project GID, section GID, and exactly one of `insert_before` or `insert_after`

### Add or remove a task from another project

1. `asana_api_find_project` → source or target project GIDs
2. `asana_api_find_tasks` to locate the task → task GID
3. `asana_api_add_task_to_project` or `asana_api_remove_task_from_project`

### Manage dependencies

1. `asana_api_find_tasks` to locate the blocked task and dependency task → task GIDs
2. `asana_api_add_task_dependency` or `asana_api_remove_task_dependency`
3. `asana_api_list_task_dependencies` to verify the dependency graph if needed

### Read project custom fields

1. `asana_api_find_project` → project GID
2. `asana_api_list_project_custom_fields` with project GID

### Update task custom fields

1. `asana_api_find_project` → project GID
2. `asana_api_find_tasks` to locate the task → task GID
3. `asana_api_list_project_custom_fields` if you need to discover field GIDs or enum option GIDs first
4. `asana_api_update_task_custom_fields` with task GID and a JSON object string keyed by field GIDs

### Post a project status update

1. `asana_api_find_project` → project GID
2. `asana_api_create_project_status_update` with project GID, title, exactly one of `text` or `html_text`, and optional color

### Get project status updates

1. `asana_api_find_project` → project GID
2. `asana_api_get_project_status_updates` with project GID

### Create a new project with sections

1. `asana_api_create_project` with name, optional notes, layout, and comma-separated section names
