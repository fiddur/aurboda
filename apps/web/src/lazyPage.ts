import { lazy } from 'preact-iso'

interface FlagStorage {
  getItem: (key: string) => string | null
  removeItem: (key: string) => void
  setItem: (key: string, value: string) => void
}

interface ReloadEnv {
  reload: () => void
  storage: () => FlagStorage
}

export const CHUNK_RELOAD_FLAG = 'aurboda:chunk-reload'

const safely = <T>(fn: () => T): T | undefined => {
  try {
    return fn()
  } catch {
    return undefined
  }
}

/**
 * A deploy replaces every hashed chunk, so a tab opened before it 404s on the next page's
 * chunk. Reload once to pick up the new index.html; the flag stops a reload loop when the
 * chunk is genuinely broken. Without working storage there is no guard, so no reload.
 */
export const loadWithReloadOnce = async <M>(load: () => Promise<M>, env: ReloadEnv): Promise<M> => {
  try {
    const module = await load()
    safely(() => env.storage().removeItem(CHUNK_RELOAD_FLAG))
    return module
  } catch (error) {
    const alreadyReloaded = safely(() => env.storage().getItem(CHUNK_RELOAD_FLAG)) !== null
    const flagged =
      !alreadyReloaded &&
      safely(() => {
        env.storage().setItem(CHUNK_RELOAD_FLAG, '1')
        return true
      }) === true
    if (!flagged) throw error
    env.reload()
    return new Promise<M>(() => {})
  }
}

const browserEnv: ReloadEnv = {
  reload: () => window.location.reload(),
  storage: () => window.sessionStorage,
}

export const lazyPage = <M, K extends keyof M>(load: () => Promise<M>, name: K) =>
  lazy(() => loadWithReloadOnce(load, browserEnv).then((module) => module[name]))
