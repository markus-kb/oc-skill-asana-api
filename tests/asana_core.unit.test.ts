import test from "node:test"
import assert from "node:assert/strict"

import {
  addComment,
  addTagToTask,
  addTaskDependency,
  addTaskToProject,
  buildError,
  createTag,
  createTask,
  createSubtask,
  createTaskWithSubtasks,
  getWorkspaceTags,
  listProjectCustomFields,
  listTaskComments,
  removeTagFromTask,
  removeTaskDependency,
  removeTaskFromProject,
  reorderSection,
  updateTask,
  updateTaskCustomFields,
} from "../.opencode/tools/asana-core.ts"

type FetchCall = {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

function createJsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers?.[name] ?? null
      },
    },
    async json() {
      return body
    },
  }
}

async function withMockFetch(
  responder: (call: FetchCall) => ReturnType<typeof createJsonResponse> | Promise<ReturnType<typeof createJsonResponse>>,
  run: (calls: FetchCall[]) => Promise<void>,
) {
  const originalPat = process.env.ASANA_PAT
  const originalFetch = global.fetch
  const calls: FetchCall[] = []

  process.env.ASANA_PAT = "unit-test-pat"
  global.fetch = (async (url: string, init?: RequestInit) => {
    const call: FetchCall = {
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    return responder(call) as never
  }) as typeof fetch

  try {
    await run(calls)
  } finally {
    process.env.ASANA_PAT = originalPat
    global.fetch = originalFetch
  }
}

test("unit: addComment requires exactly one body field and supports html_text", async () => {
  const missingBody = await addComment({ task: "task-1" })
  assert.equal(missingBody.ok, false)
  assert.equal(missingBody.error.code, "invalid_request")

  const duplicateBody = await addComment({
    task: "task-1",
    text: "plain",
    html_text: "<body>rich</body>",
  })
  assert.equal(duplicateBody.ok, false)
  assert.equal(duplicateBody.error.code, "invalid_request")

  await withMockFetch(
    async (call) => {
      if (call.url.endsWith("/tasks/task-1/stories")) {
        return createJsonResponse(200, {
          data: { gid: "story-1", text: "Rendered html", created_at: "2026-04-23T00:00:00.000Z" },
        })
      }
      return createJsonResponse(200, { data: { name: "Task One" } })
    },
    async (calls) => {
      const result = await addComment({
        task: "task-1",
        html_text: "<body><strong>Done</strong></body>",
      })
      assert.equal(result.ok, true)
      assert.equal(result.comment.gid, "story-1")
      assert.deepEqual(calls[0].body, { data: { html_text: "<body><strong>Done</strong></body>" } })
    },
  )
})

test("unit: listTaskComments filters non-comment stories", async () => {
  await withMockFetch(
    async () => createJsonResponse(200, {
      data: [
        {
          gid: "story-1",
          resource_subtype: "comment_added",
          text: "Plain comment",
          created_at: "2026-04-23T00:00:00.000Z",
          created_by: { name: "Alex" },
        },
        {
          gid: "story-2",
          resource_subtype: "section_changed",
          text: "Moved to Done",
          created_at: "2026-04-23T00:01:00.000Z",
          created_by: { name: "System" },
        },
      ],
    }),
    async (calls) => {
      const result = await listTaskComments({ task: "task-1", limit: 50 })
      assert.equal(result.ok, true)
      assert.equal(result.comments.length, 1)
      assert.equal(result.comments[0].gid, "story-1")
      assert.match(calls[0].url, /limit=20/)
    },
  )
})

test("unit: reorderSection validates anchor choice and shapes request", async () => {
  const invalid = await reorderSection({ project: "proj-1", section: "sec-2" })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, "invalid_request")

  const duplicate = await reorderSection({
    project: "proj-1",
    section: "sec-2",
    insert_before: "sec-1",
    insert_after: "sec-3",
  })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error.code, "invalid_request")

  await withMockFetch(
    async (call) => {
      if (call.url.endsWith("/projects/proj-1/sections/insert")) return createJsonResponse(200, { data: {} })
      return createJsonResponse(200, { data: { name: "Review" } })
    },
    async (calls) => {
      const result = await reorderSection({
        project: "proj-1",
        section: "sec-2",
        insert_before: "sec-1",
      })
      assert.equal(result.ok, true)
      assert.deepEqual(calls[0].body, {
        data: { section: "sec-2", before_section: "sec-1" },
      })
    },
  )
})

