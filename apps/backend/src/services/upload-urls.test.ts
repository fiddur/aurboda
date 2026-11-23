import {
  MAX_FEED_IMAGE_BYTES,
  NOTE_ATTACHMENT_MAX_BYTES,
  type NoteAttachment,
  type UploadTarget,
} from '@aurboda/api-spec'
import { createHash } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'

import type { ChallengeRecord, FeedImageRecord, NewUploadUrl } from '../db/index.ts'

import {
  hashUploadToken,
  isUploadToken,
  mintUploadUrl,
  type MintUploadUrlDeps,
  runUpload,
  type RunUploadDeps,
  UPLOAD_MAX_BYTES,
  type UploadHandlers,
} from './upload-urls.ts'

const API = 'https://aurboda.test/api'
const WEB = 'https://aurboda.test'
const NOTE_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
const CHALLENGE_ID = '6f9619ff-8b86-4011-b42d-00c04fc964ff'
const NOW = new Date('2026-11-23T10:00:00Z')
const TOKEN_BYTES = Buffer.alloc(32, 7)
const TOKEN = TOKEN_BYTES.toString('base64url')

const mintDeps = (overrides: Partial<MintUploadUrlDeps> = {}) => {
  const inserted: NewUploadUrl[] = []
  const deps: MintUploadUrlDeps = {
    apiBaseUrl: API,
    challengeExists: vi.fn(async () => true),
    insert: vi.fn(async (_user: string, url: NewUploadUrl) => {
      inserted.push(url)
    }),
    noteEntryFailure: vi.fn(async () => null),
    now: () => NOW,
    randomBytes: vi.fn(() => TOKEN_BYTES),
    ...overrides,
  }
  return { deps, inserted }
}

describe('mintUploadUrl', () => {
  test('mints a URL for the user and stores the hash of its token, never the token', async () => {
    const { deps, inserted } = mintDeps()
    const result = await mintUploadUrl('alice', { target: 'feed_image' }, deps)
    expect(result).toEqual({
      ok: true,
      value: {
        expires_at: '2026-11-23T10:15:00.000Z',
        max_bytes: MAX_FEED_IMAGE_BYTES,
        method: 'PUT',
        target: 'feed_image',
        upload_url: `${API}/uploads/alice/${TOKEN}`,
      },
    })
    expect(deps.randomBytes).toHaveBeenCalledWith(32)
    expect(inserted).toEqual([
      {
        expires_at: new Date('2026-11-23T10:15:00Z'),
        target: 'feed_image',
        target_id: null,
        token_hash: createHash('sha256').update(TOKEN).digest('hex'),
      },
    ])
    expect(JSON.stringify(inserted)).not.toContain(TOKEN)
  })

  test('the token is 43 base64url characters', async () => {
    const { deps } = mintDeps({ randomBytes: (size) => Buffer.alloc(size, 0xff) })
    const result = await mintUploadUrl('alice', { target: 'profile_avatar' }, deps)
    if (!result.ok) throw new Error('expected a URL')
    const token = result.value.upload_url.split('/').pop()!
    expect(token).toHaveLength(43)
    expect(isUploadToken(token)).toBe(true)
  })

  test('escapes the username in the URL', async () => {
    const { deps } = mintDeps()
    const result = await mintUploadUrl('a/b', { target: 'feed_image' }, deps)
    expect(result.ok && result.value.upload_url).toBe(`${API}/uploads/a%2Fb/${TOKEN}`)
  })

  test.each<[UploadTarget, number]>([
    ['note_attachment', NOTE_ATTACHMENT_MAX_BYTES],
    ['feed_image', MAX_FEED_IMAGE_BYTES],
    ['challenge_banner', 10 * 1024 * 1024],
    ['profile_avatar', 10 * 1024 * 1024],
  ])('%s takes at most %i bytes', (target, bytes) => {
    expect(UPLOAD_MAX_BYTES[target]).toBe(bytes)
  })

  test('a note attachment URL is bound to its entry', async () => {
    const { deps, inserted } = mintDeps()
    const result = await mintUploadUrl('alice', { note_id: NOTE_ID, target: 'note_attachment' }, deps)
    expect(result.ok && result.value.max_bytes).toBe(NOTE_ATTACHMENT_MAX_BYTES)
    expect(deps.noteEntryFailure).toHaveBeenCalledWith('alice', NOTE_ID)
    expect(inserted[0].target_id).toBe(NOTE_ID)
  })

  test('a banner URL is bound to its challenge', async () => {
    const { deps, inserted } = mintDeps()
    const result = await mintUploadUrl(
      'alice',
      { challenge_id: CHALLENGE_ID, target: 'challenge_banner' },
      deps,
    )
    expect(result.ok).toBe(true)
    expect(deps.challengeExists).toHaveBeenCalledWith('alice', CHALLENGE_ID)
    expect(inserted[0].target_id).toBe(CHALLENGE_ID)
  })

  test('note_attachment without a note_id is refused', async () => {
    const { deps } = mintDeps()
    expect(await mintUploadUrl('alice', { target: 'note_attachment' }, deps)).toEqual({
      message: 'note_attachment needs a note_id',
      ok: false,
      status: 400,
    })
    expect(deps.insert).not.toHaveBeenCalled()
  })

  test('challenge_banner without a challenge_id is refused', async () => {
    const { deps } = mintDeps()
    expect(await mintUploadUrl('alice', { target: 'challenge_banner' }, deps)).toMatchObject({
      message: 'challenge_banner needs a challenge_id',
      status: 400,
    })
  })

  test('an id the target does not take is refused', async () => {
    const { deps } = mintDeps()
    expect(await mintUploadUrl('alice', { note_id: NOTE_ID, target: 'feed_image' }, deps)).toEqual({
      message: 'feed_image takes no note_id',
      ok: false,
      status: 400,
    })
    expect(
      await mintUploadUrl(
        'alice',
        { challenge_id: CHALLENGE_ID, note_id: NOTE_ID, target: 'note_attachment' },
        deps,
      ),
    ).toMatchObject({ message: 'note_attachment takes no challenge_id', status: 400 })
    expect(deps.insert).not.toHaveBeenCalled()
  })

  test('an unknown entry is not found, a note that is no journal entry is refused', async () => {
    const missing = mintDeps({ noteEntryFailure: vi.fn(async () => 'not_found' as const) })
    expect(
      await mintUploadUrl('alice', { note_id: NOTE_ID, target: 'note_attachment' }, missing.deps),
    ).toEqual({ message: 'Not found', ok: false, status: 404 })
    expect(missing.deps.insert).not.toHaveBeenCalled()

    const comment = mintDeps({ noteEntryFailure: vi.fn(async () => 'not_entry' as const) })
    expect(
      await mintUploadUrl('alice', { note_id: NOTE_ID, target: 'note_attachment' }, comment.deps),
    ).toEqual({
      message: 'Pictures and recordings can only be added to a journal entry.',
      ok: false,
      status: 400,
    })
  })

  test('an unknown challenge is not found', async () => {
    const { deps } = mintDeps({ challengeExists: vi.fn(async () => false) })
    expect(
      await mintUploadUrl('alice', { challenge_id: CHALLENGE_ID, target: 'challenge_banner' }, deps),
    ).toEqual({ message: 'Challenge not found', ok: false, status: 404 })
    expect(deps.insert).not.toHaveBeenCalled()
  })
})

