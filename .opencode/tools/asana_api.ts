import { tool } from "@opencode-ai/plugin/tool"

import {
  addComment,
  addTaskDependency,
  addTaskToProject,
  createSection,
  createProject,
  createProjectStatusUpdate,
  createSubtask,
  createTask,
  findProject,
  findTasks,
  getProject,
  getProjectStatusUpdates,
  getTask,
  listProjectCustomFields,
  listProjectSections,
  listSubtasks,
  listTaskComments,
  listTaskDependencies,
  moveTaskToSection,
  removeTaskDependency,
  removeTaskFromProject,
  reorderSection,
  updateProject,
  updateSection,
  updateTask,
  updateTaskCustomFields,
} from "./asana-core.ts"

function toJson(result: unknown): string {
  return JSON.stringify(result, null, 2)
}

function parseJsonRecord(input: string): Record<string, unknown> {
  const parsed = JSON.parse(input)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("custom_fields must be a JSON object string.")
  }
  return parsed as Record<string, unknown>
}

export const find_project = tool({
  description:
    "Find an Asana project by name using fuzzy typeahead search. Returns matching projects with GID and name.",
  args: {
    name: tool.schema.string().describe("Full or partial project name to search for"),
  },
  async execute(args) {
    return toJson(await findProject(args))
  },
})

export const list_project_sections = tool({
  description:
    "List all sections in an Asana project. Returns section names and GIDs in display order.",
  args: {
    project: tool.schema.string().describe("Project GID"),
  },
  async execute(args) {
    return toJson(await listProjectSections(args))
  },
})

export const find_tasks = tool({
  description:
    "Find tasks in an Asana project. Optionally filter by text query, section, or completion state. Returns task names, GIDs, completion state, assignee, due date, and section.",
  args: {
    project: tool.schema.string().describe("Project GID"),
    query: tool.schema
      .string()
      .optional()
      .describe("Text to search for in task names and descriptions"),
    section: tool.schema
      .string()
      .optional()
      .describe("Section GID to filter tasks by"),
    completed: tool.schema
      .boolean()
      .optional()
      .describe("Filter by completion state. Omit to include only incomplete tasks."),
  },
  async execute(args) {
    return toJson(await findTasks(args))
  },
})

export const get_task = tool({
  description:
    "Get full details for a single Asana task by GID. Returns name, notes, assignee, dates, memberships, subtask count, and custom fields.",
  args: {
    task: tool.schema.string().describe("Task GID"),
  },
  async execute(args) {
    return toJson(await getTask(args))
  },
})

export const list_subtasks = tool({
  description: "List all subtasks under an Asana task.",
  args: {
    task: tool.schema.string().describe("Parent task GID"),
  },
  async execute(args) {
    return toJson(await listSubtasks(args))
  },
})

export const get_project = tool({
  description: "Get project metadata for a single Asana project.",
  args: {
    project: tool.schema.string().describe("Project GID"),
  },
  async execute(args) {
    return toJson(await getProject(args))
  },
})

export const create_task = tool({
  description:
    "Create a new task in an Asana project. Optionally place it in a specific section.",
  args: {
    project: tool.schema.string().describe("Project GID"),
    name: tool.schema.string().describe("Task name"),
    notes: tool.schema.string().optional().describe("Task description"),
    section: tool.schema
      .string()
      .optional()
      .describe("Section GID to place the task in"),
    assignee: tool.schema
      .string()
      .optional()
      .describe("Assignee: 'me', an email, or a user GID"),
    due_on: tool.schema
      .string()
      .optional()
      .describe("Due date in YYYY-MM-DD format"),
  },
  async execute(args) {
    return toJson(await createTask(args))
  },
})

