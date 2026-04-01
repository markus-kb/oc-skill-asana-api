#!/usr/bin/env bash
set -euo pipefail

if [ -z "${ASANA_PAT:-}" ]; then
  printf 'ASANA_PAT must be set to run skill automation tests\n' >&2
  exit 1
fi

STAMP="skill-$(date +%s)"
PROJECT_NAME="Asana API Skill Automated ${STAMP}"
CREATE_OUT="$(mktemp)"
TASK_OUT="$(mktemp)"
MOVE_OUT="$(mktemp)"
COMMENT_OUT="$(mktemp)"
STATUS_CREATE_OUT="$(mktemp)"
STATUS_GET_OUT="$(mktemp)"

cleanup() {
  rm -f "$CREATE_OUT" "$TASK_OUT" "$MOVE_OUT" "$COMMENT_OUT" "$STATUS_CREATE_OUT" "$STATUS_GET_OUT"
}
trap cleanup EXIT

npx --yes opencode-ai@1.3.10 debug skill > /tmp/opencode-skill-debug.out
if ! grep -q 'asana-api' /tmp/opencode-skill-debug.out; then
  printf 'Skill discovery failed: asana-api not found\n' >&2
  exit 1
fi

npx --yes opencode-ai@1.3.10 run --model openrouter/openai/gpt-5.4 --format json "Load the skill named asana-api and use only asana_api_* tools. Create a new project called '${PROJECT_NAME}' with sections Todo, In Progress, Review, Done." > "$CREATE_OUT"

node --input-type=module - "$CREATE_OUT" <<'EOF'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const path = process.argv[2]
const events = fs.readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
const tools = events.filter((event) => event.type === 'tool_use').map((event) => event.part.tool).filter((name) => name !== 'skill')
assert.deepEqual(tools, ['asana_api_create_project'])
EOF

npx --yes opencode-ai@1.3.10 run --model openrouter/openai/gpt-5.4 --format json "Load the skill named asana-api and use only asana_api_* tools. Create a task called 'Design homepage' in the ${PROJECT_NAME} project, In Progress section." > "$TASK_OUT"

node --input-type=module - "$TASK_OUT" <<'EOF'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const path = process.argv[2]
const events = fs.readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
const tools = events.filter((event) => event.type === 'tool_use').map((event) => event.part.tool).filter((name) => name !== 'skill')
assert.ok(tools.includes('asana_api_find_project'))
assert.ok(tools.includes('asana_api_list_project_sections'))
assert.ok(tools.includes('asana_api_create_task'))
assert.equal(tools.at(-1), 'asana_api_create_task')
EOF

npx --yes opencode-ai@1.3.10 run --model openrouter/openai/gpt-5.4 --format json "Load the skill named asana-api and use only asana_api_* tools. Move the 'Design homepage' task in the ${PROJECT_NAME} project to the Done section." > "$MOVE_OUT"

node --input-type=module - "$MOVE_OUT" <<'EOF'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const path = process.argv[2]
const events = fs.readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
const tools = events.filter((event) => event.type === 'tool_use').map((event) => event.part.tool).filter((name) => name !== 'skill')
assert.ok(tools.includes('asana_api_find_project'))
assert.ok(tools.includes('asana_api_find_tasks'))
assert.ok(tools.includes('asana_api_list_project_sections'))
assert.ok(tools.includes('asana_api_move_task_to_section'))
assert.equal(tools.at(-1), 'asana_api_move_task_to_section')
EOF

npx --yes opencode-ai@1.3.10 run --model openrouter/openai/gpt-5.4 --format json "Load the skill named asana-api and use only asana_api_* tools. Add a comment to the 'Design homepage' task in the ${PROJECT_NAME} project saying 'Completed the initial mockups'." > "$COMMENT_OUT"

node --input-type=module - "$COMMENT_OUT" <<'EOF'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const path = process.argv[2]
const events = fs.readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
const tools = events.filter((event) => event.type === 'tool_use').map((event) => event.part.tool).filter((name) => name !== 'skill')
assert.ok(tools.includes('asana_api_find_project'))
assert.ok(tools.includes('asana_api_find_tasks'))
assert.ok(tools.includes('asana_api_add_comment'))
assert.equal(tools.at(-1), 'asana_api_add_comment')
EOF

npx --yes opencode-ai@1.3.10 run --model openrouter/openai/gpt-5.4 --format json "Load the skill named asana-api and use only asana_api_* tools. Post a weekly status update to the ${PROJECT_NAME} project titled 'Week 14 Update' saying 'Completed the initial mockups and moved the task to Done.'." > "$STATUS_CREATE_OUT"

node --input-type=module - "$STATUS_CREATE_OUT" <<'EOF'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const path = process.argv[2]
const events = fs.readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
const tools = events.filter((event) => event.type === 'tool_use').map((event) => event.part.tool).filter((name) => name !== 'skill')
assert.ok(tools.includes('asana_api_find_project'))
assert.ok(tools.includes('asana_api_create_project_status_update'))
assert.equal(tools.at(-1), 'asana_api_create_project_status_update')
EOF

npx --yes opencode-ai@1.3.10 run --model openrouter/openai/gpt-5.4 --format json "Load the skill named asana-api and use only asana_api_* tools. What's the latest status update on the ${PROJECT_NAME} project?" > "$STATUS_GET_OUT"

node --input-type=module - "$STATUS_GET_OUT" <<'EOF'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const path = process.argv[2]
const events = fs.readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
const tools = events.filter((event) => event.type === 'tool_use').map((event) => event.part.tool).filter((name) => name !== 'skill')
assert.ok(tools.includes('asana_api_find_project'))
assert.ok(tools.includes('asana_api_get_project_status_updates'))
assert.equal(tools.at(-1), 'asana_api_get_project_status_updates')
EOF

printf 'skill automation passed\n'
