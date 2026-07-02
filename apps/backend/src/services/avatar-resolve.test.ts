import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../db/index.ts', () => ({
  getProfileAvatar: vi.fn(),
  isMissingDatabase: (e: unknown) => e instanceof Error && (e as { code?: string }).code === '3D000',
}))

const db = await import('../db/index.ts')
const { loadAvatarImage } = await import('./avatar-resolve.ts')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadAvatarImage', () => {
  test('returns the stored avatar when present', async () => {
    const stored = { content_type: 'image/webp', data: Buffer.from('x'), updated_at: new Date(0) }
    vi.mocked(db.getProfileAvatar).mockResolvedValue(stored)
    const img = await loadAvatarImage('fiddur')
    expect(img.content_type).toBe('image/webp')
    expect(img.data.equals(Buffer.from('x'))).toBe(true)
  })

  test('falls back to an identicon when no avatar is stored', async () => {
    vi.mocked(db.getProfileAvatar).mockResolvedValue(undefined)
    const img = await loadAvatarImage('fiddur')
    expect(img.content_type).toBe('image/png')
    expect(img.data.subarray(0, 4).toString('hex')).toBe('89504e47')
  })

  test('falls back to an identicon for an unknown user (missing database)', async () => {
    vi.mocked(db.getProfileAvatar).mockRejectedValue(Object.assign(new Error('no db'), { code: '3D000' }))
    const img = await loadAvatarImage('ghost')
    expect(img.content_type).toBe('image/png')
  })

  test('rethrows unexpected errors', async () => {
    vi.mocked(db.getProfileAvatar).mockRejectedValue(new Error('boom'))
    await expect(loadAvatarImage('fiddur')).rejects.toThrow('boom')
  })
})
