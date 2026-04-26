export const DEFAULT_OPENCODE_MODEL = 'openai/gpt-5.4-mini'

function parseEvents(output) {
  return output
    .replace(/^\ufeff/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

export function extractSessionId(output) {
  for (const event of parseEvents(output)) {
    if (typeof event.sessionID === 'string' && event.sessionID.length > 0) {
      return event.sessionID
    }

    if (typeof event.part?.sessionID === 'string' && event.part.sessionID.length > 0) {
      return event.part.sessionID
    }
  }

  throw new Error('Could not determine the OpenCode session id from JSON output.')
}

export function createSessionRunner({ command, version, model, env, runCli }) {
  let sessionId = null

  function runWithArgs(args) {
    return runCli(command, args, env)
  }

  return {
    start(prompt, title) {
      if (sessionId) throw new Error('OpenCode session already started.')

      const output = runWithArgs([
        '--yes',
        version,
        'run',
        '--model',
        model,
        '--format',
        'json',
        '--title',
        title,
        prompt,
      ])

      sessionId = extractSessionId(output)
      return output
    },

    run(prompt) {
      if (!sessionId) throw new Error('OpenCode session has not been started yet.')

      return runWithArgs([
        '--yes',
        version,
        'run',
        '--model',
        model,
        '--format',
        'json',
        '--session',
        sessionId,
        prompt,
      ])
    },

    cleanup() {
      if (!sessionId) return

      runWithArgs([
        '--yes',
        version,
        'session',
        'delete',
        sessionId,
      ])
    },

    getSessionId() {
      return sessionId
    },
  }
}
