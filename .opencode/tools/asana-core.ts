const BASE_URL = "https://app.asana.com/api/1.0"
const MAX_RETRIES = 3

export interface AsanaErrorShape {
  ok: false
  error: {
    code: string
    message: string
    status: number
  }
}

export function buildError(
  code: string,
  message: string,
  status: number,
): AsanaErrorShape {
  return { ok: false, error: { code, message, status } }
}

function getPat(): string {
  // Priority: 1) OpenCode config substitution ({file:...}, {env:...}, or direct value), 2) Direct ASANA_PAT env var
  // OpenCode resolves {file:...}, {env:...}, and direct values in opencode.json and sets ASANA_PAT env var
  const pat = process.env.ASANA_PAT
  if (!pat) {
    throw buildError(
      "unauthorized",
      "ASANA_PAT not configured. Set it in opencode.json using {file:...}, {env:...}, or a direct value; or set the ASANA_PAT environment variable directly.",
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
  const requestParams = { ...params, limit: "100" }

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
type AddCommentResult = { ok: true; comment: { gid: string; task: { gid: string; name: string | null }; text: string; created_at: string } }
type GetProjectStatusUpdatesResult = { ok: true; project_gid: string; status_updates: Array<{ gid: string; title: string; text: string; status_type: string; created_at: string; author: string | null }> }
type CreateProjectStatusUpdateResult = { ok: true; status_update: { gid: string; title: string; status_type: string; created_at: string } }
type CreateProjectResult = { ok: true; project: { gid: string; name: string; url: string }; sections_created: string[] }

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
        const fallback = await asanaGetAll(`/projects/${args.project}/tasks`, { opt_fields: optFields })
        if (isError(fallback)) return fallback
        const query = args.query.toLowerCase()
        rawTasks = fallback.filter((task: any) => task.name?.toLowerCase().includes(query))
      } else {
        rawTasks = res.data ?? []
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
}): Promise<CreateTaskResult | AsanaErrorShape> {
  try {
    if (args.due_on && !/^\d{4}-\d{2}-\d{2}$/.test(args.due_on)) {
      return buildError("invalid_request", `Invalid due_on format "${args.due_on}". Expected YYYY-MM-DD.`, 400)
    }

    const body: Record<string, any> = { name: args.name, projects: [args.project] }
    if (args.notes !== undefined) body.notes = args.notes
    if (hasText(args.assignee)) body.assignee = args.assignee
    if (hasText(args.due_on)) body.due_on = args.due_on
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
  completed?: boolean
}): Promise<UpdateTaskResult | AsanaErrorShape> {
  try {
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
}): Promise<CreateSubtaskResult | AsanaErrorShape> {
  try {
    if (args.due_on && !/^\d{4}-\d{2}-\d{2}$/.test(args.due_on)) {
      return buildError("invalid_request", `Invalid due_on format "${args.due_on}". Expected YYYY-MM-DD.`, 400)
    }

    const body: Record<string, any> = { name: args.name }
    if (args.notes !== undefined) body.notes = args.notes
    if (hasText(args.assignee)) body.assignee = args.assignee
    if (hasText(args.due_on)) body.due_on = args.due_on

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

export async function addComment(args: { task: string; text: string }): Promise<AddCommentResult | AsanaErrorShape> {
  try {
    const res = await asanaPost(`/tasks/${args.task}/stories`, { text: args.text })
    if (isError(res)) return res
    const taskRes = await asanaGet(`/tasks/${args.task}`, { opt_fields: "name" })
    return {
      ok: true,
      comment: {
        gid: res.data.gid,
        task: { gid: args.task, name: taskRes.data?.name ?? null },
        text: res.data.text,
        created_at: res.data.created_at,
      },
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
  text: string
  color?: "green" | "yellow" | "red" | "blue" | "complete"
}): Promise<CreateProjectStatusUpdateResult | AsanaErrorShape> {
  try {
    const colorToStatus: Record<string, string> = {
      green: "on_track",
      yellow: "at_risk",
      red: "off_track",
      blue: "on_hold",
      complete: "complete",
    }
    const res = await asanaPost("/status_updates", {
      parent: args.project,
      title: args.title,
      text: args.text,
      status_type: colorToStatus[args.color ?? "green"],
    })
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
