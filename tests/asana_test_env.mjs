import assert from 'node:assert/strict'

async function asanaGet(path, pat) {
  const response = await fetch(`https://app.asana.com/api/1.0${path}`, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/json',
    },
  })
  const json = await response.json().catch(() => ({}))
  assert.equal(response.ok, true, `Asana request failed for ${path}: ${response.status} ${JSON.stringify(json)}`)
  return json
}

export async function ensureAsanaProjectEnv(env) {
  const nextEnv = { ...env }
  if (!nextEnv.ASANA_PAT) return nextEnv
  if (nextEnv.ASANA_WORKSPACE_GID && nextEnv.ASANA_TEAM_GID) return nextEnv

  const me = await asanaGet('/users/me', nextEnv.ASANA_PAT)
  const workspaceGid = nextEnv.ASANA_WORKSPACE_GID ?? me.data?.workspaces?.[0]?.gid
  assert.ok(workspaceGid, 'ASANA workspace lookup returned no workspaces')

  const teams = await asanaGet(`/users/me/teams?workspace=${workspaceGid}`, nextEnv.ASANA_PAT)
  const teamGid = nextEnv.ASANA_TEAM_GID ?? teams.data?.[0]?.gid
  assert.ok(teamGid, 'ASANA team lookup returned no accessible teams')

  nextEnv.ASANA_WORKSPACE_GID = workspaceGid
  nextEnv.ASANA_TEAM_GID = teamGid
  return nextEnv
}
