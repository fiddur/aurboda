/**
 * FEP-044f quote posts against a real per-user database: an inbound
 * `QuoteRequest` is answered with an `Accept` carrying a `QuoteAuthorization`
 * stamp (or a `Reject`), and the stamp — like the policy on our Notes — is what
 * a remote server dereferences to verify the quote.
 */
import type { FeedVisibility } from '@aurboda/api-spec'

import { Accept, Delete, Note, Person, QuoteRequest, Reject, Tombstone } from '@fedify/fedify/vocab'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { insertActivity } from '../../db/activities/index.ts'
import { listFeedQuoteAuthorizations } from '../../db/feed-quotes.ts'
import { createFeedPost, deleteFeedPost, updateFeedPost } from '../../db/feed.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { actorDocument, inboxContext } from '../../test/inbox-context.ts'
import { buildFeedCreate, type FeedDeliveryDeps, revokeQuoteStamps } from './deliver.ts'
import { createFeedFederation, handleInboundDelete, handleInboundQuoteRequest } from './federation.ts'

const CONTAINER_TIMEOUT = 120_000
const ORIGIN = 'https://aurboda.example'
const ALICE = 'https://mastodon.example/users/alice'
const QUOTE = `${ALICE}/statuses/42`
const REQUEST = `${ALICE}/quote_requests/0f0e`
const BOB = 'https://mastodon.example/users/bob'

const fed = createFeedFederation(ORIGIN, `${ORIGIN}/api`)

const notFound = () => new Response('nope', { status: 404 })
const fetchAs2 = (url: string) =>
  fed.fetch(new Request(url, { headers: { Accept: 'application/activity+json' } }), {
    contextData: undefined,
    onNotAcceptable: notFound,
    onNotFound: notFound,
  })

/** An inbox context whose outbound sends are recorded instead of POSTed. */
const inboxCtx = (user: string) => {
  const ctx = inboxContext(fed, ORIGIN, user, {
    [ALICE]: actorDocument(ALICE, 'alice', 'Alice'),
    [BOB]: actorDocument(BOB, 'bob', 'Bob'),
  })
  const sendActivity = vi.fn().mockResolvedValue(undefined)
  Object.assign(ctx, { sendActivity })
  return { ctx, sendActivity }
}

const person = (id: string, username: string) =>
  new Person({ id: new URL(id), inbox: new URL(`${id}/inbox`), preferredUsername: username })

/** A `QuoteRequest` as Mastodon sends it: the quoting Note inlined as the instrument. */
const quoteRequest = (object: string, overrides: { quote?: string; id?: string; actor?: string } = {}) =>
  new QuoteRequest({
    actor: overrides.actor === BOB ? person(BOB, 'bob') : person(ALICE, 'alice'),
    id: new URL(overrides.id ?? REQUEST),
    instrument: new Note({
      attribution: new URL(overrides.actor ?? ALICE),
      content: '<p>Look at this</p>',
      id: new URL(overrides.quote ?? QUOTE),
      quoteUrl: new URL(object),
    }),
    object: new URL(object),
  })

const ownPost = async (user: string, visibility: FeedVisibility = 'public') => {
  const activityId = await insertActivity(user, {
    activity_type: 'exercise',
    end_time: new Date('2026-07-01T07:11:00Z'),
    source: 'garmin',
    start_time: new Date('2026-07-01T06:30:00Z'),
    title: 'Morning run',
  })
  return createFeedPost(user, {
    activity_id: activityId,
    include_chart: false,
    include_map: false,
    included_metrics: ['duration'],
    series_metrics: [],
    visibility,
  })
}

const noteUrl = (user: string, postId: string) => `${ORIGIN}/users/${user}/feed/${postId}`

