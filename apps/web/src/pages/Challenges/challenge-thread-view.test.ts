import type { ChallengeThreadResponse, ChallengeThreadViewer } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  AUDIENCE_STORAGE_KEY,
  allowedAudiences,
  audienceBadge,
  audienceNote,
  composerHint,
  defaultAudience,
  entryActions,
  flattenThreadPages,
  kindLabel,
  readRememberedAudience,
  rememberAudience,
} from './challenge-thread-view'

const viewer = (over: Partial<ChallengeThreadViewer> = {}): ChallengeThreadViewer => ({
  audiences: ['public', 'participants'],
  can_comment: true,
  role: 'member',
  ...over,
})

describe('allowedAudiences', () => {
  test('a top-level comment may take every audience the viewer has', () => {
    expect(allowedAudiences(viewer())).toEqual(['public', 'participants'])
  })

  test('a reply to a participants entry is participants only', () => {
    expect(allowedAudiences(viewer(), { audience: 'participants' })).toEqual(['participants'])
  })

  test('a reply to a public entry follows the viewer', () => {
    expect(allowedAudiences(viewer(), { audience: 'public' })).toEqual(['public', 'participants'])
  })

  test('none when the viewer cannot comment', () => {
    expect(allowedAudiences(viewer({ can_comment: false }))).toEqual([])
  })

  test('a public-only visitor cannot reply to a participants entry', () => {
    expect(allowedAudiences(viewer({ audiences: ['public'] }), { audience: 'participants' })).toEqual([])
  })
})

describe('defaultAudience', () => {
  test('participants when both are allowed and nothing is remembered', () => {
    expect(defaultAudience(['public', 'participants'], null)).toBe('participants')
  })

  test('the remembered choice when allowed', () => {
    expect(defaultAudience(['public', 'participants'], 'public')).toBe('public')
  })

  test('the only allowed one, whatever is remembered', () => {
    expect(defaultAudience(['public'], 'participants')).toBe('public')
    expect(defaultAudience(['participants'], 'public')).toBe('participants')
  })

  test('null when none is allowed', () => {
    expect(defaultAudience([], 'public')).toBeNull()
  })
})

describe('audienceNote', () => {
  test('no note when the picker is shown', () => {
    expect(audienceNote(['public', 'participants'])).toBeNull()
  })

  test('the participants note', () => {
    expect(audienceNote(['participants'])).toBe('Visible to the people in the challenge')
  })

  test('the public note', () => {
    expect(audienceNote(['public'])).toMatch(/^Public: visible to everyone/)
  })

  test('a reply forced to participants says why', () => {
    expect(audienceNote(['participants'], { audience: 'participants' })).toMatch(/reply/)
  })
})

describe('entryActions', () => {
  const entry = { audience: 'public' as const, hidden: false, own_post_id: undefined }

  test('a member sees Reply on another entry', () => {
    expect(entryActions(entry, viewer())).toEqual({
      delete: false,
      edit: false,
      hide: false,
      reply: true,
      unhide: false,
    })
  })

  test('own entries get Edit and Delete', () => {
    const actions = entryActions({ ...entry, own_post_id: 'p1' }, viewer())
    expect(actions.edit).toBe(true)
    expect(actions.delete).toBe(true)
  })

  test('the host hides a visible entry and unhides a hidden one', () => {
    expect(entryActions(entry, viewer({ role: 'host' })).hide).toBe(true)
    const hidden = entryActions({ ...entry, hidden: true }, viewer({ role: 'host' }))
    expect(hidden.hide).toBe(false)
    expect(hidden.unhide).toBe(true)
    expect(hidden.reply).toBe(false)
  })

  test('no Reply for a viewer who cannot comment', () => {
    expect(entryActions(entry, viewer({ audiences: [], can_comment: false })).reply).toBe(false)
  })
})

describe('labels', () => {
  test('kind labels', () => {
    expect(kindLabel('share')).toBe('shared the challenge')
    expect(kindLabel('result')).toBe('result')
    expect(kindLabel('comment')).toBeNull()
  })

  test('only participants entries carry a badge', () => {
    expect(audienceBadge('participants')).toBe('🔒 People in the challenge')
    expect(audienceBadge('public')).toBeNull()
  })
})

describe('composerHint', () => {
  test('signed out asks to sign in', () => {
    expect(composerHint(false, viewer({ can_comment: false, role: 'visitor' }))).toBe('sign-in')
  })

  test('a signed-in viewer who cannot comment', () => {
    expect(composerHint(true, viewer({ audiences: [], can_comment: false, role: 'visitor' }))).toBe(
      'members-only',
    )
  })

  test('none when the viewer can comment or the thread is not loaded', () => {
    expect(composerHint(true, viewer())).toBeNull()
    expect(composerHint(true, undefined)).toBeNull()
  })
})

describe('flattenThreadPages', () => {
  test('joins the pages and takes the viewer from the first', () => {
    const page = (ids: string[], total?: number): ChallengeThreadResponse => ({
      entries: ids.map((id) => ({ id }) as NonNullable<ChallengeThreadResponse['entries']>[number]),
      success: true,
      total,
      viewer: viewer(),
    })
    const flat = flattenThreadPages([page(['a', 'b'], 3), page(['c'])])
    expect(flat.entries.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(flat.total).toBe(3)
    expect(flat.viewer?.role).toBe('member')
  })

  test('empty without pages', () => {
    expect(flattenThreadPages(undefined)).toEqual({ entries: [], total: undefined, viewer: undefined })
  })
})

describe('remembered audience', () => {
  test('round-trips through storage', () => {
    const store = new Map<string, string>()
    const storage = () => ({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    rememberAudience(storage, 'public')
    expect(store.get(AUDIENCE_STORAGE_KEY)).toBe('public')
    expect(readRememberedAudience(storage)).toBe('public')
  })

  test('ignores junk and blocked storage', () => {
    expect(readRememberedAudience(() => ({ getItem: () => 'everyone' }))).toBeNull()
    const blocked = () => {
      throw new Error('blocked')
    }
    expect(readRememberedAudience(blocked)).toBeNull()
    expect(() => rememberAudience(blocked, 'public')).not.toThrow()
  })
})
