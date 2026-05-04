import test from "node:test"
import assert from "node:assert/strict"

import {
  addComment,
  addTagToTask,
  addTaskDependency,
  addTaskToProject,
  createSection,
  createProject,
  createProjectStatusUpdate,
  createSubtask,
  createTag,
  createTask,
  findProject,
  findTasks,
  getProject,
  getProjectStatusUpdates,
  getTask,
  getWorkspaceTags,
  isError,
  listSubtasks,
  listTaskComments,
  listTaskDependencies,
  listProjectSections,
  moveTaskToSection,
  removeTagFromTask,
  removeTaskDependency,
  removeTaskFromProject,
  reorderSection,
  updateProject,
  updateSection,
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

  const htmlStatus = await createProjectStatusUpdate({
    project: projectGid,
    title: "Automated HTML Test",
    html_text: "<body><strong>HTML</strong> path passed.</body>",
    color: "blue",
  })
  assert.equal(htmlStatus.ok, true)
  assert.equal(htmlStatus.status_update.status_type, "on_hold")

  const statuses = await getProjectStatusUpdates({
    project: projectGid,
    limit: 50,
  })
  assert.equal(statuses.ok, true)
  assert.ok(statuses.status_updates.some((update) => update.gid === status.status_update.gid))
  assert.ok(statuses.status_updates.some((update) => update.gid === htmlStatus.status_update.gid))
  assert.ok(statuses.status_updates.every((update) => update.author !== undefined))

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

  const missingStatusProject = await createProjectStatusUpdate({
    project: "9999999999999999",
    title: "Missing project",
    text: "Should fail",
  })
  assert.equal(missingStatusProject.ok, false)
  assert.equal(missingStatusProject.error.code, "not_found")

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

test("core integration: project status updates accept text and html_text", async () => {
  requirePat()

  const stamp = `status-${Date.now()}`
  const project = await createProject({
    name: `Asana API Status ${stamp}`,
    notes: "",
    layout: "list",
  })
  assert.equal(project.ok, true)

  const textStatus = await createProjectStatusUpdate({
    project: project.project.gid,
    title: "Plain text update",
    text: "Plain text path passed.",
    color: "green",
  })
  assert.equal(textStatus.ok, true)
  assert.equal(textStatus.status_update.status_type, "on_track")

  const htmlStatus = await createProjectStatusUpdate({
    project: project.project.gid,
    title: "HTML update",
    html_text: "<body><strong>HTML</strong> path passed.</body>",
    color: "blue",
  })
  assert.equal(htmlStatus.ok, true)
  assert.equal(htmlStatus.status_update.status_type, "on_hold")

  const statuses = await getProjectStatusUpdates({
    project: project.project.gid,
    limit: 50,
  })
  assert.equal(statuses.ok, true)
  assert.ok(statuses.status_updates.length <= 20)
  assert.ok(statuses.status_updates.some((update) => update.gid === textStatus.status_update.gid))
  assert.ok(statuses.status_updates.some((update) => update.gid === htmlStatus.status_update.gid))
  assert.ok(statuses.status_updates.every((update) => update.author !== undefined))
})

test("core integration: expanded project-work helpers", async () => {
  requirePat()

  const stamp = `expand-${Date.now()}`
  const primaryProject = await createProject({
    name: `Asana API Expanded Primary ${stamp}`,
    notes: "Initial notes",
    layout: "list",
    sections: "Backlog,Done",
  })
  assert.equal(primaryProject.ok, true)

  const secondaryProject = await createProject({
    name: `Asana API Expanded Secondary ${stamp}`,
    notes: "",
    layout: "list",
    sections: "Incoming",
  })
  assert.equal(secondaryProject.ok, true)

  const projectDetails = await getProject({ project: primaryProject.project.gid })
  assert.equal(projectDetails.ok, true)
  assert.equal(projectDetails.project.name, primaryProject.project.name)

  const updatedProject = await updateProject({
    project: primaryProject.project.gid,
    notes: "Updated notes for expanded coverage",
    color: "light-blue",
  })
  assert.equal(updatedProject.ok, true)
  assert.match(updatedProject.project.notes, /expanded coverage/)

  const createdSection = await createSection({
    project: primaryProject.project.gid,
    name: "Review",
  })
  assert.equal(createdSection.ok, true)

  const renamedSection = await updateSection({
    section: createdSection.section.gid,
    name: "QA",
  })
  assert.equal(renamedSection.ok, true)
  assert.equal(renamedSection.section.name, "QA")

  const primarySections = await listProjectSections({ project: primaryProject.project.gid })
  assert.equal(primarySections.ok, true)
  const backlog = primarySections.sections.find((section) => section.name === "Backlog")
  assert.ok(backlog)

  const reorderedSection = await reorderSection({
    project: primaryProject.project.gid,
    section: createdSection.section.gid,
    insert_before: backlog.gid,
  })
  assert.equal(reorderedSection.ok, true)

  const reorderedSections = await listProjectSections({ project: primaryProject.project.gid })
  assert.equal(reorderedSections.ok, true)
  const qaIndex = reorderedSections.sections.findIndex((section) => section.name === "QA")
  const backlogIndex = reorderedSections.sections.findIndex((section) => section.name === "Backlog")
  assert.ok(qaIndex >= 0)
  assert.ok(backlogIndex >= 0)
  assert.ok(qaIndex < backlogIndex)

  const createdTask = await createTask({
    project: primaryProject.project.gid,
    name: `Expanded helper task ${stamp}`,
    notes: "Primary task for expanded helper coverage",
    section: backlog.gid,
  })
  assert.equal(createdTask.ok, true)

  const htmlComment = await addComment({
    task: createdTask.task.gid,
    html_text: "<body><strong>Reviewed</strong> and ready.</body>",
  })
  assert.equal(htmlComment.ok, true)

  const comments = await listTaskComments({
    task: createdTask.task.gid,
    limit: 20,
  })
  assert.equal(comments.ok, true)
  assert.ok(comments.comments.some((comment) => comment.gid === htmlComment.comment.gid))

  const subtask = await createSubtask({
    parent: createdTask.task.gid,
    name: `Expanded subtask ${stamp}`,
    notes: "Subtask coverage",
  })
  assert.equal(subtask.ok, true)

  const subtasks = await listSubtasks({ task: createdTask.task.gid })
  assert.equal(subtasks.ok, true)
  assert.ok(subtasks.subtasks.some((item) => item.gid === subtask.subtask.gid))

  const secondarySections = await listProjectSections({ project: secondaryProject.project.gid })
  assert.equal(secondarySections.ok, true)
  const incoming = secondarySections.sections.find((section) => section.name === "Incoming")
  assert.ok(incoming)

  const addedMembership = await addTaskToProject({
    task: createdTask.task.gid,
    project: secondaryProject.project.gid,
    section: incoming.gid,
  })
  assert.equal(addedMembership.ok, true)
  assert.ok(addedMembership.task.memberships.some((membership) => membership.project?.gid === secondaryProject.project.gid))

  const removedMembership = await removeTaskFromProject({
    task: createdTask.task.gid,
    project: secondaryProject.project.gid,
  })
  assert.equal(removedMembership.ok, true)
  assert.ok(!removedMembership.task.memberships.some((membership) => membership.project?.gid === secondaryProject.project.gid))

  const blockerTask = await createTask({
    project: primaryProject.project.gid,
    name: `Expanded blocker ${stamp}`,
    notes: "Dependency coverage",
  })
  assert.equal(blockerTask.ok, true)

  const dependencyAdded = await addTaskDependency({
    task: createdTask.task.gid,
    dependency: blockerTask.task.gid,
  })
  if (!dependencyAdded.ok) {
    assert.equal(dependencyAdded.error.status, 402)
    return
  }

  const dependencies = await listTaskDependencies({ task: createdTask.task.gid })
  assert.equal(dependencies.ok, true)
  assert.ok(dependencies.dependencies.some((dependency) => dependency.gid === blockerTask.task.gid))

  const dependencyRemoved = await removeTaskDependency({
    task: createdTask.task.gid,
    dependency: blockerTask.task.gid,
  })
  assert.equal(dependencyRemoved.ok, true)

  const dependenciesAfterRemoval = await listTaskDependencies({ task: createdTask.task.gid })
  assert.equal(dependenciesAfterRemoval.ok, true)
  assert.ok(!dependenciesAfterRemoval.dependencies.some((dependency) => dependency.gid === blockerTask.task.gid))
})

test("core validation: project status updates require exactly one body field", async () => {
  const missingBody = await createProjectStatusUpdate({
    project: "123",
    title: "Missing body",
  })
  assert.equal(missingBody.ok, false)
  assert.equal(missingBody.error.code, "invalid_request")
  assert.match(missingBody.error.message, /exactly one/i)

  const duplicatedBody = await createProjectStatusUpdate({
    project: "123",
    title: "Duplicate body",
    text: "Plain text",
    html_text: "<body>Rich text</body>",
  })
  assert.equal(duplicatedBody.ok, false)
  assert.equal(duplicatedBody.error.code, "invalid_request")
  assert.match(duplicatedBody.error.message, /exactly one/i)
})

test("core integration: edge cases", async () => {
  requirePat()

  const stamp = `edge-${Date.now()}`

  const noSectionsProject = await createRawProject(`Asana API Edge No Sections ${stamp}`)
  const noSections = await listProjectSections({ project: noSectionsProject })
  assert.equal(noSections.ok, true)
  assert.equal(noSections.sections.length, 1)
  assert.ok(noSections.sections[0].gid)
  assert.match(noSections.sections[0].name, /\S/u)

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

// ---------------------------------------------------------------------------
// Tag integration tests
// ---------------------------------------------------------------------------

test("core integration: tag lifecycle — create, search, attach, detach", async () => {
  requirePat()

  const stamp = `auto-${Date.now()}`
  const tagName = `test-tag-${stamp}`

  // Create a temporary project + task to work with
  const projectGid = await createRawProject(`Asana API Tag Test ${stamp}`)
  const taskGid = await createRawTask({
    name: `Tag lifecycle task ${stamp}`,
    projectGids: [projectGid],
  })

  // 1. Create a new tag
  const createdTag = await createTag({ name: tagName })
  assert.equal(createdTag.ok, true, `createTag failed: ${JSON.stringify(createdTag)}`)
  assert.equal(createdTag.tag.name, tagName)
  const tagGid = createdTag.tag.gid
  assert.ok(tagGid, "expected a tag GID")

  // 2. Search for the tag by name — it should appear in workspace tags
  const tagSearch = await getWorkspaceTags({ query: tagName })
  assert.equal(tagSearch.ok, true, `getWorkspaceTags failed: ${JSON.stringify(tagSearch)}`)
  // The Asana typeahead may return approximate matches; at minimum the list should be non-empty
  assert.ok(tagSearch.tags.length > 0, "expected at least one tag result")

  // 3. Attach the tag to the task
  const addResult = await addTagToTask({ task: taskGid, tag: tagGid })
  assert.equal(addResult.ok, true, `addTagToTask failed: ${JSON.stringify(addResult)}`)
  assert.equal(addResult.task_gid, taskGid)
  assert.equal(addResult.tag_gid, tagGid)

  // Verify the tag now appears on the task via the raw API
  const taskAfterAdd = await asanaRequest("GET", `/tasks/${taskGid}?opt_fields=tags.name,tags.gid`)
  const attachedTags: Array<{ gid: string; name: string }> = taskAfterAdd.data?.tags ?? []
  assert.ok(
    attachedTags.some((t) => t.gid === tagGid),
    `expected tag ${tagGid} to be on task after addTagToTask`,
  )

  // 4. Detach the tag from the task
  const removeResult = await removeTagFromTask({ task: taskGid, tag: tagGid })
  assert.equal(removeResult.ok, true, `removeTagFromTask failed: ${JSON.stringify(removeResult)}`)
  assert.equal(removeResult.task_gid, taskGid)
  assert.equal(removeResult.tag_gid, tagGid)

  // Verify the tag is gone from the task
  const taskAfterRemove = await asanaRequest("GET", `/tasks/${taskGid}?opt_fields=tags.name,tags.gid`)
  const remainingTags: Array<{ gid: string; name: string }> = taskAfterRemove.data?.tags ?? []
  assert.ok(
    !remainingTags.some((t) => t.gid === tagGid),
    `expected tag ${tagGid} to be removed from task after removeTagFromTask`,
  )

  // Cleanup: delete the tag via raw API (no delete tool exists; this is fine for test teardown)
  await asanaRequest("DELETE", `/tags/${tagGid}`)
})

test("core integration: createTag with color stores color on the tag", async () => {
  requirePat()

  const stamp = `auto-${Date.now()}`
  const tagName = `colored-tag-${stamp}`

  const result = await createTag({ name: tagName, color: "dark-green" })
  assert.equal(result.ok, true, `createTag with color failed: ${JSON.stringify(result)}`)
  assert.equal(result.tag.name, tagName)

  // Verify color via raw API
  const raw = await asanaRequest("GET", `/tags/${result.tag.gid}?opt_fields=name,color`)
  assert.equal(raw.data.color, "dark-green")

  // Cleanup
  await asanaRequest("DELETE", `/tags/${result.tag.gid}`)
})

test("core integration: getWorkspaceTags returns list without query", async () => {
  requirePat()

  const result = await getWorkspaceTags({})
  assert.equal(result.ok, true, `getWorkspaceTags failed: ${JSON.stringify(result)}`)
  // Every workspace should have at least some tags, but we only assert shape
  assert.ok(Array.isArray(result.tags))
  if (result.tags.length > 0) {
    assert.ok(typeof result.tags[0].gid === "string")
    assert.ok(typeof result.tags[0].name === "string")
  }
})
