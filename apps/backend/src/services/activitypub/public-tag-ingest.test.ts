import { Announce, Create, Delete, Note, Undo } from '@fedify/fedify/vocab'
import { describe, expect, test, vi } from 'vitest'

import type { PublicTagPostInput } from '../central-public-tags.ts'
import type { PublicTagIngest } from './instance-actor.ts'

import { actorDocument, inboxContext, type StubDocuments } from '../../test/inbox-context.ts'
import { createAnnounceListener, createFeedFederation, dropsForReadOnly } from './federation.ts'
import { INSTANCE_ACTOR_ID } from './instance-actor.ts'
import {
  handleInstanceActorAnnounce,
  handleInstanceActorDelete,
  handleInstanceActorUndo,
  isInstanceDelivery,
} from './public-tag-ingest.ts'

const ORIGIN = 'https://aurboda.example'
const PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'
const TAG_ACTOR = 'https://tags.example/user/aurboda'
const AUTHOR = 'https://peer.example/users/bob'
const NOTE_ID = 'https://peer.example/notes/1'
const ANNOUNCE_ID = 'https://tags.example/announce/1'
const NOW = new Date('2026-11-10T00:00:00Z')

const noteDoc = (overrides: Record<string, unknown> = {}) => ({
  '@context': ['https://www.w3.org/ns/activitystreams', { Hashtag: 'as:Hashtag', sensitive: 'as:sensitive' }],
  attributedTo: AUTHOR,
  content: '<p>Hello <script>alert(1)</script>#Aurboda</p>',
  id: NOTE_ID,
  published: '2026-11-01T10:00:00Z',
  tag: [
    {
      href: 'https://peer.example/tags/aurboda',
      name: '#Aurboda',
      type: 'Hashtag',
    },
    {
      href: 'https://peer.example/tags/running',
      name: '#Running',
      type: 'Hashtag',
    },
  ],
  to: [PUBLIC],
  type: 'Note',
  url: 'https://peer.example/@bob/1',
  ...overrides,
})

const baseDocs = (note: Record<string, unknown> = noteDoc()): StubDocuments => ({
  [AUTHOR]: actorDocument(AUTHOR, 'bob', 'Bob'),
  [NOTE_ID]: note,
})

const deps = (followed: Record<string, string> = { [TAG_ACTOR]: 'aurboda' }) => {
  const upserts: PublicTagPostInput[] = []
  const ingest: PublicTagIngest = {
    deletePublicTagPost: vi.fn(async () => true),
    deletePublicTagPostsByActor: vi.fn(async () => 0),
    followedTagActor: async (uri) => (followed[uri] ? { actor_uri: uri, tag: followed[uri] } : null),
    removePublicTagAnnounce: vi.fn(async () => {}),
    upsertPublicTagPost: vi.fn(async (input: PublicTagPostInput) => {
      upserts.push(input)
    }),
  }
  return { ingest, upserts }
}

const federation = createFeedFederation(ORIGIN, `${ORIGIN}/api`)
const ctxFor = (docs: StubDocuments, recipient: string | null = null) =>
  inboxContext(federation, ORIGIN, recipient as string, docs)

const announce = (overrides: { actor?: string; id?: string; object?: URL | Note } = {}) =>
  new Announce({
    actor: new URL(overrides.actor ?? TAG_ACTOR),
    id: new URL(overrides.id ?? ANNOUNCE_ID),
    object: overrides.object ?? new URL(NOTE_ID),
    published: undefined,
  })

describe('isInstanceDelivery', () => {
  test('the shared inbox and the instance actor inbox are the instance actor; a user is not', () => {
    expect(isInstanceDelivery({ recipient: null })).toBe(true)
    expect(isInstanceDelivery({ recipient: INSTANCE_ACTOR_ID })).toBe(true)
    expect(isInstanceDelivery({ recipient: 'alice' })).toBe(false)
  })
})

