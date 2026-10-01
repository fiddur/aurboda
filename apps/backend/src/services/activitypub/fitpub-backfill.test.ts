import { Note, PUBLIC_COLLECTION } from '@fedify/fedify/vocab'
import { describe, expect, test } from 'vitest'

import { fetchFitpubRecentNotes, type FitpubBackfillDeps, isFitpubInstance } from './fitpub-backfill.ts'

const ORIGIN = 'https://fitpub.example'
const ACTOR = `${ORIGIN}/users/alice`
const FOLLOWERS = new URL(`${ACTOR}/followers`)
const ID_1 = '35175dde-bc6f-4169-90a4-b63a8b439c3f'
const ID_2 = '0b8e1c52-6c0a-4f1e-9d3e-2a7b5c4d1e90'
const ID_3 = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789'

const NODEINFO_21 = 'http://nodeinfo.diaspora.software/ns/schema/2.1'
const NODEINFO_22 = 'http://nodeinfo.diaspora.software/ns/schema/2.2'

const discovery = (href22 = `${ORIGIN}/nodeinfo/2.2`) => ({
  links: [
    { href: href22, rel: NODEINFO_22 },
    { href: `${ORIGIN}/nodeinfo/2.1`, rel: NODEINFO_21 },
  ],
})

const nodeinfo = (name: string) => ({ software: { name, version: '1.0' }, version: '2.2' })

const apiUrl = (size: number) => `${ORIGIN}/api/web/activities/user/alice?page=0&size=${size}`
const noteUrl = (id: string) => `${ORIGIN}/activities/${id}`

const publicNote = (id: string): Note =>
  new Note({
    attribution: new URL(ACTOR),
    ccs: [FOLLOWERS],
    id: new URL(noteUrl(id)),
    tos: [PUBLIC_COLLECTION],
  })

/** Fake deps keyed by URL, recording every URL requested. */
const makeDeps = (
  json: Record<string, unknown>,
  notes: Record<string, Note | Error | null> = {},
): FitpubBackfillDeps & { fetched: string[]; looked: string[] } => {
  const fetched: string[] = []
  const looked: string[] = []
  return {
    fetched,
    fetchJson: async (url) => {
      fetched.push(url)
      if (!(url in json)) throw new Error(`404 ${url}`)
      const value = json[url]
      if (value instanceof Error) throw value
      return value
    },
    looked,
    lookupNote: async (url) => {
      looked.push(url)
      const value = notes[url] ?? null
      if (value instanceof Error) throw value
      return value
    },
  }
}

const fitpubJson = (content: unknown[], size = 20): Record<string, unknown> => ({
  [`${ORIGIN}/.well-known/nodeinfo`]: discovery(),
  [`${ORIGIN}/nodeinfo/2.2`]: nodeinfo('FitPub'),
  [apiUrl(size)]: { content, totalElements: content.length },
})

const ids = (notes: Note[]) => notes.map((n) => n.id?.href)

describe('isFitpubInstance', () => {
  test('reads the highest NodeInfo 2.x schema and matches the software name case-insensitively', async () => {
    const deps = makeDeps(fitpubJson([]))
    expect(await isFitpubInstance(deps, ORIGIN)).toBe(true)
    expect(deps.fetched).toEqual([`${ORIGIN}/.well-known/nodeinfo`, `${ORIGIN}/nodeinfo/2.2`])
  })

  test('another software name is not FitPub', async () => {
    const deps = makeDeps({
      [`${ORIGIN}/.well-known/nodeinfo`]: discovery(),
      [`${ORIGIN}/nodeinfo/2.2`]: nodeinfo('mastodon'),
    })
    expect(await isFitpubInstance(deps, ORIGIN)).toBe(false)
  })

  test('a NodeInfo href on another origin is ignored', async () => {
    const deps = makeDeps({
      [`${ORIGIN}/.well-known/nodeinfo`]: {
        links: [{ href: 'https://evil.example/nodeinfo/2.2', rel: NODEINFO_22 }],
      },
      'https://evil.example/nodeinfo/2.2': nodeinfo('fitpub'),
    })
    expect(await isFitpubInstance(deps, ORIGIN)).toBe(false)
    expect(deps.fetched).toEqual([`${ORIGIN}/.well-known/nodeinfo`])
  })

  test('falls back to a lower 2.x schema when the higher one is cross-origin', async () => {
    const deps = makeDeps({
      [`${ORIGIN}/.well-known/nodeinfo`]: discovery('https://evil.example/nodeinfo/2.2'),
      [`${ORIGIN}/nodeinfo/2.1`]: nodeinfo('fitpub'),
    })
    expect(await isFitpubInstance(deps, ORIGIN)).toBe(true)
  })

  test('a failed fetch is not FitPub', async () => {
    expect(await isFitpubInstance(makeDeps({}), ORIGIN)).toBe(false)
  })
})

