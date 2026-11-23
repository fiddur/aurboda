import { describe, expect, test, vi } from 'vitest'

import type { ChallengeRecord } from '../db/index.ts'

import { type ChallengeBannerDeps, setChallengeBanner } from './challenge-banner.ts'

const CHALLENGE_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
const record = { id: CHALLENGE_ID, slug: 'oct' } as ChallengeRecord
const updated = { ...record, banner_updated_at: new Date('2026-10-01T08:00:00Z') } as ChallengeRecord

const deps = (overrides: Partial<ChallengeBannerDeps> = {}): ChallengeBannerDeps => ({
  getChallenge: vi
    .fn<ChallengeBannerDeps['getChallenge']>()
    .mockResolvedValueOnce(record)
    .mockResolvedValueOnce(updated),
  process: vi.fn(async () => ({ content_type: 'image/webp', data: Buffer.from('webp') })),
  upsert: vi.fn(async () => {}),
  ...overrides,
})

describe('setChallengeBanner', () => {
  test('stores the processed banner and answers the challenge as it now is', async () => {
    const d = deps()
    expect(await setChallengeBanner('alice', CHALLENGE_ID, Buffer.from('png'), d)).toEqual({
      ok: true,
      record: updated,
    })
    expect(d.upsert).toHaveBeenCalledWith('alice', CHALLENGE_ID, 'image/webp', Buffer.from('webp'))
  })

  test('not_found for a challenge that is not the user’s, without processing', async () => {
    const d = deps({ getChallenge: vi.fn(async () => null) })
    expect(await setChallengeBanner('alice', CHALLENGE_ID, Buffer.from('png'), d)).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(d.process).not.toHaveBeenCalled()
  })

  test('unsupported for bytes that do not process as a picture', async () => {
    const d = deps({
      process: vi.fn(async () => {
        throw new Error('Unsupported image format: pdf')
      }),
    })
    expect(await setChallengeBanner('alice', CHALLENGE_ID, Buffer.from('%PDF-'), d)).toEqual({
      ok: false,
      reason: 'unsupported',
    })
    expect(d.upsert).not.toHaveBeenCalled()
  })

  test('not_found when the challenge went away while the banner was stored', async () => {
    const d = deps({
      getChallenge: vi
        .fn<ChallengeBannerDeps['getChallenge']>()
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce(null),
    })
    expect(await setChallengeBanner('alice', CHALLENGE_ID, Buffer.from('png'), d)).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })
})