describe('handleInstanceActorAnnounce', () => {
  test("keeps a followed tag actor's Announce of a public Note, fetched from its own id", async () => {
    const { ingest, upserts } = deps()
    await handleInstanceActorAnnounce(ctxFor(baseDocs()), announce(), ingest, () => NOW)
    expect(upserts).toEqual([
      {
        actor_uri: AUTHOR,
        announce_uris: [ANNOUNCE_ID],
        avatar_url: null,
        content: '<p>Hello #Aurboda</p>',
        display_name: 'Bob',
        handle: '@bob@peer.example',
        images: [],
        local_user: null,
        note_uri: NOTE_ID,
        published_at: new Date('2026-11-01T10:00:00Z'),
        tags: ['aurboda', 'running'],
        url: 'https://peer.example/@bob/1',
      },
    ])
  })

  test('also on the instance actor’s own inbox; a future publish time is clamped to now', async () => {
    const { ingest, upserts } = deps()
    const docs = baseDocs(noteDoc({ published: '2030-01-01T00:00:00Z' }))
    await handleInstanceActorAnnounce(ctxFor(docs, INSTANCE_ACTOR_ID), announce(), ingest, () => NOW)
    expect(upserts[0]?.published_at).toEqual(NOW)
  })

  test("a stranger's Announce, or one from a tag actor not (yet) accepted, is dropped", async () => {
    const { ingest, upserts } = deps({})
    await handleInstanceActorAnnounce(ctxFor(baseDocs()), announce(), ingest, () => NOW)
    const stranger = 'https://evil.example/users/eve'
    const { ingest: other, upserts: otherUpserts } = deps()
    await handleInstanceActorAnnounce(
      ctxFor(baseDocs()),
      announce({ actor: stranger, id: 'https://evil.example/announce/1' }),
      other,
      () => NOW,
    )
    expect(upserts).toEqual([])
    expect(otherUpserts).toEqual([])
  })

  test('an Announce whose id is not on the announcer’s host is dropped', async () => {
    const { ingest, upserts } = deps()
    await handleInstanceActorAnnounce(
      ctxFor(baseDocs()),
      announce({ id: 'https://elsewhere.example/a/1' }),
      ingest,
      () => NOW,
    )
    expect(upserts).toEqual([])
  })

  test('a Note embedded in the Announce body is ignored: only what its id serves counts', async () => {
    const { ingest, upserts } = deps()
    const forged = new Note({
      attribution: new URL(AUTHOR),
      content: 'forged',
      id: new URL('https://peer.example/notes/forged'),
      to: new URL(PUBLIC),
    })
    await handleInstanceActorAnnounce(ctxFor(baseDocs()), announce({ object: forged }), ingest, () => NOW)
    expect(upserts).toEqual([])
  })

  test('a Note not addressed to the Public collection never lands on a public page', async () => {
    const { ingest, upserts } = deps()
    const docs = baseDocs(noteDoc({ cc: [], to: ['https://peer.example/users/bob/followers'] }))
    await handleInstanceActorAnnounce(ctxFor(docs), announce(), ingest, () => NOW)
    expect(upserts).toEqual([])
  })

  test('an unlisted Note, naming the Public collection only in cc, is dropped', async () => {
    const { ingest, upserts } = deps()
    const docs = baseDocs(
      noteDoc({
        cc: [PUBLIC],
        to: ['https://peer.example/users/bob/followers'],
      }),
    )
    await handleInstanceActorAnnounce(ctxFor(docs), announce(), ingest, () => NOW)
    expect(upserts).toEqual([])
  })

  test('a Note behind a content warning, or marked sensitive, is skipped', async () => {
    const { ingest, upserts } = deps()
    await handleInstanceActorAnnounce(
      ctxFor(baseDocs(noteDoc({ summary: 'spoilers' }))),
      announce(),
      ingest,
      () => NOW,
    )
    await handleInstanceActorAnnounce(
      ctxFor(baseDocs(noteDoc({ sensitive: true }))),
      announce(),
      ingest,
      () => NOW,
    )
    expect(upserts).toEqual([])
  })

  test('a Note that does not itself carry the followed tag is dropped', async () => {
    const { ingest, upserts } = deps()
    const docs = baseDocs(
      noteDoc({
        tag: [
          {
            href: 'https://peer.example/tags/running',
            name: '#Running',
            type: 'Hashtag',
          },
        ],
      }),
    )
    await handleInstanceActorAnnounce(ctxFor(docs), announce(), ingest, () => NOW)
    expect(upserts).toEqual([])
  })

  test('a url that is not http(s) falls back to the note id', async () => {
    const { ingest, upserts } = deps()
    const docs = baseDocs(noteDoc({ url: 'javascript:alert(1)' }))
    await handleInstanceActorAnnounce(ctxFor(docs), announce(), ingest, () => NOW)
    expect(upserts[0]?.url).toBe(NOTE_ID)
  })

  test('a reply is skipped', async () => {
    const { ingest, upserts } = deps()
    const docs = baseDocs(noteDoc({ inReplyTo: 'https://peer.example/notes/0' }))
    await handleInstanceActorAnnounce(ctxFor(docs), announce(), ingest, () => NOW)
    expect(upserts).toEqual([])
  })

  test('a Note attributed to an actor on another host, or to one that does not answer, is dropped', async () => {
    const elsewhere = 'https://other.example/users/carol'
    const { ingest, upserts } = deps()
    await handleInstanceActorAnnounce(
      ctxFor({
        ...baseDocs(noteDoc({ attributedTo: elsewhere })),
        [elsewhere]: actorDocument(elsewhere, 'c', 'C'),
      }),
      announce(),
      ingest,
      () => NOW,
    )
    await handleInstanceActorAnnounce(ctxFor({ [NOTE_ID]: noteDoc() }), announce(), ingest, () => NOW)
    expect(upserts).toEqual([])
  })
})

