import type { Federation } from '@fedify/fedify'

import { Collection, Create, Note, Person } from '@fedify/fedify/vocab'
import { describe, expect, test, vi } from 'vitest'

import type { FeedFollowingRecord } from '../../db/index.ts'

import { backfillFolloweeTimeline, type BackfillDeps, fetchRecentPublicNotes } from './timeline-backfill.ts'

const ACTOR = 'https://mastodon.example/users/alice'

const followee = (accepted: boolean): FeedFollowingRecord => ({
  accepted,
  actor_uri: ACTOR,
  avatar_url: null,
  created_at: new Date('2026-07-01T00:00:00Z'),
  display_name: 'Alice',
  handle: '@alice@mastodon.example',
  id: 'follow-1',
  inbox_uri: `${ACTOR}/inbox`,
  notify_on_post: true,
  shared_inbox_uri: null,
})

const note = (n: number): Note => new Note({ id: new URL(`https://mastodon.example/notes/${n}`) })

/** A deps builder that records the notes handed to `ingestNote`. */
const makeDeps = (overrides: Partial<BackfillDeps> = {}): BackfillDeps & { ingested: string[] } => {
  const ingested: string[] = []
  return {
    fetchRecentNotes: async () => [note(1), note(2)],
    getFollowee: async () => followee(true),
    ingested,
    ingestNote: async (_user, n) => {
      ingested.push(n.id?.href ?? '')
    },
    ...overrides,
  }
}

describe('backfillFolloweeTimeline', () => {
  test('ingests each fetched note for the recipient and returns the count', async () => {
    const deps = makeDeps()
    const count = await backfillFolloweeTimeline(deps, 'bob', ACTOR)
    expect(count).toBe(2)
    expect(deps.ingested).toEqual(['https://mastodon.example/notes/1', 'https://mastodon.example/notes/2'])
  })

  test('passes the resolved followee through to ingestNote', async () => {
    const seen: FeedFollowingRecord[] = []
    const deps = makeDeps({
      fetchRecentNotes: async () => [note(1)],
      ingestNote: async (_user, _note, f) => {
        seen.push(f)
      },
    })
    await backfillFolloweeTimeline(deps, 'bob', ACTOR)
    expect(seen).toHaveLength(1)
    expect(seen[0].actor_uri).toBe(ACTOR)
  })

  test('skips (no outbox fetch) when the follow is not accepted', async () => {
    let fetched = false
    const deps = makeDeps({
      fetchRecentNotes: async () => {
        fetched = true
        return [note(1)]
      },
      getFollowee: async () => followee(false),
    })
    expect(await backfillFolloweeTimeline(deps, 'bob', ACTOR)).toBe(0)
    expect(fetched).toBe(false)
  })

  test('skips when there is no such follow', async () => {
    const deps = makeDeps({ getFollowee: async () => null })
    expect(await backfillFolloweeTimeline(deps, 'bob', ACTOR)).toBe(0)
  })

  test('returns 0 when the outbox fetch fails (best-effort)', async () => {
    const deps = makeDeps({
      fetchRecentNotes: async () => {
        throw new Error('outbox unreachable')
      },
    })
    expect(await backfillFolloweeTimeline(deps, 'bob', ACTOR)).toBe(0)
  })

  test('returns 0 when the followee lookup throws (e.g. missing DB)', async () => {
    const deps = makeDeps({
      getFollowee: async () => {
        throw new Error('missing database')
      },
    })
    expect(await backfillFolloweeTimeline(deps, 'bob', ACTOR)).toBe(0)
  })

  test('continues past a single note that fails to ingest', async () => {
    const deps = makeDeps({
      fetchRecentNotes: async () => [note(1), note(2), note(3)],
      ingestNote: async (_user, n) => {
        if (n.id?.href.endsWith('/2')) throw new Error('bad note')
      },
    })
    // Two of three succeed; the failing one is skipped, not fatal.
    expect(await backfillFolloweeTimeline(deps, 'bob', ACTOR)).toBe(2)
  })
})

describe('backfill signs as the recipient', () => {
  test('hands the recipient to fetchRecentNotes', async () => {
    const fetchRecentNotes = vi.fn(async () => [note(1)])
    await backfillFolloweeTimeline(makeDeps({ fetchRecentNotes }), 'bob', ACTOR, 5)
    expect(fetchRecentNotes).toHaveBeenCalledWith('bob', ACTOR, 5)
  })

  test('every fetch of the actor, its outbox and its items uses the recipient’s signed loader', async () => {
    const signedLoader = async () => ({ contextUrl: null, document: {}, documentUrl: '' })
    const outboxId = new URL(`${ACTOR}/outbox`)
    const outbox = new Collection({ id: outboxId })
    const getDocumentLoader = vi.fn(async () => signedLoader)
    const lookupObject = vi.fn(async (uri: string | URL) =>
      uri.toString() === ACTOR ? new Person({ id: new URL(ACTOR), outbox: outboxId }) : outbox,
    )
    const getObject = vi.fn(async () => note(7))
    const create = Object.assign(new Create({ id: new URL(`${ACTOR}/activities/7`) }), { getObject })
    const traverseCollection = vi.fn(async function* () {
      yield create
    })
    const ctx = { getDocumentLoader, lookupObject, traverseCollection }
    const federation = { createContext: () => ctx } as unknown as Federation<void>

    const notes = await fetchRecentPublicNotes(federation, 'https://aurboda.example', 'bob', ACTOR, 5)

    expect(notes.map((n) => n.id?.href)).toEqual(['https://mastodon.example/notes/7'])
    expect(getDocumentLoader).toHaveBeenCalledWith({ identifier: 'bob' })
    expect(lookupObject).toHaveBeenCalledWith(ACTOR, { documentLoader: signedLoader })
    expect(lookupObject).toHaveBeenCalledWith(outboxId, { documentLoader: signedLoader })
    expect(traverseCollection).toHaveBeenCalledWith(outbox, {
      documentLoader: signedLoader,
      suppressError: true,
    })
    expect(getObject).toHaveBeenCalledWith({ documentLoader: signedLoader, suppressError: true })
  })
})
