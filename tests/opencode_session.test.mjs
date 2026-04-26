import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_OPENCODE_MODEL,
  createSessionRunner,
  extractSessionId,
} from './opencode_session.mjs'

test('unit: default OpenCode model uses the OpenAI mini variant', () => {
  assert.equal(DEFAULT_OPENCODE_MODEL, 'openai/gpt-5.4-mini')
})

test('unit: extractSessionId reads the session id from opencode json events', () => {
  const output = [
    JSON.stringify({
      type: 'step_start',
      sessionID: 'ses_created_123',
      part: { type: 'step-start' },
    }),
    JSON.stringify({
      type: 'text',
      sessionID: 'ses_created_123',
      part: { type: 'text', text: 'ok' },
    }),
  ].join('\n')

  assert.equal(extractSessionId(output), 'ses_created_123')
})

test('unit: extractSessionId rejects output without a session id', () => {
  assert.throws(
    () => extractSessionId(JSON.stringify({ type: 'text', part: { type: 'text', text: 'ok' } })),
    /session id/i,
  )
})

test('unit: session runner reuses one exact session and deletes only that id', () => {
  const calls = []
  const runCli = (command, args, env) => {
    calls.push({ command, args, env })

    if (args[2] === 'run' && args.includes('--title')) {
      return [
        JSON.stringify({ type: 'step_start', sessionID: 'ses_test_123', part: { type: 'step-start' } }),
        JSON.stringify({ type: 'text', sessionID: 'ses_test_123', part: { type: 'text', text: 'created' } }),
      ].join('\n')
    }

    if (args[2] === 'run' && args.includes('--session')) {
      const sessionIndex = args.indexOf('--session')
      assert.equal(args[sessionIndex + 1], 'ses_test_123')
      return JSON.stringify({ type: 'text', sessionID: 'ses_test_123', part: { type: 'text', text: 'continued' } })
    }

    if (args[2] === 'session' && args[3] === 'delete') {
      assert.equal(args[4], 'ses_test_123')
      return 'deleted'
    }

    throw new Error(`Unexpected CLI call: ${args.join(' ')}`)
  }

  const runner = createSessionRunner({
    command: 'npx',
    version: 'opencode-ai@test',
    model: 'provider/model',
    env: { TEST: '1' },
    runCli,
  })

  const created = runner.start('Create the project', 'skill-test-title')
  assert.match(created, /created/)

  const continued = runner.run('List the sections')
  assert.match(continued, /continued/)

  runner.cleanup()

  assert.deepEqual(
    calls.map((call) => call.args),
    [
      ['--yes', 'opencode-ai@test', 'run', '--model', 'provider/model', '--format', 'json', '--title', 'skill-test-title', 'Create the project'],
      ['--yes', 'opencode-ai@test', 'run', '--model', 'provider/model', '--format', 'json', '--session', 'ses_test_123', 'List the sections'],
      ['--yes', 'opencode-ai@test', 'session', 'delete', 'ses_test_123'],
    ],
  )
})

test('unit: cleanup does nothing until a session was created', () => {
  const calls = []
  const runner = createSessionRunner({
    command: 'npx',
    version: 'opencode-ai@test',
    model: 'provider/model',
    env: {},
    runCli(command, args) {
      calls.push({ command, args })
      return ''
    },
  })

  runner.cleanup()

  assert.deepEqual(calls, [])
})
