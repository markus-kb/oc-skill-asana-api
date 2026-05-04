const BASE_URL = "https://app.asana.com/api/1.0"
const MAX_RETRIES = 3

export interface AsanaErrorShape {
  ok: false
  error: {
    code: string
    message: string
    status: number
    /** Brief, actionable hint for the caller on how to fix the error. Only present for locally-detected validation failures. */
    suggestion?: string
  }
}

export function buildError(
  code: string,
  message: string,
  status: number,
  suggestion?: string,
): AsanaErrorShape {
  const error: AsanaErrorShape["error"] = { code, message, status }
  if (suggestion !== undefined) error.suggestion = suggestion
  return { ok: false, error }
}

function getPat(): string {
  // ASANA_PAT must be set as an environment variable before running opencode.
  // OpenCode's config schema (additionalProperties: false) rejects custom keys,
  // so there is no way to inject this via opencode.json.
  const pat = process.env.ASANA_PAT
  if (!pat) {
    throw buildError(
      "unauthorized",
      "ASANA_PAT environment variable is not set. Set it before running opencode: export ASANA_PAT=\"your-token\" (macOS/Linux) or $env:ASANA_PAT=\"your-token\" (PowerShell).",
      401,
    )
  }
  return pat
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${getPat()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  }
}

function normalizeError(status: number, body: any): AsanaErrorShape {
  const codeMap: Record<number, string> = {
    400: "invalid_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    429: "rate_limited",
  }
  const code = codeMap[status] ?? (status >= 500 ? "server_error" : "unknown")
  const message =
    body?.errors?.[0]?.message ??
    body?.errors?.[0]?.phrase ??
    `Asana API returned HTTP ${status}`
  return buildError(code, message, status)
}

async function asanaFetch(
  method: string,
  path: string,
  body?: Record<string, any>,
  params?: Record<string, string>,
): Promise<any> {
  let url = `${BASE_URL}${path}`
  if (params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams(params).toString()
    url += `?${qs}`
  }

  let lastError: any = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const init: RequestInit = { method, headers: headers() }
    if (body && (method === "POST" || method === "PUT")) {
      init.body = JSON.stringify({ data: body })
    }

    const res = await fetch(url, init)

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "5", 10)
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
        continue
      }
    }

    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      lastError = normalizeError(res.status, json)
      if (res.status !== 429) return lastError
      continue
    }

    return json
  }

  return lastError ?? normalizeError(429, {})
}

async function asanaGet(
  path: string,
  params?: Record<string, string>,
): Promise<any> {
  return asanaFetch("GET", path, undefined, params)
}

async function asanaPost(
  path: string,
  body: Record<string, any>,
): Promise<any> {
  return asanaFetch("POST", path, body)
}

async function asanaPut(
  path: string,
  body: Record<string, any>,
): Promise<any> {
  return asanaFetch("PUT", path, body)
}

async function asanaGetAll(
  path: string,
  params?: Record<string, string>,
  maxPages = 10,
): Promise<any[] | AsanaErrorShape> {
  const allData: any[] = []
  const requestParams = { limit: "100", ...params }

  for (let page = 0; page < maxPages; page++) {
    const res = await asanaGet(path, requestParams)
    if (isError(res)) return res
    if (res.data) allData.push(...res.data)
    if (!res.next_page?.offset) break
    requestParams.offset = res.next_page.offset
  }

  return allData
}

let cachedWorkspaceGid: string | null = null
let cachedTeamGid: string | null = null

async function getWorkspaceGid(): Promise<string> {
  if (hasText(process.env.ASANA_WORKSPACE_GID)) {
    cachedWorkspaceGid = process.env.ASANA_WORKSPACE_GID.trim()
    return cachedWorkspaceGid
  }
  if (cachedWorkspaceGid) return cachedWorkspaceGid
  const res = await asanaGet("/users/me")
  if (isError(res)) throw res
  const workspaces = res.data?.workspaces
  if (!workspaces || workspaces.length === 0) {
    throw buildError("not_found", "No Asana workspaces found for this user", 404)
  }
  cachedWorkspaceGid = workspaces[0].gid
  return cachedWorkspaceGid
}

async function getDefaultTeamGid(): Promise<string> {
  if (hasText(process.env.ASANA_TEAM_GID)) {
    cachedTeamGid = process.env.ASANA_TEAM_GID.trim()
    return cachedTeamGid
  }
  if (cachedTeamGid) return cachedTeamGid
  const workspaceGid = await getWorkspaceGid()
  const res = await asanaGet(`/organizations/${workspaceGid}/teams`)
  if (isError(res)) throw res
  const teams = res.data ?? []
  if (teams.length === 0) {
    throw buildError("not_found", "No Asana teams found for this workspace", 404)
  }
  cachedTeamGid = teams[0].gid
  return cachedTeamGid
}

