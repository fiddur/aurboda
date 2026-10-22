import { randomBytes } from 'node:crypto'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const tryoutDir = process.env.TRYOUT_DIR ?? '/tmp/tryout'
const statePath = join(tryoutDir, 'state.json')
const tokenPath = join(tryoutDir, 'token.txt')

const readState = () => {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch (cause) {
    throw new Error(`cannot read ${statePath} — run tryouts/up.sh first`, { cause })
  }
}

const postJson = async (baseUrl, path, body) => {
  const answer = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await answer.text()
  try {
    return { status: answer.status, payload: JSON.parse(text) }
  } catch {
    return { status: answer.status, payload: { error: text.slice(0, 200) } }
  }
}

const signUp = async (baseUrl, username, password) => {
  const { status, payload } = await postJson(baseUrl, '/api/signup', { username, password })
  if (status === 200 && typeof payload.token === 'string') {
    return { token: payload.token, isAdmin: payload.is_admin === true, created: true }
  }
  if (status === 409) return undefined
  throw new Error(`POST /api/signup answered ${status}: ${JSON.stringify(payload)}`)
}

const logIn = async (baseUrl, username, password) => {
  const { status, payload } = await postJson(baseUrl, '/api/login', { username, password })
  if (status === 200 && typeof payload.token === 'string') {
    return { token: payload.token, isAdmin: payload.is_admin === true, created: false }
  }
  if (status === 401) {
    throw new Error(
      `${username} exists but ${statePath}'s password does not open it. The postgres volume ` +
        'outlived the state file — re-run tryouts/up.sh --fresh.',
    )
  }
  throw new Error(`POST /api/login answered ${status}: ${JSON.stringify(payload)}`)
}

const assertTokenWorks = async (baseUrl, token) => {
  const answer = await fetch(`${baseUrl}/api/user/settings`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!answer.ok) {
    throw new Error(`GET /api/user/settings with the new token answered ${answer.status}`)
  }
}

const state = readState()
const { baseUrl, username } = state
if (typeof baseUrl !== 'string' || typeof username !== 'string') {
  throw new Error(`${statePath} has no baseUrl/username — run tryouts/up.sh first`)
}

const password = state.password ?? randomBytes(18).toString('base64url')

console.info(`🔑 signing ${username} in at ${baseUrl}`)
const session = (await signUp(baseUrl, username, password)) ?? (await logIn(baseUrl, username, password))
await assertTokenWorks(baseUrl, session.token)

writeFileSync(
  statePath,
  `${JSON.stringify({ ...state, password, token: session.token, isAdmin: session.isAdmin }, null, 2)}\n`,
)
chmodSync(statePath, 0o600)
writeFileSync(tokenPath, session.token)
chmodSync(tokenPath, 0o600)

const how = session.created ? 'signed up' : 'logged in'
console.info(`✅ ${username} ${how} (admin: ${session.isAdmin})`)
console.info(`💾 wrote ${statePath} and ${tokenPath}`)