describe('handleInstanceActorUndo', () => {
  test("a followed tag actor's Undo{Announce} removes that Announce, embedded or by id", async () => {
    const { ingest } = deps()
    const ctx = ctxFor({})
    await handleInstanceActorUndo(ctx, new Undo({ actor: new URL(TAG_ACTOR), object: announce() }), ingest)
    await handleInstanceActorUndo(
      ctx,
      new Undo({
        actor: new URL(TAG_ACTOR),
        object: new URL('https://tags.example/announce/2'),
      }),
      ingest,
    )
    expect(ingest.removePublicTagAnnounce).toHaveBeenNthCalledWith(1, ANNOUNCE_ID)
    expect(ingest.removePublicTagAnnounce).toHaveBeenNthCalledWith(2, 'https://tags.example/announce/2')
  })

  test("a stranger's Undo, another actor's Announce, or another activity type removes nothing", async () => {
    const { ingest } = deps()
    const ctx = ctxFor({})
    const stranger = 'https://evil.example/users/eve'
    await handleInstanceActorUndo(ctx, new Undo({ actor: new URL(stranger), object: announce() }), ingest)
    await handleInstanceActorUndo(
      ctx,
      new Undo({
        actor: new URL(TAG_ACTOR),
        object: announce({ actor: 'https://tags.example/user/x' }),
      }),
      ingest,
    )
    await handleInstanceActorUndo(
      ctx,
      new Undo({
        actor: new URL(TAG_ACTOR),
        object: new Create({
          actor: new URL(TAG_ACTOR),
          id: new URL('https://tags.example/c/1'),
        }),
      }),
      ingest,
    )
    await handleInstanceActorUndo(
      ctx,
      new Undo({
        actor: new URL(TAG_ACTOR),
        object: new URL('https://evil.example/announce/1'),
      }),
      ingest,
    )
    expect(ingest.removePublicTagAnnounce).not.toHaveBeenCalled()
  })
})

describe('handleInstanceActorDelete', () => {
  test('deletes the post scoped to the sender', async () => {
    const { ingest } = deps()
    await handleInstanceActorDelete(
      ctxFor({}),
      new Delete({ actor: new URL(AUTHOR), object: new URL(NOTE_ID) }),
      ingest,
    )
    expect(ingest.deletePublicTagPost).toHaveBeenCalledWith(NOTE_ID, AUTHOR)
    expect(ingest.deletePublicTagPostsByActor).not.toHaveBeenCalled()
  })

  test('an actor deleting itself takes every post of theirs', async () => {
    const { ingest } = deps()
    await handleInstanceActorDelete(
      ctxFor({}),
      new Delete({ actor: new URL(AUTHOR), object: new URL(AUTHOR) }),
      ingest,
    )
    expect(ingest.deletePublicTagPostsByActor).toHaveBeenCalledWith(AUTHOR)
    expect(ingest.deletePublicTagPost).not.toHaveBeenCalled()
  })
})

describe('createAnnounceListener', () => {
  test('a shared-inbox Announce from an accepted tag actor reaches the tag ingest, a per-user one the timeline', async () => {
    const { ingest, upserts } = deps()
    const onUserAnnounce = vi.fn(async () => {})
    const listener = createAnnounceListener({
      isReadOnly: async () => false,
      onUserAnnounce,
      publicTagPosts: ingest,
    })

    await listener(ctxFor(baseDocs()), announce())
    expect(upserts.map((u) => u.note_uri)).toEqual([NOTE_ID])
    expect(onUserAnnounce).not.toHaveBeenCalled()

    const perUser = ctxFor(baseDocs(), 'alice')
    const sameActor = announce({ id: 'https://tags.example/announce/2' })
    await listener(perUser, sameActor)
    expect(onUserAnnounce).toHaveBeenCalledWith(perUser, sameActor)
    expect(upserts).toHaveLength(1)
  })

  test('without the tag pages, even a shared-inbox Announce goes the user way', async () => {
    const onUserAnnounce = vi.fn(async () => {})
    const listener = createAnnounceListener({
      isReadOnly: async () => false,
      onUserAnnounce,
    })
    await listener(ctxFor(baseDocs()), announce())
    expect(onUserAnnounce).toHaveBeenCalledTimes(1)
  })
})

describe('dropsForReadOnly', () => {
  test('never drops a delivery with no user recipient', async () => {
    const isReadOnly = vi.fn(async () => true)
    expect(await dropsForReadOnly(ctxFor({}), announce(), isReadOnly)).toBe(false)
    expect(await dropsForReadOnly(ctxFor({}, INSTANCE_ACTOR_ID), announce(), isReadOnly)).toBe(false)
    expect(isReadOnly).not.toHaveBeenCalled()
  })
})
