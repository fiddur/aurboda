import type { JournalEntryRef, TimelineEntry } from '@aurboda/api-spec'

import type { PersonDateRecord, PersonRecord } from '../db/index.ts'
import type { Activity } from '../db/types.ts'
import type { PeopleDeps, ResolvedActor } from '../services/people.ts'

import {
  listPersonActivityPage,
  type PersonActivitiesDeps,
  personActivitySummary,
} from '../services/person-activities.ts'

export const NOW = new Date('2026-11-20T10:00:00Z')

let counter = 0
const nextId = (): string => {
  counter++
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

export const personRecord = (overrides: Partial<PersonRecord> = {}): PersonRecord => ({
  actor_cached_at: null,
  actor_handle: null,
  actor_icon: null,
  actor_name: null,
  actor_uri: null,
  archived: false,
  birth_day: null,
  birth_month: null,
  birth_year: null,
  birthday_notify_days_before: null,
  created_at: NOW,
  deleted_at: null,
  id: nextId(),
  name: 'Anna',
  pronouns: null,
  relationship: null,
  updated_at: NOW,
  ...overrides,
})

export interface FakePeople {
  deps: PeopleDeps
  people: Map<string, PersonRecord>
  dates: Map<string, PersonDateRecord>
  raised: Parameters<PeopleDeps['raise']>[1][]
  actors: Map<string, ResolvedActor>
  following: Awaited<ReturnType<PeopleDeps['actorPresentations']>>['following']
  timeline: Awaited<ReturnType<PeopleDeps['actorPresentations']>>['timeline']
  activities: Map<string, Activity[]>
  posts: Map<string, TimelineEntry[]>
  journalEntries: Map<string, JournalEntryRef[]>
}

const startUs = (a: Activity): bigint => BigInt(a.start_time.getTime()) * 1000n

/** Every activity is its own group: merging is the database's and the merge's business, not this fake's. */
const fakeActivityDeps = (activities: Map<string, Activity[]>): PersonActivitiesDeps => {
  const matching = (personId: string, filter: Parameters<PersonActivitiesDeps['countGroups']>[2]) =>
    (activities.get(personId) ?? [])
      .filter(
        (a) =>
          (!filter.types || filter.types.includes(a.activity_type)) &&
          (!filter.start || a.start_time >= filter.start) &&
          (!filter.end || a.start_time <= filter.end),
      )
      .toSorted((a, b) => Number(startUs(b) - startUs(a)) || b.id!.localeCompare(a.id!))
  return {
    categoryMap: async () => new Map(),
    countByType: async (_user, personId) => {
      const counts = new Map<string, number>()
      for (const a of matching(personId, {})) {
        counts.set(a.activity_type, (counts.get(a.activity_type) ?? 0) + 1)
      }
      return [...counts]
        .map(([activity_type, count]) => ({ activity_type, count }))
        .toSorted((a, b) => b.count - a.count || a.activity_type.localeCompare(b.activity_type))
    },
    countGroups: async (_user, personId, filter) => matching(personId, filter).length,
    expandTypes: async (_user, types) => types,
    listGroups: async (_user, personId, filter, { before, limit }) =>
      matching(personId, filter)
        .filter(
          (a) =>
            !before ||
            startUs(a) < BigInt(before.start_us) ||
            (startUs(a) === BigInt(before.start_us) && a.id! < before.id),
        )
        .slice(0, limit)
        .map((a) => ({ activity_type: a.activity_type, id: a.id!, start_us: String(startUs(a)) })),
    members: async (_user, ids) => [
      ...new Map(
        [...activities.values()]
          .flat()
          .filter((a) => ids.includes(a.id!))
          .map((a) => [a.id, a]),
      ).values(),
    ],
    typeNames: async () => new Map(),
  }
}

/** An in-memory PeopleDeps; `actors` maps a handle to what it resolves to. */
export const fakePeopleDeps = (
  options: { resolve?: boolean; now?: Date; timezone?: string } = {},
): FakePeople => {
  const fake: Omit<FakePeople, 'deps'> = {
    activities: new Map(),
    actors: new Map(),
    dates: new Map(),
    following: [],
    journalEntries: new Map(),
    people: new Map(),
    posts: new Map(),
    raised: [],
    timeline: [],
  }
  const live = (id: string) => {
    const person = fake.people.get(id)
    return person && !person.deleted_at ? person : null
  }
  const applyActor = (person: PersonRecord, fields: Parameters<PeopleDeps['update']>[2]): PersonRecord => {
    if (fields.actor_uri === undefined) return person
    return {
      ...person,
      actor_handle: fields.actor_cache?.actor_handle ?? null,
      actor_icon: fields.actor_cache?.actor_icon ?? null,
      actor_name: fields.actor_cache?.actor_name ?? null,
      actor_uri: fields.actor_uri,
    }
  }
  const defined = <T extends object>(fields: T): Partial<T> =>
    Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<T>
  const activityDeps = fakeActivityDeps(fake.activities)
  const deps: PeopleDeps = {
    activityPage: (user, personId, query) => listPersonActivityPage(user, personId, query, activityDeps),
    activitySummary: (user, personId) => personActivitySummary(user, personId, activityDeps),
    actorPresentations: async (_user, uris) => ({
      following: fake.following.filter((row) => uris.includes(row.actor_uri)),
      timeline: fake.timeline.filter((row) => uris.includes(row.actor_uri)),
    }),
    deleteDate: async (_user, personId, dateId) =>
      fake.dates.get(dateId)?.person_id === personId && fake.dates.delete(dateId),
    get: async (_user, id) => live(id),
    getByActor: async (_user, uri) =>
      [...fake.people.values()].find((p) => p.actor_uri === uri && !p.deleted_at) ?? null,
    getDate: async (_user, personId, dateId) => {
      const date = fake.dates.get(dateId)
      return date?.person_id === personId ? date : null
    },
    getTimezone: async () => options.timezone ?? 'Europe/Stockholm',
    insert: async (_user, input) => {
      const { actor_cache: _cache, actor_uri: _uri, ...rest } = input
      const person = applyActor(personRecord(defined(rest) as Partial<PersonRecord>), input)
      fake.people.set(person.id, person)
      return person
    },
    insertDate: async (_user, personId, input) => {
      const date: PersonDateRecord = {
        created_at: NOW,
        day: input.day,
        id: nextId(),
        kind: input.kind,
        label: input.label,
        month: input.month,
        notify_days_before: input.notify_days_before ?? null,
        person_id: personId,
        updated_at: NOW,
        year: input.year ?? null,
      }
      fake.dates.set(date.id, date)
      return date
    },
    list: async (_user, { include_archived }) =>
      [...fake.people.values()].filter((p) => !p.deleted_at && (include_archived || !p.archived)),
    listDateSources: async () =>
      [...fake.people.values()]
        .filter((p) => !p.deleted_at && !p.archived)
        .flatMap((p) => [
          ...[...fake.dates.values()]
            .filter((d) => d.person_id === p.id)
            .map((d) => ({
              date_id: d.id,
              day: d.day,
              kind: d.kind,
              label: d.label,
              month: d.month,
              notify_days_before: d.notify_days_before,
              person_id: p.id,
              person_name: p.name,
              year: d.year,
            })),
          ...(p.birth_month && p.birth_day
            ? [
                {
                  date_id: null,
                  day: p.birth_day,
                  kind: 'birthday',
                  label: null,
                  month: p.birth_month,
                  notify_days_before: p.birthday_notify_days_before,
                  person_id: p.id,
                  person_name: p.name,
                  year: p.birth_year,
                },
              ]
            : []),
        ]),
    listDates: async (_user, personId) => [...fake.dates.values()].filter((d) => d.person_id === personId),
    listDeleted: async () => [...fake.people.values()].filter((p) => p.deleted_at),
    listJournalEntries: async (_user, personId) => fake.journalEntries.get(personId) ?? [],
    listPosts: async (_user, uri, limit) => (fake.posts.get(uri) ?? []).slice(0, limit),
    now: () => options.now ?? NOW,
    purge: async (_user, id) => {
      for (const [dateId, date] of fake.dates) if (date.person_id === id) fake.dates.delete(dateId)
      return fake.people.delete(id)
    },
    raise: async (_user, input) => {
      fake.raised.push(input)
    },
    resolveHandle:
      options.resolve === false
        ? undefined
        : async (_user, handle) => {
            const actor = fake.actors.get(handle)
            return actor
              ? { actor, ok: true }
              : { error: `Could not resolve an actor for “${handle}”.`, ok: false }
          },
    restore: async (_user, id) => {
      const person = fake.people.get(id)
      if (!person) return { status: 'not_found' }
      if (!person.deleted_at) return { person, status: 'live' }
      const holder = [...fake.people.values()].find(
        (p) => p.id !== id && !p.deleted_at && person.actor_uri && p.actor_uri === person.actor_uri,
      )
      if (holder) return { holder, person, status: 'actor_taken' }
      const restored = { ...person, deleted_at: null }
      fake.people.set(id, restored)
      return { person: restored, status: 'restored' }
    },
    softDelete: async (_user, id) => {
      const person = live(id)
      if (!person) return false
      fake.people.set(id, { ...person, deleted_at: NOW })
      return true
    },
    update: async (_user, id, fields) => {
      const person = live(id)
      if (!person) return null
      const { actor_cache: _cache, actor_uri: _uri, ...rest } = fields
      const next = applyActor({ ...person, ...defined(rest) }, fields)
      fake.people.set(id, next)
      return next
    },
    updateActorCache: async (_user, id, uri, cache) => {
      const person = fake.people.get(id)
      if (person?.actor_uri === uri) fake.people.set(id, { ...person, ...cache })
    },
    updateDate: async (_user, personId, dateId, fields) => {
      const date = fake.dates.get(dateId)
      if (date?.person_id !== personId) return null
      const next = { ...date, ...defined(fields) }
      fake.dates.set(dateId, next)
      return next
    },
  }
  return { ...fake, deps }
}