export function isError(res: any): res is AsanaErrorShape {
  return Boolean(res && res.ok === false && res.error)
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function formatCaughtError(error: any): AsanaErrorShape {
  if (isError(error)) return error
  const message = error instanceof Error ? error.message : String(error)
  return buildError("client_error", message, 0)
}

function validateExactlyOneTextBody(text: string | undefined, htmlText: string | undefined, label: string): AsanaErrorShape | null {
  const hasPlainText = hasText(text)
  const hasHtmlText = hasText(htmlText)
  if (hasPlainText === hasHtmlText) {
    return buildError(
      "invalid_request",
      `Provide exactly one of text or html_text for ${label}.`,
      400,
      "Pass text for plain text or html_text for rich text — never both, never neither.",
    )
  }
  return null
}

function validateExactlyOneAnchor(before: string | undefined, after: string | undefined, label: string): AsanaErrorShape | null {
  const hasBefore = hasText(before)
  const hasAfter = hasText(after)
  if (hasBefore === hasAfter) {
    return buildError(
      "invalid_request",
      `Provide exactly one of insert_before or insert_after for ${label}.`,
      400,
      "Pass insert_before with the GID of the section that should come after, or insert_after with the GID that should come before.",
    )
  }
  return null
}

type FindProjectResult = { ok: true; projects: Array<{ gid: string; name: string }> }
type ListSectionsResult = { ok: true; project_gid: string; sections: Array<{ gid: string; name: string }> }
type FindTasksResult = {
  ok: true
  tasks: Array<{
    gid: string
    name: string
    completed: boolean
    assignee: string | null
    due_on: string | null
    section: string | null
  }>
}
type GetTaskResult = {
  ok: true
  task: {
    gid: string
    name: string
    notes: string
    completed: boolean
    assignee: string | null
    due_on: string | null
    start_on: string | null
    section: string | null
    project: string | null
    memberships: Array<{
      project: { gid: string; name: string } | null
      section: { gid: string; name: string } | null
    }>
    parent: { gid: string; name: string } | null
    num_subtasks: number
    custom_fields: Array<{ name: string; value: string }>
  }
}
type CreateTaskResult = { ok: true; task: { gid: string; name: string; project: string | null; section: string | null } }
type UpdateTaskResult = { ok: true; task: { gid: string; name: string; completed: boolean; assignee: string | null; due_on: string | null } }
type CreateSubtaskResult = { ok: true; subtask: { gid: string; name: string; parent: { gid: string; name: string | null } } }
type MoveTaskResult = { ok: true; moved: { task: { gid: string; name: string }; from_section: string; to_section: string } }
type AddCommentResult = { ok: true; comment: { gid: string; task: { gid: string; name: string | null }; text: string; html_text: string | null; created_at: string } }
type ListTaskCommentsResult = { ok: true; task_gid: string; comments: Array<{ gid: string; text: string; html_text: string | null; created_at: string; author: string | null }> }
type ListSubtasksResult = { ok: true; task_gid: string; subtasks: Array<{ gid: string; name: string; completed: boolean; assignee: string | null; due_on: string | null }> }
type GetProjectResult = { ok: true; project: { gid: string; name: string; notes: string; default_view: string | null; color: string | null; archived: boolean; owner: string | null; team: string | null; created_at: string | null } }
type UpdateProjectResult = { ok: true; project: { gid: string; name: string; notes: string; color: string | null; archived: boolean } }
type CreateSectionResult = { ok: true; section: { gid: string; name: string; project_gid: string } }
type UpdateSectionResult = { ok: true; section: { gid: string; name: string } }
type ReorderSectionResult = { ok: true; moved: { project_gid: string; section_gid: string; position: "before" | "after"; anchor_section_gid: string } }
type TaskMembershipResult = { ok: true; task: { gid: string; name: string; memberships: Array<{ project: { gid: string; name: string } | null; section: { gid: string; name: string } | null }> } }
type ListProjectCustomFieldsResult = { ok: true; project_gid: string; custom_fields: Array<{ gid: string; name: string; type: string; is_important: boolean; enum_options: Array<{ gid: string; name: string }> | null }> }
type UpdateTaskCustomFieldsResult = { ok: true; task: { gid: string; name: string; custom_fields: Array<{ name: string; value: string }> } }
type ListTaskDependenciesResult = { ok: true; task_gid: string; dependencies: Array<{ gid: string; name: string }>; dependents: Array<{ gid: string; name: string }> }
type TaskDependencyMutationResult = { ok: true; task_gid: string; dependency_gid: string }
type GetProjectStatusUpdatesResult = { ok: true; project_gid: string; status_updates: Array<{ gid: string; title: string; text: string; status_type: string; created_at: string; author: string | null }> }
type CreateProjectStatusUpdateResult = { ok: true; status_update: { gid: string; title: string; status_type: string; created_at: string } }
type CreateProjectResult = { ok: true; project: { gid: string; name: string; url: string }; sections_created: string[] }
type GetWorkspaceTagsResult = { ok: true; tags: Array<{ gid: string; name: string }> }
type CreateTagResult = { ok: true; tag: { gid: string; name: string } }
type TagMutationResult = { ok: true; task_gid: string; tag_gid: string }
type CreateTaskWithSubtasksResult = {
  ok: true
  task: { gid: string; name: string; project: string | null; section: string | null }
  subtasks_created: Array<{ gid: string; name: string }>
  subtasks_failed: Array<{ name: string; error: string }>
}

export async function findProject(args: { name: string }): Promise<FindProjectResult | AsanaErrorShape> {
  try {
    const wsGid = await getWorkspaceGid()
    const res = await asanaGet(`/workspaces/${wsGid}/typeahead`, {
      resource_type: "project",
      query: args.name,
      count: "20",
      opt_fields: "name",
    })
    if (isError(res)) return res

    let projects = (res.data ?? []).map((project: any) => ({ gid: project.gid, name: project.name }))
    if (projects.length === 0) {
      const fallback = await asanaGetAll(`/workspaces/${wsGid}/projects`, { opt_fields: "name,archived" })
      if (isError(fallback)) return fallback
      const query = args.name.toLowerCase()
      projects = fallback
        .filter((project: any) => !project.archived)
        .filter((project: any) => project.name?.toLowerCase().includes(query))
        .slice(0, 20)
        .map((project: any) => ({ gid: project.gid, name: project.name }))
    }

    return { ok: true, projects }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function listProjectSections(args: { project: string }): Promise<ListSectionsResult | AsanaErrorShape> {
  try {
    const sections = await asanaGetAll(`/projects/${args.project}/sections`, { opt_fields: "name" })
    if (isError(sections)) return sections
    return {
      ok: true,
      project_gid: args.project,
      sections: sections.map((section: any) => ({ gid: section.gid, name: section.name })),
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function findTasks(args: {
  project: string
  query?: string
  section?: string
  completed?: boolean
}): Promise<FindTasksResult | AsanaErrorShape> {
  try {
    const optFields = "name,completed,assignee.name,due_on,memberships.section.name"
    const filterProjectTasks = (tasks: any[]) => {
      if (!args.query) return tasks
      const query = args.query.toLowerCase()
      return tasks.filter((task: any) => {
        const haystack = `${task.name ?? ""}\n${task.notes ?? ""}`.toLowerCase()
        return haystack.includes(query)
      })
    }
    let rawTasks: any[]

    if (args.query) {
      const wsGid = await getWorkspaceGid()
      const params: Record<string, string> = {
        text: args.query,
        "projects.any": args.project,
        opt_fields: optFields,
        limit: "50",
      }
      params.completed = String(args.completed ?? false)
      const res = await asanaGet(`/workspaces/${wsGid}/tasks/search`, params)
      if (isError(res)) {
        if (res.error.status !== 402) return res
        const fallback = await asanaGetAll(`/projects/${args.project}/tasks`, { opt_fields: `${optFields},notes` })
        if (isError(fallback)) return fallback
        rawTasks = filterProjectTasks(fallback)
      } else {
        rawTasks = res.data ?? []
        if (rawTasks.length === 0) {
          const fallback = await asanaGetAll(`/projects/${args.project}/tasks`, { opt_fields: `${optFields},notes` })
          if (isError(fallback)) return fallback
          rawTasks = filterProjectTasks(fallback)
        }
      }
    } else if (args.section) {
      const data = await asanaGetAll(`/sections/${args.section}/tasks`, { opt_fields: optFields })
      if (isError(data)) return data
      rawTasks = data
      rawTasks = args.completed !== undefined
        ? rawTasks.filter((task) => task.completed === args.completed)
        : rawTasks.filter((task) => !task.completed)
    } else {
      const params: Record<string, string> = { opt_fields: optFields }
      if (args.completed === undefined) params.completed_since = "now"
      const data = await asanaGetAll(`/projects/${args.project}/tasks`, params)
      if (isError(data)) return data
      rawTasks = data
      if (args.completed !== undefined) {
        rawTasks = rawTasks.filter((task) => task.completed === args.completed)
      }
    }

    return {
      ok: true,
      tasks: rawTasks.slice(0, 50).map((task: any) => {
        const sectionMembership = task.memberships?.find((membership: any) => membership.section)
        return {
          gid: task.gid,
          name: task.name,
          completed: task.completed,
          assignee: task.assignee?.name ?? null,
          due_on: task.due_on ?? null,
          section: sectionMembership?.section?.name ?? null,
        }
      }),
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function getTask(args: { task: string }): Promise<GetTaskResult | AsanaErrorShape> {
  try {
    const res = await asanaGet(`/tasks/${args.task}`, {
      opt_fields:
        "name,notes,completed,assignee.name,due_on,due_at,start_on,memberships.project.name,memberships.project.gid,memberships.section.name,memberships.section.gid,parent.name,parent.gid,num_subtasks,custom_fields",
    })
    if (isError(res)) return res
    const task = res.data
    const memberships = (task.memberships ?? []).map((membership: any) => ({
      project: membership.project ? { gid: membership.project.gid, name: membership.project.name } : null,
      section: membership.section ? { gid: membership.section.gid, name: membership.section.name } : null,
    }))
    const primaryMembership = memberships[0]
    const customFields = (task.custom_fields ?? [])
      .filter((customField: any) => customField.display_value != null)
      .map((customField: any) => ({ name: customField.name, value: customField.display_value }))

    return {
      ok: true,
      task: {
        gid: task.gid,
        name: task.name,
        notes: task.notes ?? "",
        completed: task.completed,
        assignee: task.assignee?.name ?? null,
        due_on: task.due_on ?? null,
        start_on: task.start_on ?? null,
        section: primaryMembership?.section?.name ?? null,
        project: primaryMembership?.project?.name ?? null,
        memberships,
        parent: task.parent ? { gid: task.parent.gid, name: task.parent.name } : null,
        num_subtasks: task.num_subtasks ?? 0,
        custom_fields: customFields,
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function createTask(args: {
  project: string
  name: string
  notes?: string
  section?: string
  assignee?: string
  due_on?: string
  due_at?: string
  start_on?: string
  start_at?: string
}): Promise<CreateTaskResult | AsanaErrorShape> {
  try {
    if (args.due_on && args.due_at) {
      return buildError(
        "invalid_request",
        "due_on and due_at are mutually exclusive.",
        400,
        "Use due_on (YYYY-MM-DD) for date-only or due_at (ISO datetime) for a specific time — not both.",
      )
    }
    if (args.start_on && args.start_at) {
      return buildError(
        "invalid_request",
        "start_on and start_at are mutually exclusive.",
        400,
        "Use start_on (YYYY-MM-DD) for date-only or start_at (ISO datetime) for a specific time — not both.",
      )
    }
    if (args.due_on && !/^\d{4}-\d{2}-\d{2}$/.test(args.due_on)) {
      return buildError("invalid_request", `Invalid due_on format "${args.due_on}". Expected YYYY-MM-DD.`, 400)
    }

    const body: Record<string, any> = { name: args.name, projects: [args.project] }
    if (args.notes !== undefined) body.notes = args.notes
    if (hasText(args.assignee)) body.assignee = args.assignee
    if (hasText(args.due_on)) body.due_on = args.due_on
    if (hasText(args.due_at)) body.due_at = args.due_at
    if (hasText(args.start_on)) body.start_on = args.start_on
    if (hasText(args.start_at)) body.start_at = args.start_at
    if (args.section) body.memberships = [{ project: args.project, section: args.section }]

    const res = await asanaPost("/tasks", body)
    if (isError(res)) return res
    const membership = res.data.memberships?.[0]
    return {
      ok: true,
      task: {
        gid: res.data.gid,
        name: res.data.name,
        project: membership?.project?.name ?? null,
        section: membership?.section?.name ?? null,
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function updateTask(args: {
  task: string
  name?: string
  notes?: string
  assignee?: string
  due_on?: string
  due_at?: string
  start_on?: string
  start_at?: string
  completed?: boolean
}): Promise<UpdateTaskResult | AsanaErrorShape> {
  try {
    if (args.due_on && args.due_at) {
      return buildError(
        "invalid_request",
        "due_on and due_at are mutually exclusive.",
        400,
        "Use due_on (YYYY-MM-DD) for date-only or due_at (ISO datetime) for a specific time — not both.",
      )
    }
    if (args.start_on && args.start_at) {
      return buildError(
        "invalid_request",
        "start_on and start_at are mutually exclusive.",
        400,
        "Use start_on (YYYY-MM-DD) for date-only or start_at (ISO datetime) for a specific time — not both.",
      )
    }

    const body: Record<string, any> = {}
    if (args.name !== undefined) body.name = args.name
    if (args.notes !== undefined) body.notes = args.notes
    if (args.completed !== undefined) body.completed = args.completed
    if (args.assignee !== undefined && args.assignee !== "") {
      body.assignee = args.assignee === "null" ? null : args.assignee
    }
    if (args.due_on !== undefined && args.due_on !== "") {
      if (args.due_on === "null") {
        body.due_on = null
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(args.due_on)) {
          return buildError("invalid_request", `Invalid due_on format "${args.due_on}". Expected YYYY-MM-DD.`, 400)
        }
        body.due_on = args.due_on
      }
    }
    if (args.due_at !== undefined && args.due_at !== "") {
      body.due_at = args.due_at === "null" ? null : args.due_at
    }
    if (args.start_on !== undefined && args.start_on !== "") {
      body.start_on = args.start_on === "null" ? null : args.start_on
    }
    if (args.start_at !== undefined && args.start_at !== "") {
      body.start_at = args.start_at === "null" ? null : args.start_at
    }

    if (Object.keys(body).length === 0) {
      return buildError("invalid_request", "No fields to update.", 400)
    }

    const res = await asanaPut(`/tasks/${args.task}`, body)
    if (isError(res)) return res
    return {
      ok: true,
      task: {
        gid: res.data.gid,
        name: res.data.name,
        completed: res.data.completed,
        assignee: res.data.assignee?.name ?? null,
        due_on: res.data.due_on ?? null,
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function createSubtask(args: {
  parent: string
  name: string
  notes?: string
  assignee?: string
  due_on?: string
  due_at?: string
  start_on?: string
  start_at?: string
}): Promise<CreateSubtaskResult | AsanaErrorShape> {
  try {
    if (args.due_on && args.due_at) {
      return buildError(
        "invalid_request",
        "due_on and due_at are mutually exclusive.",
        400,
        "Use due_on (YYYY-MM-DD) for date-only or due_at (ISO datetime) for a specific time — not both.",
      )
    }
    if (args.start_on && args.start_at) {
      return buildError(
        "invalid_request",
        "start_on and start_at are mutually exclusive.",
        400,
        "Use start_on (YYYY-MM-DD) for date-only or start_at (ISO datetime) for a specific time — not both.",
      )
    }
    if (args.due_on && !/^\d{4}-\d{2}-\d{2}$/.test(args.due_on)) {
      return buildError("invalid_request", `Invalid due_on format "${args.due_on}". Expected YYYY-MM-DD.`, 400)
    }

    const body: Record<string, any> = { name: args.name }
    if (args.notes !== undefined) body.notes = args.notes
    if (hasText(args.assignee)) body.assignee = args.assignee
    if (hasText(args.due_on)) body.due_on = args.due_on
    if (hasText(args.due_at)) body.due_at = args.due_at
    if (hasText(args.start_on)) body.start_on = args.start_on
    if (hasText(args.start_at)) body.start_at = args.start_at

    const res = await asanaPost(`/tasks/${args.parent}/subtasks`, body)
    if (isError(res)) return res
    const parentRes = await asanaGet(`/tasks/${args.parent}`, { opt_fields: "name" })
    const parentName = parentRes.data?.name ?? null
    return {
      ok: true,
      subtask: {
        gid: res.data.gid,
        name: res.data.name,
        parent: { gid: args.parent, name: parentName },
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function moveTaskToSection(args: { task: string; section: string }): Promise<MoveTaskResult | AsanaErrorShape> {
  try {
    const taskRes = await asanaGet(`/tasks/${args.task}`, {
      opt_fields: "name,memberships.section.name,memberships.project.gid",
    })
    if (isError(taskRes)) return taskRes
    const taskName = taskRes.data.name
    const fromSection = taskRes.data.memberships?.[0]?.section?.name ?? "(unknown)"

    const moveRes = await asanaPost(`/sections/${args.section}/addTask`, { task: args.task })
    if (isError(moveRes)) return moveRes

    const sectionRes = await asanaGet(`/sections/${args.section}`, { opt_fields: "name" })
    const toSection = sectionRes.data?.name ?? args.section
    return {
      ok: true,
      moved: {
        task: { gid: args.task, name: taskName },
        from_section: fromSection,
        to_section: toSection,
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function addComment(args: { task: string; text?: string; html_text?: string }): Promise<AddCommentResult | AsanaErrorShape> {
  try {
    const validationError = validateExactlyOneTextBody(args.text, args.html_text, "a task comment")
    if (validationError) return validationError

    const body: Record<string, any> = {}
    if (hasText(args.text)) body.text = args.text.trim()
    if (hasText(args.html_text)) body.html_text = args.html_text.trim()

    const res = await asanaPost(`/tasks/${args.task}/stories`, body)
    if (isError(res)) return res
    const taskRes = await asanaGet(`/tasks/${args.task}`, { opt_fields: "name" })
    return {
      ok: true,
      comment: {
        gid: res.data.gid,
        task: { gid: args.task, name: taskRes.data?.name ?? null },
        text: res.data.text,
        html_text: res.data.html_text ?? null,
        created_at: res.data.created_at,
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function listTaskComments(args: { task: string; limit?: number }): Promise<ListTaskCommentsResult | AsanaErrorShape> {
  try {
    const limit = Math.min(args.limit ?? 20, 20)
    const stories = await asanaGetAll(`/tasks/${args.task}/stories`, {
      opt_fields: "resource_subtype,text,html_text,created_at,created_by.name",
      limit: String(limit),
    }, 1)
    if (isError(stories)) return stories
    return {
      ok: true,
      task_gid: args.task,
      comments: stories
        .filter((story: any) => story.resource_subtype === "comment_added")
        .slice(0, limit)
        .map((story: any) => ({
          gid: story.gid,
          text: story.text ?? "",
          html_text: story.html_text ?? null,
          created_at: story.created_at,
          author: story.created_by?.name ?? null,
        })),
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function listSubtasks(args: { task: string }): Promise<ListSubtasksResult | AsanaErrorShape> {
  try {
    const subtasks = await asanaGetAll(`/tasks/${args.task}/subtasks`, {
      opt_fields: "name,completed,assignee.name,due_on",
    })
    if (isError(subtasks)) return subtasks
    return {
      ok: true,
      task_gid: args.task,
      subtasks: subtasks.map((task: any) => ({
        gid: task.gid,
        name: task.name,
        completed: task.completed,
        assignee: task.assignee?.name ?? null,
        due_on: task.due_on ?? null,
      })),
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function getProject(args: { project: string }): Promise<GetProjectResult | AsanaErrorShape> {
  try {
    const res = await asanaGet(`/projects/${args.project}`, {
      opt_fields: "name,notes,default_view,color,archived,owner.name,team.name,created_at",
    })
    if (isError(res)) return res
    return {
      ok: true,
      project: {
        gid: res.data.gid,
        name: res.data.name,
        notes: res.data.notes ?? "",
        default_view: res.data.default_view ?? null,
        color: res.data.color ?? null,
        archived: Boolean(res.data.archived),
        owner: res.data.owner?.name ?? null,
        team: res.data.team?.name ?? null,
        created_at: res.data.created_at ?? null,
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function updateProject(args: {
  project: string
  name?: string
  notes?: string
  color?: string
  archived?: boolean
}): Promise<UpdateProjectResult | AsanaErrorShape> {
  try {
    const body: Record<string, any> = {}
    if (args.name !== undefined) body.name = args.name
    if (args.notes !== undefined) body.notes = args.notes
    if (args.color !== undefined) body.color = args.color
    if (args.archived !== undefined) body.archived = args.archived

    if (Object.keys(body).length === 0) {
      return buildError("invalid_request", "No project fields to update.", 400)
    }

    const res = await asanaPut(`/projects/${args.project}`, body)
    if (isError(res)) return res
    return {
      ok: true,
      project: {
        gid: res.data.gid,
        name: res.data.name,
        notes: res.data.notes ?? "",
        color: res.data.color ?? null,
        archived: Boolean(res.data.archived),
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function createSection(args: { project: string; name: string }): Promise<CreateSectionResult | AsanaErrorShape> {
  try {
    const res = await asanaPost(`/projects/${args.project}/sections`, { name: args.name })
    if (isError(res)) return res
    return {
      ok: true,
      section: {
        gid: res.data.gid,
        name: res.data.name,
        project_gid: args.project,
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function updateSection(args: { section: string; name: string }): Promise<UpdateSectionResult | AsanaErrorShape> {
  try {
    const res = await asanaPut(`/sections/${args.section}`, { name: args.name })
    if (isError(res)) return res
    return {
      ok: true,
      section: {
        gid: res.data.gid,
        name: res.data.name,
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function reorderSection(args: {
  project: string
  section: string
  insert_before?: string
  insert_after?: string
}): Promise<ReorderSectionResult | AsanaErrorShape> {
  try {
    const validationError = validateExactlyOneAnchor(args.insert_before, args.insert_after, "a section reorder")
    if (validationError) return validationError

    const body: Record<string, any> = { section: args.section }
    if (hasText(args.insert_before)) body.before_section = args.insert_before.trim()
    if (hasText(args.insert_after)) body.after_section = args.insert_after.trim()

    const res = await asanaPost(`/projects/${args.project}/sections/insert`, body)
    if (isError(res)) return res
    return {
      ok: true,
      moved: {
        project_gid: args.project,
        section_gid: args.section,
        position: hasText(args.insert_before) ? "before" : "after",
        anchor_section_gid: hasText(args.insert_before) ? args.insert_before.trim() : args.insert_after!.trim(),
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function addTaskToProject(args: {
  task: string
  project: string
  section?: string
}): Promise<TaskMembershipResult | AsanaErrorShape> {
  try {
    const body: Record<string, any> = { project: args.project }
    if (hasText(args.section)) body.section = args.section.trim()

    const addRes = await asanaPost(`/tasks/${args.task}/addProject`, body)
    if (isError(addRes)) return addRes

    const taskRes = await asanaGet(`/tasks/${args.task}`, {
      opt_fields: "name,memberships.project.gid,memberships.project.name,memberships.section.gid,memberships.section.name",
    })
    if (isError(taskRes)) return taskRes

    return {
      ok: true,
      task: {
        gid: taskRes.data.gid,
        name: taskRes.data.name,
        memberships: (taskRes.data.memberships ?? []).map((membership: any) => ({
          project: membership.project ? { gid: membership.project.gid, name: membership.project.name } : null,
          section: membership.section ? { gid: membership.section.gid, name: membership.section.name } : null,
        })),
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function removeTaskFromProject(args: {
  task: string
  project: string
}): Promise<TaskMembershipResult | AsanaErrorShape> {
  try {
    const removeRes = await asanaPost(`/tasks/${args.task}/removeProject`, { project: args.project })
    if (isError(removeRes)) return removeRes

    const taskRes = await asanaGet(`/tasks/${args.task}`, {
      opt_fields: "name,memberships.project.gid,memberships.project.name,memberships.section.gid,memberships.section.name",
    })
    if (isError(taskRes)) return taskRes

    return {
      ok: true,
      task: {
        gid: taskRes.data.gid,
        name: taskRes.data.name,
        memberships: (taskRes.data.memberships ?? []).map((membership: any) => ({
          project: membership.project ? { gid: membership.project.gid, name: membership.project.name } : null,
          section: membership.section ? { gid: membership.section.gid, name: membership.section.name } : null,
        })),
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function listProjectCustomFields(args: { project: string }): Promise<ListProjectCustomFieldsResult | AsanaErrorShape> {
  try {
    const settings = await asanaGetAll(`/projects/${args.project}/custom_field_settings`, {
      opt_fields: "is_important,custom_field.gid,custom_field.name,custom_field.resource_subtype,custom_field.enum_options.gid,custom_field.enum_options.name",
    })
    if (isError(settings)) return settings
    return {
      ok: true,
      project_gid: args.project,
      custom_fields: settings.map((setting: any) => ({
        gid: setting.custom_field?.gid,
        name: setting.custom_field?.name,
        type: setting.custom_field?.resource_subtype ?? "unknown",
        is_important: Boolean(setting.is_important),
        enum_options: setting.custom_field?.enum_options
          ? setting.custom_field.enum_options.map((option: any) => ({ gid: option.gid, name: option.name }))
          : null,
      })),
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function updateTaskCustomFields(args: {
  task: string
  custom_fields: Record<string, unknown>
}): Promise<UpdateTaskCustomFieldsResult | AsanaErrorShape> {
  try {
    if (!args.custom_fields || Object.keys(args.custom_fields).length === 0) {
      return buildError("invalid_request", "No custom field values to update.", 400)
    }

    const res = await asanaPut(`/tasks/${args.task}`, { custom_fields: args.custom_fields })
    if (isError(res)) return res
    const customFields = (res.data.custom_fields ?? [])
      .filter((customField: any) => customField.display_value != null)
      .map((customField: any) => ({ name: customField.name, value: customField.display_value }))
    return {
      ok: true,
      task: {
        gid: res.data.gid,
        name: res.data.name,
        custom_fields: customFields,
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function listTaskDependencies(args: { task: string }): Promise<ListTaskDependenciesResult | AsanaErrorShape> {
  try {
    const dependencies = await asanaGetAll(`/tasks/${args.task}/dependencies`, { opt_fields: "name" })
    if (isError(dependencies)) return dependencies
    const dependents = await asanaGetAll(`/tasks/${args.task}/dependents`, { opt_fields: "name" })
    if (isError(dependents)) return dependents
    return {
      ok: true,
      task_gid: args.task,
      dependencies: dependencies.map((task: any) => ({ gid: task.gid, name: task.name })),
      dependents: dependents.map((task: any) => ({ gid: task.gid, name: task.name })),
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function addTaskDependency(args: { task: string; dependency: string }): Promise<TaskDependencyMutationResult | AsanaErrorShape> {
  try {
    const res = await asanaPost(`/tasks/${args.task}/addDependencies`, { dependencies: [args.dependency] })
    if (isError(res)) return res
    return {
      ok: true,
      task_gid: args.task,
      dependency_gid: args.dependency,
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function removeTaskDependency(args: { task: string; dependency: string }): Promise<TaskDependencyMutationResult | AsanaErrorShape> {
  try {
    const res = await asanaPost(`/tasks/${args.task}/removeDependencies`, { dependencies: [args.dependency] })
    if (isError(res)) return res
    return {
      ok: true,
      task_gid: args.task,
      dependency_gid: args.dependency,
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function getProjectStatusUpdates(args: { project: string; limit?: number }): Promise<GetProjectStatusUpdatesResult | AsanaErrorShape> {
  try {
    const limit = Math.min(args.limit ?? 5, 20)
    const res = await asanaGet("/status_updates", {
      parent: args.project,
      opt_fields: "title,text,status_type,created_at,created_by.name",
      limit: String(limit),
    })
    if (isError(res)) return res
    return {
      ok: true,
      project_gid: args.project,
      status_updates: (res.data ?? []).map((update: any) => ({
        gid: update.gid,
        title: update.title,
        text: update.text,
        status_type: update.status_type,
        created_at: update.created_at,
        author: update.created_by?.name ?? null,
      })),
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function createProjectStatusUpdate(args: {
  project: string
  title: string
  text?: string
  html_text?: string
  color?: "green" | "yellow" | "red" | "blue" | "complete"
}): Promise<CreateProjectStatusUpdateResult | AsanaErrorShape> {
  try {
    const hasPlainText = hasText(args.text)
    const hasHtmlText = hasText(args.html_text)
    if (hasPlainText === hasHtmlText) {
      return buildError(
        "invalid_request",
        "Provide exactly one of text or html_text for a project status update.",
        400,
      )
    }

    const colorToStatus: Record<string, string> = {
      green: "on_track",
      yellow: "at_risk",
      red: "off_track",
      blue: "on_hold",
      complete: "complete",
    }
    const body: Record<string, any> = {
      parent: args.project,
      title: args.title,
      status_type: colorToStatus[args.color ?? "green"],
    }
    if (hasPlainText) body.text = args.text.trim()
    if (hasHtmlText) body.html_text = args.html_text.trim()

    const res = await asanaPost("/status_updates", body)
    if (isError(res)) return res
    return {
      ok: true,
      status_update: {
        gid: res.data.gid,
        title: res.data.title,
        status_type: res.data.status_type,
        created_at: res.data.created_at,
      },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function createProject(args: {
  name: string
  notes?: string
  layout?: "list" | "board" | "calendar" | "timeline"
  sections?: string
}): Promise<CreateProjectResult | AsanaErrorShape> {
  try {
    const wsGid = await getWorkspaceGid()
    const teamGid = await getDefaultTeamGid()
    const body: Record<string, any> = {
      name: args.name,
      workspace: wsGid,
      team: teamGid,
      default_view: args.layout ?? "list",
    }
    if (args.notes) body.notes = args.notes

    const res = await asanaPost("/projects", body)
    if (isError(res)) return res
    const projectGid = res.data.gid
    const sectionsCreated: string[] = []

    if (args.sections) {
      const sectionNames = args.sections
        .split(",")
        .map((section) => section.trim())
        .filter((section) => section.length > 0)
      for (const sectionName of sectionNames) {
        const sectionRes = await asanaPost(`/projects/${projectGid}/sections`, { name: sectionName })
        if (!isError(sectionRes)) sectionsCreated.push(sectionName)
      }
    }

    return {
      ok: true,
      project: {
        gid: projectGid,
        name: res.data.name,
        url: `https://app.asana.com/0/${projectGid}`,
      },
      sections_created: sectionsCreated,
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

// ---------------------------------------------------------------------------
// Tag functions
// ---------------------------------------------------------------------------
// Tags in Asana are first-class objects with GIDs. A coding agent's typical
// workflow is: search for an existing tag by name → create it if absent →
// attach/detach it from a task. We expose all four operations as tools so the
// agent can perform each step independently.

export async function getWorkspaceTags(args: { query?: string }): Promise<GetWorkspaceTagsResult | AsanaErrorShape> {
  try {
    const wsGid = await getWorkspaceGid()
    const params: Record<string, string> = { opt_fields: "name", limit: "100" }
    // Asana's /workspaces/{gid}/tags endpoint does not support full-text search;
    // the closest available filter is the typeahead endpoint. We use typeahead
    // when a query is provided and fall back to listing all tags when it is not,
    // so the caller always gets a consistent { ok, tags } shape.
    if (hasText(args.query)) {
      const res = await asanaGet(`/workspaces/${wsGid}/typeahead`, {
        resource_type: "tag",
        query: args.query.trim(),
        count: "20",
        opt_fields: "name",
      })
      if (isError(res)) return res
      return {
        ok: true,
        tags: (res.data ?? []).map((tag: any) => ({ gid: tag.gid, name: tag.name })),
      }
    }

    const tags = await asanaGetAll(`/workspaces/${wsGid}/tags`, params)
    if (isError(tags)) return tags
    return {
      ok: true,
      tags: tags.map((tag: any) => ({ gid: tag.gid, name: tag.name })),
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function createTag(args: { name: string; color?: string }): Promise<CreateTagResult | AsanaErrorShape> {
  try {
    const wsGid = await getWorkspaceGid()
    const body: Record<string, any> = { name: args.name, workspace: wsGid }
    if (hasText(args.color)) body.color = args.color.trim()

    const res = await asanaPost("/tags", body)
    if (isError(res)) return res
    return {
      ok: true,
      tag: { gid: res.data.gid, name: res.data.name },
    }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function addTagToTask(args: { task: string; tag: string }): Promise<TagMutationResult | AsanaErrorShape> {
  try {
    const res = await asanaPost(`/tasks/${args.task}/addTag`, { tag: args.tag })
    if (isError(res)) return res
    return { ok: true, task_gid: args.task, tag_gid: args.tag }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

export async function removeTagFromTask(args: { task: string; tag: string }): Promise<TagMutationResult | AsanaErrorShape> {
  try {
    const res = await asanaPost(`/tasks/${args.task}/removeTag`, { tag: args.tag })
    if (isError(res)) return res
    return { ok: true, task_gid: args.task, tag_gid: args.tag }
  } catch (error: any) {
    return formatCaughtError(error)
  }
}

type SubtaskInput = {
  name: string
  notes?: string
  assignee?: string
  due_on?: string
  due_at?: string
  start_on?: string
  start_at?: string
}

/**
 * Convenience composite: creates a root task in a project, then creates all
 * subtasks under it in sequence. Fails fast if the root task cannot be created.
 * Subtask failures are collected in subtasks_failed rather than aborting the call,
 * so the caller always knows exactly what was and was not created.
 */
export async function createTaskWithSubtasks(args: {
  project: string
  name: string
  notes?: string
  section?: string
  assignee?: string
  due_on?: string
  due_at?: string
  start_on?: string
  start_at?: string
  subtasks: SubtaskInput[]
}): Promise<CreateTaskWithSubtasksResult | AsanaErrorShape> {
  if (!args.subtasks || args.subtasks.length === 0) {
    return buildError(
      "invalid_request",
      "subtasks array must contain at least one item.",
      400,
      "Use create_task instead if you do not need subtasks.",
    )
  }

  const rootResult = await createTask({
    project: args.project,
    name: args.name,
    notes: args.notes,
    section: args.section,
    assignee: args.assignee,
    due_on: args.due_on,
    due_at: args.due_at,
    start_on: args.start_on,
    start_at: args.start_at,
  })
  if (!rootResult.ok) return rootResult

  const subtasks_created: Array<{ gid: string; name: string }> = []
  const subtasks_failed: Array<{ name: string; error: string }> = []

  for (const sub of args.subtasks) {
    const subResult = await createSubtask({ parent: rootResult.task.gid, ...sub })
    if (subResult.ok) {
      subtasks_created.push({ gid: subResult.subtask.gid, name: subResult.subtask.name })
    } else {
      subtasks_failed.push({ name: sub.name, error: subResult.error.message })
    }
  }

  return { ok: true, task: rootResult.task, subtasks_created, subtasks_failed }
}
