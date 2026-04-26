import test from "node:test"
import assert from "node:assert/strict"

import {
  addComment,
  addTaskDependency,
  addTaskToProject,
  listProjectCustomFields,
  listTaskComments,
  removeTaskDependency,
  removeTaskFromProject,
  reorderSection,
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