test("unit: task project membership helpers use addProject/removeProject", async () => {
  await withMockFetch(
    async (call) => {
      if (call.url.endsWith("/addProject") || call.url.endsWith("/removeProject")) return createJsonResponse(200, { data: {} })
      return createJsonResponse(200, {
        data: {
          gid: "task-1",
          name: "Task One",
          memberships: [
            { project: { gid: "proj-1", name: "Alpha" }, section: { gid: "sec-1", name: "Backlog" } },
          ],
        },
      })
    },
    async (calls) => {
      const added = await addTaskToProject({ task: "task-1", project: "proj-1", section: "sec-1" })
      assert.equal(added.ok, true)
      assert.deepEqual(calls[0].body, { data: { project: "proj-1", section: "sec-1" } })

      const removed = await removeTaskFromProject({ task: "task-1", project: "proj-1" })
      assert.equal(removed.ok, true)
      assert.deepEqual(calls[2].body, { data: { project: "proj-1" } })
    },
  )
})

test("unit: dependency helpers use dependency mutation endpoints", async () => {
  await withMockFetch(
    async (call) => {
      if (call.url.endsWith("/dependencies")) {
        return createJsonResponse(200, { data: [{ gid: "task-2", name: "Blocked by task" }] })
      }
      if (call.url.endsWith("/addDependencies") || call.url.endsWith("/removeDependencies")) {
        return createJsonResponse(200, { data: {} })
      }
      return createJsonResponse(200, { data: [] })
    },
    async (calls) => {
      const added = await addTaskDependency({ task: "task-1", dependency: "task-2" })
      assert.equal(added.ok, true)
      assert.deepEqual(calls[0].body, { data: { dependencies: ["task-2"] } })

      const removed = await removeTaskDependency({ task: "task-1", dependency: "task-2" })
      assert.equal(removed.ok, true)
      assert.deepEqual(calls[1].body, { data: { dependencies: ["task-2"] } })
    },
  )
})

test("unit: listProjectCustomFields maps enum options and updateTaskCustomFields validates input", async () => {
  const invalid = await updateTaskCustomFields({ task: "task-1", custom_fields: {} })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, "invalid_request")

  await withMockFetch(
    async (call) => {
      if (call.method === "GET") {
        return createJsonResponse(200, {
          data: [
            {
              gid: "setting-1",
              is_important: true,
              custom_field: {
                gid: "field-1",
                name: "Priority",
                resource_subtype: "enum",
                enum_options: [
                  { gid: "enum-1", name: "High" },
                  { gid: "enum-2", name: "Low" },
                ],
              },
            },
          ],
        })
      }
      return createJsonResponse(200, {
        data: {
          gid: "task-1",
          name: "Task One",
          custom_fields: [
            { name: "Priority", display_value: "High" },
          ],
        },
      })
    },
    async (calls) => {
      const fields = await listProjectCustomFields({ project: "proj-1" })
      assert.equal(fields.ok, true)
      assert.equal(fields.custom_fields[0].enum_options?.[0].gid, "enum-1")

      const updated = await updateTaskCustomFields({
        task: "task-1",
        custom_fields: { "field-1": "enum-1" },
      })
      assert.equal(updated.ok, true)
      assert.deepEqual(calls[1].body, {
        data: { custom_fields: { "field-1": "enum-1" } },
      })
    },
  )
})

// ---------------------------------------------------------------------------
// Tag unit tests
// ---------------------------------------------------------------------------

