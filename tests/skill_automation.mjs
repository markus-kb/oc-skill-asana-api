import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

import { DEFAULT_OPENCODE_MODEL, createSessionRunner } from './opencode_session.mjs'
import { ensureAsanaProjectEnv } from './asana_test_env.mjs'

const OPENCODE_VERSION = process.env.OPENCODE_VERSION ?? 'opencode-ai@1.3.10'
const OPENCODE_MODEL = process.env.OPENCODE_MODEL ?? DEFAULT_OPENCODE_MODEL
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join('\n') || `${command} exited with code ${result.status}`,
  )
  return result.stdout
}

function parseEvents(output) {
  return output
    .replace(/^\ufeff/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function getTools(output) {
  return parseEvents(output)
    .filter((event) => event.type === 'tool_use')
    .map((event) => event.part.tool)
    .filter((name) => name !== 'skill')
}

function getToolOutput(output, toolName) {
  const event = parseEvents(output).find((item) => item.type === 'tool_use' && item.part.tool === toolName)
  assert.ok(event, `Expected tool output for ${toolName}`)
  return JSON.parse(event.part.state.output)
}

function assertToolUsed(output, toolName) {
  const tools = getTools(output)
  assert.ok(tools.includes(toolName), `Expected ${toolName}, got ${tools.join(', ')}`)
}

const env = await ensureAsanaProjectEnv(process.env)
assert.ok(env.ASANA_PAT, 'ASANA_PAT must be set to run skill automation tests')

const debugOutput = run(NPX, ['--yes', OPENCODE_VERSION, 'debug', 'skill'], env)
assert.match(debugOutput, /asana-api/, 'Skill discovery failed: asana-api not found')

const stamp = `skill-${Date.now()}`
const projectName = `Asana API Skill Automated ${stamp}`
const sessionRunner = createSessionRunner({
  command: NPX,
  version: OPENCODE_VERSION,
  model: OPENCODE_MODEL,
  env,
  runCli: run,
})

try {
  const createProjectOutput = sessionRunner.start(
    `Load the skill named asana-api and use only asana_api_* tools. Create a new project called '${projectName}' with sections Todo, In Progress, Review, Done.`,
    `skill-automation-${stamp}`,
  )
  assertToolUsed(createProjectOutput, 'asana_api_create_project')
  const projectGid = getToolOutput(createProjectOutput, 'asana_api_create_project').project.gid

  const primarySectionsOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_list_project_sections for project GID ${projectGid}.`,
  )
  assertToolUsed(primarySectionsOutput, 'asana_api_list_project_sections')
  const primarySections = getToolOutput(primarySectionsOutput, 'asana_api_list_project_sections').sections
  const inProgressSectionGid = primarySections.find((section) => section.name === 'In Progress')?.gid
  const reviewSectionGid = primarySections.find((section) => section.name === 'Review')?.gid
  assert.ok(inProgressSectionGid)
  assert.ok(reviewSectionGid)

  const createTaskOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Create a task called 'Design homepage' in the ${projectName} project, In Progress section.`,
  )
  {
    const tools = getTools(createTaskOutput)
    assert.ok(tools.includes('asana_api_create_task'))
    assert.equal(tools.at(-1), 'asana_api_create_task')
  }
  const designTaskGid = getToolOutput(createTaskOutput, 'asana_api_create_task').task.gid

  const createSubtaskOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Create a subtask called 'Finalize color palette' under the 'Design homepage' task in the ${projectName} project.`,
  )
  {
    const tools = getTools(createSubtaskOutput)
    assert.ok(tools.includes('asana_api_create_subtask'))
    assert.equal(tools.at(-1), 'asana_api_create_subtask')
  }

  const listSubtasksOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_list_subtasks for task GID ${designTaskGid}.`,
  )
  {
    assertToolUsed(listSubtasksOutput, 'asana_api_list_subtasks')
  }

  const moveTaskOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Move the 'Design homepage' task in the ${projectName} project to the Done section.`,
  )
  {
    const tools = getTools(moveTaskOutput)
    assert.ok(tools.includes('asana_api_move_task_to_section'))
    assert.equal(tools.at(-1), 'asana_api_move_task_to_section')
  }

  const commentOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Add a comment to the 'Design homepage' task in the ${projectName} project saying 'Completed the initial mockups'.`,
  )
  {
    const tools = getTools(commentOutput)
    assert.ok(tools.includes('asana_api_add_comment'))
    assert.equal(tools.at(-1), 'asana_api_add_comment')
  }

  const listCommentsOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_list_task_comments for task GID ${designTaskGid}.`,
  )
  {
    assertToolUsed(listCommentsOutput, 'asana_api_list_task_comments')
  }

  const getProjectOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_get_project for project GID ${projectGid}.`,
  )
  {
    assertToolUsed(getProjectOutput, 'asana_api_get_project')
  }

  const updateProjectOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_update_project to update project GID ${projectGid} so its notes are 'Launch prep underway' and its color is light-blue.`,
  )
  {
    assertToolUsed(updateProjectOutput, 'asana_api_update_project')
  }

  const createSectionOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_create_section to create a section called UAT in project GID ${projectGid}.`,
  )
  {
    assertToolUsed(createSectionOutput, 'asana_api_create_section')
  }
  const uatSectionGid = getToolOutput(createSectionOutput, 'asana_api_create_section').section.gid

  const updateSectionOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_update_section to rename section GID ${uatSectionGid} to QA.`,
  )
  {
    assertToolUsed(updateSectionOutput, 'asana_api_update_section')
  }

  const reorderSectionOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_reorder_section to move section GID ${uatSectionGid} before section GID ${reviewSectionGid} in project GID ${projectGid}.`,
  )
  {
    assertToolUsed(reorderSectionOutput, 'asana_api_reorder_section')
  }

  const customFieldsOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_list_project_custom_fields for project GID ${projectGid}.`,
  )
  {
    assertToolUsed(customFieldsOutput, 'asana_api_list_project_custom_fields')
  }

  const createSatelliteProjectOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Create a new project called '${projectName} Satellite' with sections Incoming and Done.`,
  )
  assertToolUsed(createSatelliteProjectOutput, 'asana_api_create_project')
  const satelliteProjectGid = getToolOutput(createSatelliteProjectOutput, 'asana_api_create_project').project.gid

  const satelliteSectionsOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_list_project_sections for project GID ${satelliteProjectGid}.`,
  )
  assertToolUsed(satelliteSectionsOutput, 'asana_api_list_project_sections')
  const satelliteSections = getToolOutput(satelliteSectionsOutput, 'asana_api_list_project_sections').sections
  const incomingSectionGid = satelliteSections.find((section) => section.name === 'Incoming')?.gid
  assert.ok(incomingSectionGid)

  const addTaskToProjectOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_add_task_to_project to add task GID ${designTaskGid} to project GID ${satelliteProjectGid} in section GID ${incomingSectionGid}.`,
  )
  {
    assertToolUsed(addTaskToProjectOutput, 'asana_api_add_task_to_project')
  }

  const removeTaskFromProjectOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_remove_task_from_project to remove task GID ${designTaskGid} from project GID ${satelliteProjectGid}.`,
  )
  {
    assertToolUsed(removeTaskFromProjectOutput, 'asana_api_remove_task_from_project')
  }

  const createDependencyTaskOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_create_task to create a task called 'API integration' in project GID ${projectGid} and place it in section GID ${inProgressSectionGid}.`,
  )
  {
    assertToolUsed(createDependencyTaskOutput, 'asana_api_create_task')
  }
  const dependencyTaskGid = getToolOutput(createDependencyTaskOutput, 'asana_api_create_task').task.gid

  const addDependencyOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_add_task_dependency to mark task GID ${designTaskGid} as blocked by task GID ${dependencyTaskGid}.`,
  )
  {
    assertToolUsed(addDependencyOutput, 'asana_api_add_task_dependency')
  }

  const listDependenciesOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_list_task_dependencies for task GID ${designTaskGid}.`,
  )
  {
    assertToolUsed(listDependenciesOutput, 'asana_api_list_task_dependencies')
  }

  const removeDependencyOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_remove_task_dependency to remove the dependency from task GID ${designTaskGid} on task GID ${dependencyTaskGid}.`,
  )
  {
    assertToolUsed(removeDependencyOutput, 'asana_api_remove_task_dependency')
  }

  const createStatusOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_create_project_status_update to post a weekly status update to project GID ${projectGid} titled 'Week 14 Update' saying 'Completed the initial mockups and moved the task to Done.'.`,
  )
  {
    assertToolUsed(createStatusOutput, 'asana_api_create_project_status_update')
  }

  const getStatusOutput = sessionRunner.run(
    `Load the skill named asana-api and use only asana_api_* tools. Use asana_api_get_project_status_updates for project GID ${projectGid}.`,
  )
  {
    assertToolUsed(getStatusOutput, 'asana_api_get_project_status_updates')
  }

  const preferredStatusOutput = sessionRunner.run(
    `Load the skill named asana-api. Post a weekly status update to project GID ${projectGid} titled 'Week 15 Update' saying 'Verified the skill prefers the custom project status tool.'.`,
  )
  {
    const tools = getTools(preferredStatusOutput)
    assert.ok(tools.includes('asana_api_create_project_status_update'))
    assert.ok(!tools.includes('asana_create_project_status_update'))
    assert.equal(tools.at(-1), 'asana_api_create_project_status_update')
  }

  console.log('skill automation passed')
} finally {
  sessionRunner.cleanup()
}
