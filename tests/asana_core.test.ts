import test from "node:test"
import assert from "node:assert/strict"

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
  isError,
  listProjectSections,
  moveTaskToSection,
  updateTask,
} from "../.opencode/tools/asana-core.ts"

// GIDs are not secrets but are internal identifiers we prefer not to hard-code in public source.
// Read from env vars so the repo can be public without exposing workspace/team identity.
// Returns typed strings; will throw if any var is missing so every test fails fast with a
// clear message rather than with a cryptic Asana API error.
function requireEnv(): { workspaceGid: string; teamGid: string } {
  assert.ok(process.env.ASANA_PAT, "ASANA_PAT must be set to run the automated tests")
  assert.ok(process.env.ASANA_WORKSPACE_GID, "ASANA_WORKSPACE_GID must be set to run the automated tests")
  assert.ok(process.env.ASANA_TEAM_GID, "ASANA_TEAM_GID must be set to run the automated tests")
  return {
    workspaceGid: process.env.ASANA_WORKSPACE_GID,
    teamGid: process.env.ASANA_TEAM_GID,
  }
}

function requirePat() {
  requireEnv()
}

async function asanaRequest(method: string, path: string, body?: Record<string, unknown>) {
  requirePat()

  const response = await fetch(`https://app.asana.com/api/1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.ASANA_PAT}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify({ data: body }) : undefined,
  })
  const json = await response.json().catch(() => ({}))
  assert.ok(response.ok, `Asana request failed: ${response.status} ${JSON.stringify(json)}`)
  return json
}

async function createRawProject(name: string) {
  const { workspaceGid, teamGid } = requireEnv()
  const project = await asanaRequest("POST", "/projects", {
    name,
    workspace: workspaceGid,
    team: teamGid,
    default_view: "list",
  })
  return project.data.gid as string
}

async function createRawSection(projectGid: string, name: string) {
  const section = await asanaRequest("POST", `/projects/${projectGid}/sections`, { name })
  return section.data.gid as string
}

async function createRawTask(input: {
  name: string
  projectGids: string[]
  projectForSection?: string
  sectionGid?: string
  notes?: string
}) {
  const memberships = input.projectForSection && input.sectionGid
    ? [{ project: input.projectForSection, section: input.sectionGid }]
    : undefined

  const task = await asanaRequest("POST", "/tasks", {
    name: input.name,
    notes: input.notes ?? "",
    projects: input.projectGids,
    memberships,
  })
  return task.data.gid as string
}

test("core integration: happy path workflow", async () => {
  requirePat()

  const stamp = `auto-${Date.now()}`
  const projectName = `Asana API Automated Happy ${stamp}`

  const createdProject = await createProject({
    name: projectName,
    notes: "",
    layout: "list",
    sections: "Backlog,In Progress,Done",
  })
  assert.equal(createdProject.ok, true)
  const projectGid = createdProject.project.gid

  const foundProject = await findProject({ name: projectName })
  assert.equal(foundProject.ok, true)
  assert.ok(foundProject.projects.some((project) => project.gid === projectGid))

  const sections = await listProjectSections({ project: projectGid })
  assert.equal(sections.ok, true)
  const backlog = sections.sections.find((section) => section.name === "Backlog")
  const inProgress = sections.sections.find((section) => section.name === "In Progress")
  assert.ok(backlog)
  assert.ok(inProgress)

  const createdTask = await createTask({
    project: projectGid,
    name: "Verify automated custom tools",
    notes: "",
    section: backlog.gid,
    due_on: "2026-04-15",
  })
  assert.equal(createdTask.ok, true)
  const taskGid = createdTask.task.gid

  const taskDetails = await getTask({ task: taskGid })
  assert.equal(taskDetails.ok, true)
  assert.equal(taskDetails.task.section, "Backlog")

  const updatedTask = await updateTask({
    task: taskGid,
    name: "Verify automated custom tools updated",
    due_on: "2026-04-20",
    completed: false,
  })
  assert.equal(updatedTask.ok, true)
  assert.equal(updatedTask.task.name, "Verify automated custom tools updated")

  const subtask = await createSubtask({
    parent: taskGid,
    name: "Confirm subtask creation",
    notes: "",
  })
  assert.equal(subtask.ok, true)
  assert.equal(subtask.subtask.parent.gid, taskGid)

  const movedTask = await moveTaskToSection({
    task: taskGid,
    section: inProgress.gid,
  })
  assert.equal(movedTask.ok, true)
  assert.equal(movedTask.moved.from_section, "Backlog")
  assert.equal(movedTask.moved.to_section, "In Progress")

  const comment = await addComment({
    task: taskGid,
    text: "Automated test comment",
  })
  assert.equal(comment.ok, true)

  const status = await createProjectStatusUpdate({
    project: projectGid,
    title: "Automated Test",
    text: "Happy path passed.",
    color: "green",
  })
  assert.equal(status.ok, true)

  const statuses = await getProjectStatusUpdates({
    project: projectGid,
    limit: 5,
  })
  assert.equal(statuses.ok, true)
  assert.ok(statuses.status_updates.some((update) => update.gid === status.status_update.gid))

  const foundTask = await findTasks({
    project: projectGid,
    query: "Verify automated custom tools updated",
    completed: false,
  })
  assert.equal(foundTask.ok, true)
  assert.ok(foundTask.tasks.some((task) => task.gid === taskGid))
})

test("core integration: failure paths", async () => {
  requirePat()

  const stamp = `failure-${Date.now()}`
  const failureProject = await createProject({
    name: `Asana API Failure Test ${stamp}`,
    notes: "",
    layout: "list",
    sections: "Backlog",
  })
  assert.equal(failureProject.ok, true)
  const failureSections = await listProjectSections({ project: failureProject.project.gid })
  assert.equal(failureSections.ok, true)
  const failureBacklog = failureSections.sections.find((section) => section.name === "Backlog")
  assert.ok(failureBacklog)
  const failureTask = await createTask({
    project: failureProject.project.gid,
    name: `Failure path task ${stamp}`,
    notes: "",
    section: failureBacklog.gid,
  })
  assert.equal(failureTask.ok, true)

  const fakeTask = await getTask({ task: "9999999999999999" })
  assert.equal(fakeTask.ok, false)
  assert.equal(fakeTask.error.code, "not_found")

  const projectMiss = await findProject({ name: "__definitely_not_a_real_project__" })
  assert.equal(projectMiss.ok, true)
  assert.deepEqual(projectMiss.projects, [])

  const invalidDate = await createTask({
    project: failureProject.project.gid,
    name: "Invalid date test",
    due_on: "April 15",
  })
  assert.equal(invalidDate.ok, false)
  assert.equal(invalidDate.error.code, "invalid_request")

  const fakeSection = await moveTaskToSection({
    task: failureTask.task.gid,
    section: "9999999999999999",
  })
  assert.equal(fakeSection.ok, false)
  assert.equal(fakeSection.error.code, "not_found")

  const originalPat = process.env.ASANA_PAT
  delete process.env.ASANA_PAT
  const missingPat = await findProject({ name: "anything" })
  assert.equal(missingPat.ok, false)
  assert.equal(missingPat.error.code, "unauthorized")

  process.env.ASANA_PAT = "garbage"
  const invalidPat = await findProject({ name: "anything" })
  assert.equal(invalidPat.ok, false)
  assert.equal(invalidPat.error.code, "unauthorized")

  process.env.ASANA_PAT = originalPat
})

test("core integration: edge cases", async () => {
  requirePat()

  const stamp = `edge-${Date.now()}`

  const noSectionsProject = await createRawProject(`Asana API Edge No Sections ${stamp}`)
  const noSections = await listProjectSections({ project: noSectionsProject })
  assert.equal(noSections.ok, true)
  assert.equal(noSections.sections.length, 1)
  assert.equal(noSections.sections[0].name, "Untitled section")

  const specialProject = await createRawProject(`Asana API Edge Special ${stamp}`)
  const qaSection = await createRawSection(specialProject, "QA / UAT")
  await createRawSection(specialProject, "Blocked & Waiting")
  const reviewSection = await createRawSection(specialProject, "@Review")
  const specialSections = await listProjectSections({ project: specialProject })
  assert.equal(specialSections.ok, true)
  assert.ok(specialSections.sections.some((section) => section.name === "QA / UAT"))
  assert.ok(specialSections.sections.some((section) => section.name === "Blocked & Waiting"))
  assert.ok(specialSections.sections.some((section) => section.name === "@Review"))

  const longTaskGid = await createRawTask({
    name: `Long task ${stamp} - Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt`,
    notes: "This is a long notes field used by the automated tests to verify round-trip behavior.",
    projectGids: [specialProject],
    projectForSection: specialProject,
    sectionGid: qaSection,
  })
  const longTask = await getTask({ task: longTaskGid })
  assert.equal(longTask.ok, true)
  assert.match(longTask.task.name, /^Long task/)
  assert.match(longTask.task.notes, /round-trip behavior/)

  const multiProjectTaskGid = await createRawTask({
    name: `Multi-project task ${stamp}`,
    projectGids: [specialProject, noSectionsProject],
    projectForSection: specialProject,
    sectionGid: reviewSection,
  })
  const multiProjectTask = await getTask({ task: multiProjectTaskGid })
  assert.equal(multiProjectTask.ok, true)
  assert.equal(multiProjectTask.task.memberships.length, 2)

  const emptySearch = await findTasks({
    project: specialProject,
    query: "__no_match__",
    completed: false,
  })
  assert.equal(emptySearch.ok, true)
  assert.deepEqual(emptySearch.tasks, [])

  const paginationProject = await createRawProject(`Asana API Edge Pagination ${stamp}`)
  const backlogSection = await createRawSection(paginationProject, "Backlog")
  for (let index = 1; index <= 105; index++) {
    await createRawTask({
      name: `Pagination task ${index} ${stamp}`,
      projectGids: [paginationProject],
      projectForSection: paginationProject,
      sectionGid: backlogSection,
    })
  }

  const paginationList = await findTasks({
    project: paginationProject,
    completed: false,
  })
  assert.equal(paginationList.ok, true)
  assert.equal(paginationList.tasks.length, 50)

  const paginationSearch = await findTasks({
    project: paginationProject,
    query: `Pagination task 105 ${stamp}`,
    completed: false,
  })
  assert.equal(paginationSearch.ok, true)
  assert.equal(paginationSearch.tasks.length, 1)
})

test("core integration: error results stay structured", async () => {
  const fakeTask = await getTask({ task: "9999999999999999" })
  assert.equal(isError(fakeTask), true)
})