export const update_task = tool({
  description:
    "Update an existing Asana task. Only provided fields are changed.",
  args: {
    task: tool.schema.string().describe("Task GID"),
    name: tool.schema.string().optional().describe("New task name"),
    notes: tool.schema.string().optional().describe("New task description"),
    assignee: tool.schema
      .string()
      .optional()
      .describe("New assignee: 'me', email, user GID, or 'null' to unassign"),
    due_on: tool.schema
      .string()
      .optional()
      .describe("New due date (YYYY-MM-DD) or 'null' to clear"),
    completed: tool.schema
      .boolean()
      .optional()
      .describe("Mark task complete (true) or incomplete (false)"),
  },
  async execute(args) {
    return toJson(await updateTask(args))
  },
})

export const update_task_custom_fields = tool({
  description:
    "Update task custom field values. Provide custom_fields as a JSON object string mapping field GIDs to values.",
  args: {
    task: tool.schema.string().describe("Task GID"),
    custom_fields: tool.schema
      .string()
      .describe('JSON object string like {"field_gid":"enum_option_gid"} or {"field_gid":42}'),
  },
  async execute(args) {
    return toJson(await updateTaskCustomFields({
      task: args.task,
      custom_fields: parseJsonRecord(args.custom_fields),
    }))
  },
})

export const create_subtask = tool({
  description: "Create a subtask under an existing Asana task.",
  args: {
    parent: tool.schema.string().describe("Parent task GID"),
    name: tool.schema.string().describe("Subtask name"),
    notes: tool.schema.string().optional().describe("Subtask description"),
    assignee: tool.schema
      .string()
      .optional()
      .describe("Assignee: 'me', email, or user GID"),
    due_on: tool.schema
      .string()
      .optional()
      .describe("Due date in YYYY-MM-DD format"),
  },
  async execute(args) {
    return toJson(await createSubtask(args))
  },
})

export const move_task_to_section = tool({
  description:
    "Move an Asana task to a different section within its project. This is the primary way to change a task's workflow stage (e.g. Backlog -> In Progress -> Done).",
  args: {
    task: tool.schema.string().describe("Task GID to move"),
    section: tool.schema.string().describe("Target section GID"),
  },
  async execute(args) {
    return toJson(await moveTaskToSection(args))
  },
})

export const add_task_to_project = tool({
  description:
    "Add a task to another Asana project, optionally placing it in a specific section.",
  args: {
    task: tool.schema.string().describe("Task GID"),
    project: tool.schema.string().describe("Project GID to add the task to"),
    section: tool.schema
      .string()
      .optional()
      .describe("Optional section GID inside the target project"),
  },
  async execute(args) {
    return toJson(await addTaskToProject(args))
  },
})

export const remove_task_from_project = tool({
  description: "Remove a task from an Asana project.",
  args: {
    task: tool.schema.string().describe("Task GID"),
    project: tool.schema.string().describe("Project GID to remove the task from"),
  },
  async execute(args) {
    return toJson(await removeTaskFromProject(args))
  },
})

export const add_comment = tool({
  description: "Add a comment to an Asana task.",
  args: {
    task: tool.schema.string().describe("Task GID"),
    text: tool.schema
      .string()
      .optional()
      .describe("Plain-text comment body. Provide exactly one of text or html_text."),
    html_text: tool.schema
      .string()
      .optional()
      .describe("HTML comment body wrapped in <body> tags. Provide exactly one of text or html_text."),
  },
  async execute(args) {
    return toJson(await addComment(args))
  },
})

