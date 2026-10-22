import { describe, expect, it, vi } from 'vitest'

import { CHUNK_RELOAD_FLAG, loadWithReloadOnce } from './lazyPage'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

const throwingStorage = () => {
  throw new Error('SecurityError')
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('loadWithReloadOnce', () => {
  it('returns the module and clears the flag on success', async () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_FLAG]: '1' })
    const reload = vi.fn()
    const module = { Page: () => null }
    await expect(
      loadWithReloadOnce(() => Promise.resolve(module), { reload, storage: () => storage }),
    ).resolves.toBe(module)
    expect(storage.data.has(CHUNK_RELOAD_FLAG)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads and sets the flag on the first failure', async () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    let settled = false
    void loadWithReloadOnce(() => Promise.reject(new Error('404')), {
      reload,
      storage: () => storage,
    }).finally(() => (settled = true))
    await flush()
    expect(reload).toHaveBeenCalledOnce()
    expect(storage.data.get(CHUNK_RELOAD_FLAG)).toBe('1')
    expect(settled).toBe(false)
  })

  it('rethrows on a second consecutive failure', async () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_FLAG]: '1' })
    const reload = vi.fn()
    await expect(
      loadWithReloadOnce(() => Promise.reject(new Error('404')), { reload, storage: () => storage }),
    ).rejects.toThrow('404')
    expect(reload).not.toHaveBeenCalled()
  })

  it('rethrows without reloading when storage throws', async () => {
    const reload = vi.fn()
    await expect(
      loadWithReloadOnce(() => Promise.reject(new Error('404')), { reload, storage: throwingStorage }),
    ).rejects.toThrow('404')
    expect(reload).not.toHaveBeenCalled()
  })

  it('still returns the module when storage throws on success', async () => {
    const module = { Page: () => null }
    await expect(
      loadWithReloadOnce(() => Promise.resolve(module), { reload: vi.fn(), storage: throwingStorage }),
    ).resolves.toBe(module)
  })
})