test("unit: getWorkspaceTags resolves workspace and forwards optional query param", async () => {
  await withMockFetch(
    async (call) => {
      // First call: resolve workspace GID via /users/me
      if (call.url.endsWith("/users/me")) {
        return createJsonResponse(200, {
          data: { workspaces: [{ gid: "ws-1" }] },
        })
      }
      // Second call: typeahead for tags (used when query is present)
      return createJsonResponse(200, {
        data: [
          { gid: "tag-1", name: "urgent" },
          { gid: "tag-2", name: "blocked" },
        ],
      })
    },
    async (calls) => {
      const result = await getWorkspaceTags({ query: "urg" })
      assert.equal(result.ok, true)
      assert.equal(result.tags.length, 2)
      assert.equal(result.tags[0].gid, "tag-1")
      assert.equal(result.tags[0].name, "urgent")
      // When a query is given, implementation uses the typeahead endpoint
      const typeaheadCall = calls.find((c) => c.url.includes("/typeahead"))
      assert.ok(typeaheadCall, "expected a GET to typeahead endpoint")
      assert.ok(
        typeaheadCall.url.includes("ws-1"),
        "expected workspace GID in typeahead URL",
      )
      assert.ok(
        typeaheadCall.url.includes("resource_type=tag"),
        "expected resource_type=tag in typeahead URL",
      )
      assert.ok(
        typeaheadCall.url.includes("query=urg"),
        "expected query param forwarded in typeahead URL",
      )
    },
  )
})

test("unit: getWorkspaceTags with no query returns all tags", async () => {
  await withMockFetch(
    async (call) => {
      if (call.url.endsWith("/users/me")) {
        return createJsonResponse(200, { data: { workspaces: [{ gid: "ws-1" }] } })
      }
      return createJsonResponse(200, { data: [{ gid: "tag-3", name: "review" }] })
    },
    async () => {
      const result = await getWorkspaceTags({})
      assert.equal(result.ok, true)
      assert.equal(result.tags[0].name, "review")
    },
  )
})

test("unit: createTag posts to /tags with workspace GID and returns tag", async () => {
  await withMockFetch(
    async (call) => {
      if (call.url.endsWith("/users/me")) {
        return createJsonResponse(200, { data: { workspaces: [{ gid: "ws-1" }] } })
      }
      return createJsonResponse(201, { data: { gid: "tag-99", name: "new-tag" } })
    },
    async (calls) => {
      const result = await createTag({ name: "new-tag" })
      assert.equal(result.ok, true)
      assert.equal(result.tag.gid, "tag-99")
      assert.equal(result.tag.name, "new-tag")

      const postCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/tags"))
      assert.ok(postCall, "expected POST /tags")
      assert.deepEqual(postCall.body, { data: { name: "new-tag", workspace: "ws-1" } })
    },
  )
})

test("unit: createTag includes color when provided", async () => {
  await withMockFetch(
    async (call) => {
      if (call.url.endsWith("/users/me")) {
        return createJsonResponse(200, { data: { workspaces: [{ gid: "ws-1" }] } })
      }
      return createJsonResponse(201, { data: { gid: "tag-88", name: "hot" } })
    },
    async (calls) => {
      const result = await createTag({ name: "hot", color: "dark-red" })
      assert.equal(result.ok, true)
      const postCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/tags"))
      assert.ok(postCall)
      assert.deepEqual(postCall.body, {
        data: { name: "hot", workspace: "ws-1", color: "dark-red" },
      })
    },
  )
})

test("unit: addTagToTask posts to /tasks/{gid}/addTag with tag GID in body", async () => {
  await withMockFetch(
    async () => createJsonResponse(200, { data: {} }),
    async (calls) => {
      const result = await addTagToTask({ task: "task-1", tag: "tag-99" })
      assert.equal(result.ok, true)
      assert.equal(result.task_gid, "task-1")
      assert.equal(result.tag_gid, "tag-99")

      assert.equal(calls.length, 1)
      assert.ok(calls[0].url.endsWith("/tasks/task-1/addTag"))
      assert.equal(calls[0].method, "POST")
      assert.deepEqual(calls[0].body, { data: { tag: "tag-99" } })
    },
  )
})

test("unit: addTagToTask propagates API error", async () => {
  await withMockFetch(
    async () => createJsonResponse(404, { errors: [{ message: "task not found" }] }),
    async () => {
      const result = await addTagToTask({ task: "bad-task", tag: "tag-1" })
      assert.equal(result.ok, false)
      assert.equal(result.error.code, "not_found")
    },
  )
})

test("unit: removeTagFromTask posts to /tasks/{gid}/removeTag with tag GID in body", async () => {
  await withMockFetch(
    async () => createJsonResponse(200, { data: {} }),
    async (calls) => {
      const result = await removeTagFromTask({ task: "task-1", tag: "tag-99" })
      assert.equal(result.ok, true)
      assert.equal(result.task_gid, "task-1")
      assert.equal(result.tag_gid, "tag-99")

      assert.equal(calls.length, 1)
      assert.ok(calls[0].url.endsWith("/tasks/task-1/removeTag"))
      assert.equal(calls[0].method, "POST")
      assert.deepEqual(calls[0].body, { data: { tag: "tag-99" } })
    },
  )
})