describe('hashUploadToken', () => {
  test('is the hex SHA-256 of the token', () => {
    expect(hashUploadToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('isUploadToken', () => {
  test('takes 43 base64url characters only', () => {
    expect(isUploadToken(TOKEN)).toBe(true)
    expect(isUploadToken(TOKEN.slice(1))).toBe(false)
    expect(isUploadToken(`${TOKEN}A`)).toBe(false)
    expect(isUploadToken(`${TOKEN.slice(1)}=`)).toBe(false)
    expect(isUploadToken(`${TOKEN.slice(1)}/`)).toBe(false)
  })
})

const attachment: NoteAttachment = {
  created_at: '2026-11-23T10:01:00.000Z',
  height: 600,
  id: '3d6f0a3e-6a5b-4a43-9b8f-2a1c1d0e6f11',
  kind: 'image',
  mime: 'image/webp',
  position: 0,
  size: 1234,
  width: 800,
}

const feedImage: FeedImageRecord = {
  byte_size: 1234,
  content_type: 'image/webp',
  created_at: new Date('2026-11-01T08:00:00Z'),
  height: 600,
  id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
  width: 800,
}

const challenge: ChallengeRecord = {
  announce_winner: false,
  banner_updated_at: new Date('2026-10-01T08:00:00Z'),
  created_at: new Date('2026-09-01T00:00:00Z'),
  end_ts: new Date('2026-11-01T00:00:00Z'),
  id: CHALLENGE_ID,
  is_public: true,
  join_token: 'jt',
  name: 'October steps',
  result_published_at: null,
  slug: 'oct',
  spec: {
    activity_type_id: null,
    aggregation: 'sum',
    bucket_size: '1d',
    filter_field: null,
    filter_value: null,
    measure: null,
    pattern: 'steps',
    source_type: 'metric',
    unit: 'steps',
  },
  start_ts: new Date('2026-10-01T00:00:00Z'),
  timezone: 'UTC',
  updated_at: new Date('2026-09-01T00:00:00Z'),
}

const runDeps = (handlers: Partial<UploadHandlers> = {}): RunUploadDeps => ({
  apiBaseUrl: API,
  handlers: {
    challenge_banner: vi.fn(async () => ({ ok: true as const, record: challenge })),
    feed_image: vi.fn(async () => ({ image: feedImage, ok: true as const })),
    note_attachment: vi.fn(async () => ({ ok: true as const, value: attachment })),
    profile_avatar: vi.fn(async () => ({ ok: true as const, url: `${WEB}/u/alice/avatar.png` })),
    ...handlers,
  },
  onProfileChanged: vi.fn(),
  webHost: WEB,
})

const bytes = Buffer.from('file-bytes')

describe('runUpload', () => {
  test('note_attachment stores the file on its entry', async () => {
    const deps = runDeps()
    expect(await runUpload('alice', { target: 'note_attachment', target_id: NOTE_ID }, bytes, deps)).toEqual({
      body: { data: { attachment, target: 'note_attachment' }, success: true },
      status: 201,
    })
    expect(deps.handlers.note_attachment).toHaveBeenCalledWith('alice', NOTE_ID, bytes)
  })

  test('note_attachment answers the attachment failures as POST /notes/:id/attachments does', async () => {
    const run = (reason: 'not_found' | 'note_limit' | 'unsupported') =>
      runUpload(
        'alice',
        { target: 'note_attachment', target_id: NOTE_ID },
        bytes,
        runDeps({ note_attachment: vi.fn(async () => ({ ok: false as const, reason })) }),
      )
    expect(await run('not_found')).toEqual({ body: { error: 'Not found', success: false }, status: 404 })
    expect((await run('note_limit')).status).toBe(409)
    expect(await run('unsupported')).toEqual({
      body: { error: 'That is not a picture or a recording Aurboda can keep.', success: false },
      status: 400,
    })
  })

  test('feed_image answers the stored picture with its public URL', async () => {
    const deps = runDeps()
    expect(await runUpload('alice', { target: 'feed_image', target_id: null }, bytes, deps)).toEqual({
      body: {
        data: {
          image: {
            byte_size: 1234,
            created_at: '2026-11-01T08:00:00.000Z',
            height: 600,
            id: feedImage.id,
            url: `${API}/public/alice/images/${feedImage.id}.webp`,
            width: 800,
          },
          target: 'feed_image',
        },
        success: true,
      },
      status: 201,
    })
    expect(deps.handlers.feed_image).toHaveBeenCalledWith('alice', bytes)
  })

  test('feed_image answers its failures as POST /feed/images does', async () => {
    const run = (reason: 'limit' | 'unsupported') =>
      runUpload(
        'alice',
        { target: 'feed_image', target_id: null },
        bytes,
        runDeps({ feed_image: vi.fn(async () => ({ ok: false as const, reason })) }),
      )
    expect((await run('limit')).status).toBe(409)
    expect(await run('unsupported')).toEqual({
      body: { error: 'That is not a picture Aurboda can use. PNG, JPEG, WebP or GIF works.', success: false },
      status: 415,
    })
  })

  test('challenge_banner answers the challenge with its banner', async () => {
    const deps = runDeps()
    const outcome = await runUpload(
      'alice',
      { target: 'challenge_banner', target_id: CHALLENGE_ID },
      bytes,
      deps,
    )
    expect(outcome.status).toBe(201)
    expect(outcome.body.data).toMatchObject({
      challenge: {
        banner_url: `${WEB}/u/alice/oct/banner.webp?v=${challenge.banner_updated_at!.getTime()}`,
        id: CHALLENGE_ID,
      },
      target: 'challenge_banner',
    })
    expect(deps.handlers.challenge_banner).toHaveBeenCalledWith('alice', CHALLENGE_ID, bytes)
  })

  test('challenge_banner answers 404 for a challenge gone, 400 for bytes that are no picture', async () => {
    const run = (reason: 'not_found' | 'unsupported') =>
      runUpload(
        'alice',
        { target: 'challenge_banner', target_id: CHALLENGE_ID },
        bytes,
        runDeps({ challenge_banner: vi.fn(async () => ({ ok: false as const, reason })) }),
      )
    expect(await run('not_found')).toEqual({
      body: { error: 'Challenge not found', success: false },
      status: 404,
    })
    expect(await run('unsupported')).toEqual({
      body: { error: 'Could not process image', success: false },
      status: 400,
    })
  })

  test('profile_avatar answers the picture URL and tells federation the profile changed', async () => {
    const deps = runDeps()
    expect(await runUpload('alice', { target: 'profile_avatar', target_id: null }, bytes, deps)).toEqual({
      body: { data: { target: 'profile_avatar', url: `${WEB}/u/alice/avatar.png` }, success: true },
      status: 201,
    })
    expect(deps.onProfileChanged).toHaveBeenCalledWith('alice')
  })

  test('profile_avatar refuses bytes that are no picture, without telling federation', async () => {
    const deps = runDeps({
      profile_avatar: vi.fn(async () => ({ ok: false as const, reason: 'unsupported' as const })),
    })
    expect(await runUpload('alice', { target: 'profile_avatar', target_id: null }, bytes, deps)).toEqual({
      body: { error: 'Could not process image', success: false },
      status: 400,
    })
    expect(deps.onProfileChanged).not.toHaveBeenCalled()
  })

  test('a target that needs an id and has none is gone', async () => {
    const deps = runDeps()
    expect(
      (await runUpload('alice', { target: 'note_attachment', target_id: null }, bytes, deps)).status,
    ).toBe(404)
    expect(
      (await runUpload('alice', { target: 'challenge_banner', target_id: null }, bytes, deps)).status,
    ).toBe(404)
    expect(deps.handlers.note_attachment).not.toHaveBeenCalled()
  })
})
