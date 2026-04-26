import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

import { ensureAsanaProjectEnv } from './asana_test_env.mjs'

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const NODE = process.platform === 'win32' ? 'node' : process.execPath

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  assert.equal(result.status, 0, `${command} exited with code ${result.status}`)
}

const env = await ensureAsanaProjectEnv(process.env)

run(NODE, ['--test', 'tests/opencode_session.test.mjs'], env)
run(NPX, ['--yes', 'tsx', '--test', 'tests/asana_core.unit.test.ts', 'tests/asana_core.test.ts'], env)
run(NODE, ['tests/skill_automation.mjs'], env)