test("unit: removeTagFromTask propagates API error", async () => {
  await withMockFetch(
    async () => createJsonResponse(403, { errors: [{ message: "forbidden" }] }),
    async () => {
      const result = await removeTagFromTask({ task: "task-1", tag: "tag-1" })
      assert.equal(result.ok, false)
      assert.equal(result.error.code, "forbidden")
    },
  )
})

// ---------------------------------------------------------------------------
// date field unit tests
// ---------------------------------------------------------------------------

test("unit: createTask accepts due_at (ISO datetime) and forwards it", async () => {
  await withMockFetch(
    async () => createJsonResponse(201, {
      data: { gid: "task-1", name: "T", memberships: [] },
    }),
    async (calls) => {
      const result = await createTask({
        project: "proj-1",
        name: "T",
        due_at: "2026-06-01T09:00:00.000Z",
      })
      assert.equal(result.ok, true)
      assert.equal(calls[0].body?.data?.due_at, "2026-06-01T09:00:00.000Z")
      assert.equal(calls[0].body?.data?.due_on, undefined)
    },
  )
})

test("unit: createTask rejects both due_on and due_at together", async () => {
  const result = await createTask({
    project: "proj-1",
    name: "T",
    due_on: "2026-06-01",
    due_at: "2026-06-01T09:00:00.000Z",
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "invalid_request")
  // suggestion must be present and mention the XOR constraint
  assert.ok(result.error.suggestion, "expected a suggestion")
  assert.match(result.error.suggestion, /due_on.*due_at|due_at.*due_on/i)
})

test("unit: createTask accepts start_on and forwards it", async () => {
  await withMockFetch(
    async () => createJsonResponse(201, {
      data: { gid: "task-1", name: "T", memberships: [] },
    }),
    async (calls) => {
      const result = await createTask({
        project: "proj-1",
        name: "T",
        start_on: "2026-05-01",
        due_on: "2026-06-01",
      })
      assert.equal(result.ok, true)
      assert.equal(calls[0].body?.data?.start_on, "2026-05-01")
    },
  )
})

test("unit: createTask rejects both start_on and start_at together", async () => {
  const result = await createTask({
    project: "proj-1",
    name: "T",
    start_on: "2026-05-01",
    start_at: "2026-05-01T08:00:00.000Z",
    due_on: "2026-06-01",
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "invalid_request")
  assert.ok(result.error.suggestion)
})

test("unit: updateTask accepts due_at and clears it with null", async () => {
  await withMockFetch(
    async () => createJsonResponse(200, {
      data: { gid: "task-1", name: "T", completed: false, assignee: null, due_on: null, due_at: null },
    }),
    async (calls) => {
      const setResult = await updateTask({ task: "task-1", due_at: "2026-06-01T09:00:00.000Z" })
      assert.equal(setResult.ok, true)
      assert.equal(calls[0].body?.data?.due_at, "2026-06-01T09:00:00.000Z")

      const clearResult = await updateTask({ task: "task-1", due_at: "null" })
      assert.equal(clearResult.ok, true)
      assert.equal(calls[1].body?.data?.due_at, null)
    },
  )
})

test("unit: updateTask rejects both due_on and due_at", async () => {
  const result = await updateTask({
    task: "task-1",
    due_on: "2026-06-01",
    due_at: "2026-06-01T09:00:00.000Z",
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "invalid_request")
  assert.ok(result.error.suggestion)
})

test("unit: updateTask accepts start_on and start_at independently", async () => {
  await withMockFetch(
    async () => createJsonResponse(200, {
      data: { gid: "task-1", name: "T", completed: false, assignee: null, due_on: null },
    }),
    async (calls) => {
      await updateTask({ task: "task-1", start_on: "2026-05-01", due_on: "2026-06-01" })
      assert.equal(calls[0].body?.data?.start_on, "2026-05-01")

      await updateTask({ task: "task-1", start_at: "2026-05-01T08:00:00.000Z", due_at: "2026-06-01T08:00:00.000Z" })
      assert.equal(calls[1].body?.data?.start_at, "2026-05-01T08:00:00.000Z")
    },
  )
})

test("unit: createSubtask accepts start_on and due_at", async () => {
  await withMockFetch(
    async (call) => {
      if (call.url.includes("/subtasks")) {
        return createJsonResponse(201, { data: { gid: "sub-1", name: "Sub" } })
      }
      return createJsonResponse(200, { data: { gid: "task-1", name: "Parent" } })
    },
    async (calls) => {
      const result = await createSubtask({
        parent: "task-1",
        name: "Sub",
        start_on: "2026-05-15",
        due_at: "2026-06-01T17:00:00.000Z",
      })
      assert.equal(result.ok, true)
      const postCall = calls.find((c) => c.url.includes("/subtasks"))
      assert.equal(postCall?.body?.data?.start_on, "2026-05-15")
      assert.equal(postCall?.body?.data?.due_at, "2026-06-01T17:00:00.000Z")
    },
  )
})

// ---------------------------------------------------------------------------
// createTaskWithSubtasks unit tests
// ---------------------------------------------------------------------------

test("unit: createTaskWithSubtasks creates root task then subtasks in sequence", async () => {
  await withMockFetch(
    async (call) => {
      if (call.method === "POST" && call.url.endsWith("/tasks")) {
        return createJsonResponse(201, {
          data: { gid: "task-new", name: "Root", memberships: [{ project: { name: "P" }, section: { name: "S" } }] },
        })
      }
      if (call.url.includes("/subtasks")) {
        return createJsonResponse(201, { data: { gid: "sub-new", name: call.body?.data?.name } })
      }
      return createJsonResponse(200, { data: { gid: "task-new", name: "Root" } })
    },
    async (calls) => {
      const result = await createTaskWithSubtasks({
        project: "proj-1",
        name: "Root",
        subtasks: [{ name: "Sub A" }, { name: "Sub B" }],
      })
      assert.equal(result.ok, true)
      assert.equal(result.task.gid, "task-new")
      assert.equal(result.subtasks_created.length, 2)
      assert.equal(result.subtasks_created[0].name, "Sub A")
      assert.equal(result.subtasks_created[1].name, "Sub B")

      const rootPost = calls.find((c) => c.method === "POST" && c.url.endsWith("/tasks"))
      assert.ok(rootPost, "expected POST /tasks for root task")
      const subtaskPosts = calls.filter((c) => c.url.includes("/subtasks"))
      assert.equal(subtaskPosts.length, 2)
    },
  )
})

test("unit: createTaskWithSubtasks fails fast if root task creation fails", async () => {
  await withMockFetch(
    async () => createJsonResponse(400, { errors: [{ message: "bad request" }] }),
    async () => {
      const result = await createTaskWithSubtasks({
        project: "proj-1",
        name: "Root",
        subtasks: [{ name: "Sub A" }],
      })
      assert.equal(result.ok, false)
      assert.equal(result.error.code, "invalid_request")
    },
  )
})

test("unit: createTaskWithSubtasks requires at least one subtask", async () => {
  const result = await createTaskWithSubtasks({
    project: "proj-1",
    name: "Root",
    subtasks: [],
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "invalid_request")
  assert.ok(result.error.suggestion)
})

// ---------------------------------------------------------------------------
// suggestion field unit tests
// ---------------------------------------------------------------------------

test("unit: buildError can carry a suggestion field", () => {
  const err = buildError("invalid_request", "bad input", 400, "use foo instead of bar")
  assert.equal(err.ok, false)
  assert.equal(err.error.suggestion, "use foo instead of bar")
})

test("unit: buildError suggestion is omitted when not provided", () => {
  const err = buildError("invalid_request", "bad input", 400)
  assert.equal(err.ok, false)
  assert.equal(err.error.suggestion, undefined)
})

test("unit: validateExactlyOneTextBody error carries suggestion", async () => {
  const result = await addComment({ task: "task-1" })
  assert.equal(result.ok, false)
  assert.ok(result.error.suggestion, "expected a suggestion on missing body error")
})

test("unit: reorderSection error carries suggestion", async () => {
  const result = await reorderSection({ project: "proj-1", section: "sec-1" })
  assert.equal(result.ok, false)
  assert.ok(result.error.suggestion, "expected a suggestion on missing anchor error")
})
