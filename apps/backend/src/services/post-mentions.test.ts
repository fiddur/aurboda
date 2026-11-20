import type { PersonActor } from '@aurboda/api-spec'

import { addAutoshareRuleBodySchema, updateAutoshareRuleBodySchema } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import type { Activity, PersonRecord } from '../db/index.ts'

import { personRecord } from '../test/fake-people-deps.ts'
import { type PostMentionDeps, resolveEditedPostMentions, resolvePostMentions } from './post-mentions.ts'

const ACTOR = 'https://example.social/users/anna'
const activity = {
  activity_type: 'running',
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  source: 'manual',
  start_time: new Date('2026-11-01T10:00:00Z'),
} as Activity

const anna = personRecord({ actor_handle: '@anna@example.social', actor_uri: ACTOR, name: 'Anna' })
const bo = personRecord({ name: 'Bo' })
const cy = personRecord({
  actor_handle: '@cy@example.social',
  actor_uri: 'https://example.social/users/cy',
  name: 'Cy',
})

const fakeDeps = (
  people: PersonRecord[],
  linked: string[],
  actors: Map<string, PersonActor> = new Map(),
): PostMentionDeps => ({
  actors: async () => actors,
  getPerson: async (_user, id) => people.find((p) => p.id === id) ?? null,
  linkedPersonIds: async () => linked,
})

describe('resolvePostMentions', () => {
  test('nobody mentioned needs no lookup', async () => {
    const deps = fakeDeps([], [])
    expect(await resolvePostMentions('u', activity, [], deps)).toEqual({ mentions: [], ok: true })
  })

  test('a linked person with a handle becomes the actor and handle, nothing else', async () => {
    const result = await resolvePostMentions('u', activity, [anna.id, anna.id], fakeDeps([anna], [anna.id]))
    expect(result).toEqual({ mentions: [{ actor_uri: ACTOR, handle: '@anna@example.social' }], ok: true })
  })

  test('prefers the handle the account presents now over the cached one', async () => {
    const actors = new Map([
      [ACTOR, { following: true, handle: '@anna2@example.social', icon: null, name: 'Anna', uri: ACTOR }],
    ])
    const result = await resolvePostMentions('u', activity, [anna.id], fakeDeps([anna], [anna.id], actors))
    expect(result).toEqual({ mentions: [{ actor_uri: ACTOR, handle: '@anna2@example.social' }], ok: true })
  })

  test('an unknown or deleted person is refused by id', async () => {
    const missing = '99999999-9999-4999-8999-999999999999'
    const result = await resolvePostMentions('u', activity, [missing], fakeDeps([anna], [anna.id]))
    expect(result).toEqual({ error: `Unknown people: ${missing}`, ok: false })
  })

  test('a person the activity was not with is refused by name', async () => {
    const result = await resolvePostMentions('u', activity, [anna.id, cy.id], fakeDeps([anna, cy], [anna.id]))
    expect(result).toEqual({
      error: 'Only people this activity was with can be mentioned, not Cy',
      ok: false,
    })
  })

  test('a person without a handle is refused by name', async () => {
    const result = await resolvePostMentions('u', activity, [bo.id], fakeDeps([bo], [bo.id]))
    expect(result).toEqual({
      error: 'Only people with a fediverse handle can be mentioned, not Bo',
      ok: false,
    })
  })
})

describe('resolveEditedPostMentions', () => {
  test('clearing needs no activity', async () => {
    const result = await resolveEditedPostMentions('u', null, [], fakeDeps([], []), async () => null)
    expect(result).toEqual({ mentions: [], ok: true })
  })

  test('a post sharing no activity cannot mention anyone', async () => {
    const result = await resolveEditedPostMentions('u', null, [anna.id], fakeDeps([anna], [anna.id]))
    expect(result).toEqual({ error: 'Only an activity share can mention people', ok: false })
  })

  test("resolves against the post's activity", async () => {
    const result = await resolveEditedPostMentions(
      'u',
      activity.id!,
      [anna.id],
      fakeDeps([anna], [anna.id]),
      async () => activity,
    )
    expect(result).toEqual({ mentions: [{ actor_uri: ACTOR, handle: '@anna@example.social' }], ok: true })
  })
})

describe('auto-share rules', () => {
  test('take no mention_people: a rule never mentions anyone', () => {
    const body = { mention_people: [anna.id], name: 'Runs' }
    expect(addAutoshareRuleBodySchema.parse(body)).not.toHaveProperty('mention_people')
    expect(updateAutoshareRuleBodySchema.parse(body)).not.toHaveProperty('mention_people')
  })
})