describe('fetchFitpubRecentNotes', () => {
  test('lists post ids from the web API and fetches each as a Note, keeping API order', async () => {
    const deps = makeDeps(fitpubJson([{ id: ID_1 }, { id: ID_2 }, { id: ID_3 }]), {
      [noteUrl(ID_1)]: publicNote(ID_1),
      [noteUrl(ID_2)]: publicNote(ID_2),
      [noteUrl(ID_3)]: publicNote(ID_3),
    })
    const notes = await fetchFitpubRecentNotes(deps, ACTOR, 'alice', 20)
    expect(ids(notes)).toEqual([noteUrl(ID_1), noteUrl(ID_2), noteUrl(ID_3)])
    expect(deps.fetched).toContain(apiUrl(20))
  })

  test('passes limit as the page size and never returns more than limit', async () => {
    const deps = makeDeps(fitpubJson([{ id: ID_1 }, { id: ID_2 }, { id: ID_3 }], 2), {
      [noteUrl(ID_1)]: publicNote(ID_1),
      [noteUrl(ID_2)]: publicNote(ID_2),
      [noteUrl(ID_3)]: publicNote(ID_3),
    })
    const notes = await fetchFitpubRecentNotes(deps, ACTOR, 'alice', 2)
    expect(ids(notes)).toEqual([noteUrl(ID_1), noteUrl(ID_2)])
    expect(deps.fetched).toContain(apiUrl(2))
    expect(deps.looked).toEqual([noteUrl(ID_1), noteUrl(ID_2)])
  })

  test('a non-FitPub server yields nothing and its web API is never called', async () => {
    const deps = makeDeps({
      [`${ORIGIN}/.well-known/nodeinfo`]: discovery(),
      [`${ORIGIN}/nodeinfo/2.2`]: nodeinfo('mastodon'),
      [apiUrl(20)]: { content: [{ id: ID_1 }] },
    })
    expect(await fetchFitpubRecentNotes(deps, ACTOR, 'alice', 20)).toEqual([])
    expect(deps.fetched).not.toContain(apiUrl(20))
    expect(deps.looked).toEqual([])
  })

  test.each([
    ['an actor URI not shaped /users/<username>', `${ORIGIN}/@alice`, 'alice'],
    ['a username that does not match the actor URI', ACTOR, 'bob'],
    ['a null username', ACTOR, null],
    ['a username with path characters', `${ORIGIN}/users/a/b`, 'a/b'],
    ['an unparsable actor URI', 'not a url', 'alice'],
  ])('%s yields nothing without any fetch', async (_label, actorUri, username) => {
    const deps = makeDeps(fitpubJson([{ id: ID_1 }]), { [noteUrl(ID_1)]: publicNote(ID_1) })
    expect(await fetchFitpubRecentNotes(deps, actorUri, username, 20)).toEqual([])
    expect(deps.fetched).toEqual([])
    expect(deps.looked).toEqual([])
  })

  test('ids that are not UUIDs are skipped without a lookup', async () => {
    const deps = makeDeps(
      fitpubJson([
        { id: '../../admin' },
        { id: 42 },
        {},
        'junk',
        { id: `https://evil.example/${ID_2}` },
        { id: ID_1 },
      ]),
      { [noteUrl(ID_1)]: publicNote(ID_1) },
    )
    const notes = await fetchFitpubRecentNotes(deps, ACTOR, 'alice', 20)
    expect(ids(notes)).toEqual([noteUrl(ID_1)])
    expect(deps.looked).toEqual([noteUrl(ID_1)])
  })

  test('only publicly addressed Notes are kept', async () => {
    const followersOnly = new Note({
      attribution: new URL(ACTOR),
      id: new URL(noteUrl(ID_2)),
      tos: [FOLLOWERS],
    })
    const ccPublic = new Note({
      attribution: new URL(ACTOR),
      ccs: [PUBLIC_COLLECTION],
      id: new URL(noteUrl(ID_3)),
      tos: [FOLLOWERS],
    })
    const deps = makeDeps(fitpubJson([{ id: ID_1 }, { id: ID_2 }, { id: ID_3 }]), {
      [noteUrl(ID_1)]: publicNote(ID_1),
      [noteUrl(ID_2)]: followersOnly,
      [noteUrl(ID_3)]: ccPublic,
    })
    const notes = await fetchFitpubRecentNotes(deps, ACTOR, 'alice', 20)
    expect(ids(notes)).toEqual([noteUrl(ID_1), noteUrl(ID_3)])
  })

  test('a lookup that throws or finds nothing skips only that post', async () => {
    const deps = makeDeps(fitpubJson([{ id: ID_1 }, { id: ID_2 }, { id: ID_3 }]), {
      [noteUrl(ID_1)]: new Error('timeout'),
      [noteUrl(ID_2)]: null,
      [noteUrl(ID_3)]: publicNote(ID_3),
    })
    const notes = await fetchFitpubRecentNotes(deps, ACTOR, 'alice', 20)
    expect(ids(notes)).toEqual([noteUrl(ID_3)])
    expect(deps.looked).toEqual([noteUrl(ID_1), noteUrl(ID_2), noteUrl(ID_3)])
  })

  test.each([
    ['NodeInfo discovery', `${ORIGIN}/.well-known/nodeinfo`],
    ['the NodeInfo document', `${ORIGIN}/nodeinfo/2.2`],
    ['the web API', apiUrl(20)],
  ])('a rejected fetch of %s yields nothing without throwing', async (_label, failing) => {
    const deps = makeDeps(
      { ...fitpubJson([{ id: ID_1 }]), [failing]: new Error('boom') },
      { [noteUrl(ID_1)]: publicNote(ID_1) },
    )
    expect(await fetchFitpubRecentNotes(deps, ACTOR, 'alice', 20)).toEqual([])
    expect(deps.looked).toEqual([])
  })

  test('an API page without a content array yields nothing', async () => {
    const deps = makeDeps({ ...fitpubJson([]), [apiUrl(20)]: { totalItems: 584 } })
    expect(await fetchFitpubRecentNotes(deps, ACTOR, 'alice', 20)).toEqual([])
    expect(deps.looked).toEqual([])
  })
})
