import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const tryoutHome = () => process.env.TRYOUT_HOME ?? '/opt/tryout'
const tryoutDir = () => process.env.TRYOUT_DIR ?? '/tmp/tryout'

export const readState = () => JSON.parse(readFileSync(join(tryoutDir(), 'state.json'), 'utf8'))

export const bearer = (state = readState()) => ({ authorization: `Bearer ${state.token}` })

const attempt = (thunk) => {
  try {
    return thunk()
  } catch {
    return undefined
  }
}

const loadPuppeteer = () => {
  const load = createRequire(join(tryoutHome(), 'package.json'))
  const found = attempt(() => load('puppeteer')) ?? attempt(() => load('puppeteer-core'))
  if (found === undefined) {
    throw new Error(`no puppeteer under ${tryoutHome()} — run tryouts/setup-environment.sh`)
  }
  return found
}

const chromePath = (puppeteer) => {
  const asked = process.env.TRYOUT_CHROME
  if (asked !== undefined && asked !== '') return asked

  const marker = join(tryoutHome(), 'chrome-path')
  const recorded = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : ''
  if (recorded !== '') return recorded

  const bundled = attempt(() => puppeteer.executablePath?.())
  if (typeof bundled === 'string' && bundled !== '') return bundled

  throw new Error('no Chrome to launch — set TRYOUT_CHROME or run tryouts/setup-environment.sh')
}

export const launchBrowser = async (options = {}) => {
  const puppeteer = loadPuppeteer()
  const { args = [], ...rest } = options
  return await puppeteer.launch({
    executablePath: chromePath(puppeteer),
    args: [...args, '--no-sandbox'],
    ...rest,
  })
}

/**
 * The web app reads its session from `localStorage.auth` at module load
 * (apps/web/src/state/auth.ts), so the seed has to be in place before the first
 * script of the document runs — hence evaluateOnNewDocument rather than a
 * post-navigation evaluate.
 */
export const signedInPage = async (browser, state = readState()) => {
  const page = await browser.newPage()
  const auth = JSON.stringify({ user: state.username, token: state.token, is_admin: state.isAdmin })
  await page.evaluateOnNewDocument((value) => {
    localStorage.setItem('auth', value)
  }, auth)
  return page
}