describe('Quote posts (FEP-044f)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('quote policy on served Notes', () => {
    test('the served feed Note keeps its quote policy through the quant splice', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const doc = (await (await fetchAs2(noteUrl(user, post.id))).json()) as {
        interactionPolicy?: { canQuote?: { automaticApproval?: unknown } }
      }
      expect(doc.interactionPolicy?.canQuote?.automaticApproval).toBe('as:Public')
    })

    test('the delivered Create embeds the Note with its quote policy', async () => {
      const user = getTestUser()
      const post = await ownPost(user, 'unlisted')
      const ctx = fed.createContext(new URL(ORIGIN), undefined)
      const create = await buildFeedCreate(
        ctx,
        user,
        { ...post, include_exercises: false },
        { activity_type: 'exercise', start_time: new Date('2026-07-01T06:30:00Z') },
        `${ORIGIN}/api`,
      )
      const json = (await create.toJsonLd({ format: 'compact' })) as {
        object?: { interactionPolicy?: { canQuote?: { automaticApproval?: unknown } } }
      }
      expect(json.object?.interactionPolicy?.canQuote?.automaticApproval).toBe('as:Public')
    })
  })

  describe('inbound QuoteRequest', () => {
    test('a public post is approved: an Accept with a stamp, and a recorded approval', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const { ctx, sendActivity } = inboxCtx(user)

      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, post.id)))

      const rows = await listFeedQuoteAuthorizations(user, post.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ actor_uri: ALICE, quote_uri: QUOTE, request_uri: REQUEST })

      expect(sendActivity).toHaveBeenCalledTimes(1)
      const [sender, recipient, activity] = sendActivity.mock.calls[0]
      expect(sender).toEqual({ identifier: user })
      expect((recipient as Person).id?.href).toBe(ALICE)
      expect(activity).toBeInstanceOf(Accept)
      const accept = activity as Accept
      expect(accept.actorId?.href).toBe(`${ORIGIN}/users/${user}`)
      expect(accept.objectId?.href).toBe(REQUEST)
      expect(accept.resultId?.href).toBe(`${ORIGIN}/users/${user}/stamps/${rows[0].id}`)
    })

    test('an unlisted post is approved too', async () => {
      const user = getTestUser()
      const post = await ownPost(user, 'unlisted')
      const { ctx, sendActivity } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, post.id)))
      expect(sendActivity.mock.calls[0][2]).toBeInstanceOf(Accept)
    })

    test('a followers-only post is rejected and nothing is recorded', async () => {
      const user = getTestUser()
      const post = await ownPost(user, 'followers')
      const { ctx, sendActivity } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, post.id)))
      expect(sendActivity).toHaveBeenCalledTimes(1)
      const reject = sendActivity.mock.calls[0][2] as Reject
      expect(reject).toBeInstanceOf(Reject)
      expect(reject.actorId?.href).toBe(`${ORIGIN}/users/${user}`)
      expect(reject.objectId?.href).toBe(REQUEST)
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(0)
    })

    test('an unknown post of ours is rejected', async () => {
      const user = getTestUser()
      const { ctx, sendActivity } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, crypto.randomUUID())))
      expect(sendActivity).toHaveBeenCalledTimes(1)
      expect(sendActivity.mock.calls[0][2]).toBeInstanceOf(Reject)
    })

    test('a request for another user’s post on this host is ignored', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const { ctx, sendActivity } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl('someoneelse', post.id)))
      expect(sendActivity).not.toHaveBeenCalled()
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(0)
    })

    test('a quoting Note on a different host than the requester is ignored', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const { ctx, sendActivity } = inboxCtx(user)
      await handleInboundQuoteRequest(
        ctx,
        quoteRequest(noteUrl(user, post.id), { quote: 'https://elsewhere.example/notes/1' }),
      )
      expect(sendActivity).not.toHaveBeenCalled()
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(0)
    })

    test('a request whose id is on a different host than its actor is ignored', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const { ctx, sendActivity } = inboxCtx(user)
      await handleInboundQuoteRequest(
        ctx,
        quoteRequest(noteUrl(user, post.id), { id: 'https://elsewhere.example/quote_requests/1' }),
      )
      expect(sendActivity).not.toHaveBeenCalled()
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(0)
    })

    test('a redelivered request keeps one approval and the same stamp', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const { ctx, sendActivity } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, post.id)))
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, post.id)))
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(1)
      const [first, second] = sendActivity.mock.calls.map((call) => (call[2] as Accept).resultId?.href)
      expect(first).toBeDefined()
      expect(second).toBe(first)
    })
  })

  describe('one quote, one actor', () => {
    test('a request for an approved quote by another actor on its host is rejected', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const { ctx, sendActivity } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, post.id)))
      await handleInboundQuoteRequest(
        ctx,
        quoteRequest(noteUrl(user, post.id), { actor: BOB, id: `${BOB}/quote_requests/1` }),
      )
      expect(sendActivity.mock.calls[0][2]).toBeInstanceOf(Accept)
      const reject = sendActivity.mock.calls[1][2] as Reject
      expect(reject).toBeInstanceOf(Reject)
      expect(reject.objectId?.href).toBe(`${BOB}/quote_requests/1`)
      const rows = await listFeedQuoteAuthorizations(user, post.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].actor_uri).toBe(ALICE)
    })
  })

  describe('inbound Delete of a quoting Note', () => {
    const del = (actor: string, object: string) =>
      new Delete({
        actor: new URL(actor),
        id: new URL(`${object}#delete`),
        object: new Tombstone({ id: new URL(object) }),
      })

    test('by its own actor drops the approval, so the stamp stops resolving', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const { ctx, sendActivity } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, post.id)))
      const stamp = (sendActivity.mock.calls[0][2] as Accept).resultId?.href ?? ''
      await handleInboundDelete(ctx, del(ALICE, QUOTE))
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(0)
      expect((await fetchAs2(stamp)).status).toBe(404)
    })

    test('of the quoting actor itself drops every approval it held', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const { ctx } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, post.id)))
      await handleInboundQuoteRequest(
        ctx,
        quoteRequest(noteUrl(user, post.id), {
          id: `${ALICE}/quote_requests/2`,
          quote: `${ALICE}/statuses/43`,
        }),
      )
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(2)
      await handleInboundDelete(ctx, del(ALICE, ALICE))
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(0)
    })

    test('of another actor leaves an actor’s approvals alone', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const { ctx } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, post.id)))
      await handleInboundDelete(ctx, del(BOB, BOB))
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(1)
    })

    test('by another actor leaves the approval alone', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const { ctx } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, post.id)))
      await handleInboundDelete(ctx, del(BOB, QUOTE))
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(1)
    })
  })

  describe('revoking stamps when a post is unshared', () => {
    const fakeDeps = async () => {
      const ctx = await fed.createContext(new URL(ORIGIN))
      const sendActivity = vi.fn().mockResolvedValue(undefined)
      const lookupObject = vi.fn(async (id: URL) => person(id.href, 'someone'))
      const getDocumentLoader = vi.fn().mockRejectedValue(new Error('unsigned'))
      Object.assign(ctx, { getDocumentLoader, lookupObject, sendActivity })
      const deps: Pick<FeedDeliveryDeps, 'federation' | 'origin'> = {
        federation: { createContext: async () => ctx } as unknown as FeedDeliveryDeps['federation'],
        origin: ORIGIN,
      }
      return { deps, sendActivity }
    }

    const approveAs = async (user: string, postId: string): Promise<string> => {
      const { ctx, sendActivity } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, postId)))
      return (sendActivity.mock.calls[0][2] as Accept).resultId?.href ?? ''
    }

    test('a post narrowed to followers sends the Delete of each stamp to its quoting actor and our followers', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const stamp = await approveAs(user, post.id)
      const narrowed = await updateFeedPost(user, post.id, { visibility: 'followers' })
      const { deps, sendActivity } = await fakeDeps()

      await revokeQuoteStamps(deps, user, narrowed!)

      expect(sendActivity).toHaveBeenCalledTimes(2)
      const recipients = sendActivity.mock.calls.map(([, recipient]) =>
        typeof recipient === 'string' ? recipient : (recipient as Person).id?.href,
      )
      expect(recipients.sort()).toEqual([ALICE, 'followers'].sort())
      for (const [sender, , activity] of sendActivity.mock.calls) {
        expect(sender).toEqual({ identifier: user })
        expect(activity).toBeInstanceOf(Delete)
        const sent = activity as Delete
        expect(sent.actorId?.href).toBe(`${ORIGIN}/users/${user}`)
        expect(sent.objectId?.href).toBe(stamp)
        expect(sent.toIds.map((u) => u.href)).toEqual([ALICE])
        expect(sent.ccIds.map((u) => u.href)).toEqual([`${ORIGIN}/users/${user}/followers`])
      }
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(0)
    })

    test('a public post keeps its stamps and sends nothing', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      await approveAs(user, post.id)
      const { deps, sendActivity } = await fakeDeps()
      await revokeQuoteStamps(deps, user, post)
      expect(sendActivity).not.toHaveBeenCalled()
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(1)
    })

    test('a failed send still drops the approval and does not throw', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      await approveAs(user, post.id)
      const narrowed = await updateFeedPost(user, post.id, { visibility: 'followers' })
      const { deps, sendActivity } = await fakeDeps()
      sendActivity.mockRejectedValue(new Error('connect ECONNREFUSED'))
      await expect(revokeQuoteStamps(deps, user, narrowed!)).resolves.toBeUndefined()
      expect(await listFeedQuoteAuthorizations(user, post.id)).toHaveLength(0)
    })
  })

  describe('the QuoteAuthorization stamp', () => {
    const approve = async (user: string, postId: string): Promise<string> => {
      const { ctx, sendActivity } = inboxCtx(user)
      await handleInboundQuoteRequest(ctx, quoteRequest(noteUrl(user, postId)))
      return (sendActivity.mock.calls[0][2] as Accept).resultId?.href ?? ''
    }

    test('resolves to the stamp a remote server verifies', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const stamp = await approve(user, post.id)
      const res = await fetchAs2(stamp)
      expect(res.status).toBe(200)
      const doc = (await res.json()) as Record<string, unknown>
      expect(doc.type).toBe('QuoteAuthorization')
      expect(doc.id).toBe(stamp)
      expect(doc.attributedTo).toBe(`${ORIGIN}/users/${user}`)
      expect(doc.interactingObject).toBe(QUOTE)
      expect(doc.interactionTarget).toBe(noteUrl(user, post.id))
      expect(JSON.stringify(doc['@context'])).toContain('https://www.w3.org/ns/activitystreams')
    })

    test('an unknown stamp id is not found', async () => {
      const user = getTestUser()
      const res = await fetchAs2(`${ORIGIN}/users/${user}/stamps/${crypto.randomUUID()}`)
      expect(res.status).toBe(404)
    })

    test('unsharing the post (to followers-only) revokes its stamps', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const stamp = await approve(user, post.id)
      await updateFeedPost(user, post.id, { visibility: 'followers' })
      expect((await fetchAs2(stamp)).status).toBe(404)
    })

    test('deleting the post revokes its stamps', async () => {
      const user = getTestUser()
      const post = await ownPost(user)
      const stamp = await approve(user, post.id)
      await deleteFeedPost(user, post.id)
      expect((await fetchAs2(stamp)).status).toBe(404)
    })
  })
})
