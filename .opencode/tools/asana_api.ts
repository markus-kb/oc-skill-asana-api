import { tool } from "@opencode-ai/plugin/tool"

import {
  addComment,
  createProject,
  createProjectStatusUpdate,
  createSubtask,
  createTask,
  findProject,
  findTasks,
  getProjectStatusUpdates,
  getTask,
  listProjectSections,
  moveTaskToSection,
  updateTask,
} from "./asana-core.ts"

function toJson(result: unknown): string {
  return JSON.stringify(result, null, 2)
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

export const add_comment = tool({
  description: "Add a comment to an Asana task.",
  args: {
    task: tool.schema.string().describe("Task GID"),
    text: tool.schema.string().describe("Comment text"),
  },
  async execute(args) {
    return toJson(await addComment(args))
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
    text: tool.schema.string().describe("Status update body text"),
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