export const list_task_comments = tool({
  description: "List human-authored comments on an Asana task.",
  args: {
    task: tool.schema.string().describe("Task GID"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Number of comments to return (default 20, max 20)"),
  },
  async execute(args) {
    return toJson(await listTaskComments(args))
  },
})

export const list_task_dependencies = tool({
  description: "List dependency and dependent tasks for an Asana task.",
  args: {
    task: tool.schema.string().describe("Task GID"),
  },
  async execute(args) {
    return toJson(await listTaskDependencies(args))
  },
})

export const add_task_dependency = tool({
  description: "Mark another Asana task as a dependency of this task.",
  args: {
    task: tool.schema.string().describe("Blocked task GID"),
    dependency: tool.schema.string().describe("Dependency task GID"),
  },
  async execute(args) {
    return toJson(await addTaskDependency(args))
  },
})

export const remove_task_dependency = tool({
  description: "Remove a dependency link from an Asana task.",
  args: {
    task: tool.schema.string().describe("Blocked task GID"),
    dependency: tool.schema.string().describe("Dependency task GID"),
  },
  async execute(args) {
    return toJson(await removeTaskDependency(args))
  },
})

export const create_section = tool({
  description: "Create a new section inside an Asana project.",
  args: {
    project: tool.schema.string().describe("Project GID"),
    name: tool.schema.string().describe("Section name"),
  },
  async execute(args) {
    return toJson(await createSection(args))
  },
})

export const update_section = tool({
  description: "Rename an existing Asana section.",
  args: {
    section: tool.schema.string().describe("Section GID"),
    name: tool.schema.string().describe("New section name"),
  },
  async execute(args) {
    return toJson(await updateSection(args))
  },
})

export const reorder_section = tool({
  description: "Move a section before or after another section in the same project.",
  args: {
    project: tool.schema.string().describe("Project GID"),
    section: tool.schema.string().describe("Section GID to move"),
    insert_before: tool.schema
      .string()
      .optional()
      .describe("Anchor section GID to move before. Provide exactly one of insert_before or insert_after."),
    insert_after: tool.schema
      .string()
      .optional()
      .describe("Anchor section GID to move after. Provide exactly one of insert_before or insert_after."),
  },
  async execute(args) {
    return toJson(await reorderSection(args))
  },
})

export const list_project_custom_fields = tool({
  description: "List custom field settings configured on an Asana project.",
  args: {
    project: tool.schema.string().describe("Project GID"),
  },
  async execute(args) {
    return toJson(await listProjectCustomFields(args))
  },
})

export const get_project_status_updates = tool({
  description: "Get recent status updates for an Asana project.",
  args: {
    project: tool.schema.string().describe("Project GID"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Number of updates to return (default 5, max 20)"),
  },
  async execute(args) {
    return toJson(await getProjectStatusUpdates(args))
  },
})

export const create_project_status_update = tool({
  description: "Post a status update to an Asana project.",
  args: {
    project: tool.schema.string().describe("Project GID"),
    title: tool.schema.string().describe("Status update title"),
    text: tool.schema
      .string()
      .optional()
      .describe("Plain-text status update body. Provide exactly one of text or html_text."),
    html_text: tool.schema
      .string()
      .optional()
      .describe("HTML status update body wrapped in <body> tags. Provide exactly one of text or html_text."),
    color: tool.schema
      .enum(["green", "yellow", "red", "blue", "complete"])
      .optional()
      .describe(
        "Status color: green=on_track, yellow=at_risk, red=off_track, blue=on_hold, complete. Defaults to green.",
      ),
  },
  async execute(args) {
    return toJson(await createProjectStatusUpdate(args))
  },
})

export const create_project = tool({
  description:
    "Create a new Asana project, optionally with starter sections.",
  args: {
    name: tool.schema.string().describe("Project name"),
    notes: tool.schema.string().optional().describe("Project description"),
    layout: tool.schema
      .enum(["list", "board", "calendar", "timeline"])
      .optional()
      .describe("Default view layout. Defaults to list."),
    sections: tool.schema
      .string()
      .optional()
      .describe(
        "Comma-separated list of section names to create. Example: 'Backlog,In Progress,Review,Done'",
      ),
  },
  async execute(args) {
    return toJson(await createProject(args))
  },
})

export const update_project = tool({
  description: "Update project metadata such as name, notes, color, or archived state.",
  args: {
    project: tool.schema.string().describe("Project GID"),
    name: tool.schema.string().optional().describe("New project name"),
    notes: tool.schema.string().optional().describe("New project description"),
    color: tool.schema.string().optional().describe("Project color token"),
    archived: tool.schema.boolean().optional().describe("Archive or unarchive the project"),
  },
  async execute(args) {
    return toJson(await updateProject(args))
  },
})
