import { describe, expect, test, vi } from 'vitest'

import { type ProfileAvatarDeps, setProfileAvatar } from './profile-avatar.ts'

const deps = (overrides: Partial<ProfileAvatarDeps> = {}): ProfileAvatarDeps => ({
  process: vi.fn(async () => ({ content_type: 'image/webp', data: Buffer.from('webp') })),
  upsert: vi.fn(async () => {}),
  ...overrides,
})

describe('setProfileAvatar', () => {
  test('stores the processed picture and answers its public URL', async () => {
    const d = deps()
    const result = await setProfileAvatar('alice', Buffer.from('png'), 'https://aurboda.test', d)
    expect(result).toEqual({ ok: true, url: 'https://aurboda.test/u/alice/avatar.png' })
    expect(d.process).toHaveBeenCalledWith(Buffer.from('png'))
    expect(d.upsert).toHaveBeenCalledWith('alice', 'image/webp', Buffer.from('webp'))
  })

  test('refuses bytes that do not process as a picture, storing nothing', async () => {
    const d = deps({
      process: vi.fn(async () => {
        throw new Error('Unsupported image format: svg')
      }),
    })
    expect(await setProfileAvatar('alice', Buffer.from('<svg/>'), 'https://aurboda.test', d)).toEqual({
      ok: false,
      reason: 'unsupported',
    })
    expect(d.upsert).not.toHaveBeenCalled()
  })
})
