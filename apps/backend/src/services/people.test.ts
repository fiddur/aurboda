import { describe, expect, test } from 'vitest'

import { fakePeopleDeps, personRecord } from '../test/fake-people-deps.ts'
import {
  addPerson,
  addPersonDate,
  deletePersonById,
  deletePersonDateById,
  getPersonDetail,
  HANDLES_UNAVAILABLE,
  listImportantDates,
  listPeopleView,
  listPersonPosts,
  raiseDueImportantDates,
  restorePersonById,
  serializePerson,
  updatePersonById,
  updatePersonDateById,
} from './people.ts'

const USER = 'alice'
const ANNA_ACTOR = {
  actor_uri: 'https://example.social/users/anna',
  handle: '@anna@example.social',
  icon: 'https://example.social/anna.png',
  name: 'Anna A.',
}

const setup = (options: Parameters<typeof fakePeopleDeps>[0] = {}) => {
  const fake = fakePeopleDeps(options)
  fake.actors.set('@anna@example.social', ANNA_ACTOR)
  return fake
}

const value = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

describe('serializePerson', () => {
  test('writes the birthday with or without a year and adds purge_at to a deleted person', () => {
    const deleted = personRecord({
      birth_day: 29,
      birth_month: 2,
      deleted_at: new Date('2026-11-01T00:00:00Z'),
    })
    expect(serializePerson(deleted)).toMatchObject({
      birth_date: '--02-29',
      deleted_at: '2026-11-01T00:00:00.000Z',
      purge_at: '2026-12-01T00:00:00.000Z',
    })
    expect(serializePerson(personRecord({ birth_day: 5, birth_month: 3, birth_year: 1990 })).birth_date).toBe(
      '1990-03-05',
    )
    expect(serializePerson(personRecord())).not.toHaveProperty('deleted_at')
  })
})

describe('addPerson and updatePersonById', () => {
  test('stores the fields, trimming text and blanking empty ones', async () => {
    const { deps } = setup()
    const person = value(
      await addPerson(deps, USER, {
        birth_date: '1990-04-12',
        birthday_notify_days_before: 3,
        name: '  Anna ',
        pronouns: ' ',
        relationship: ' friend ',
      }),
    )
    expect(person).toMatchObject({
      actor: null,
      birth_date: '1990-04-12',
      birthday_notify_days_before: 3,
      name: 'Anna',
      pronouns: null,
      relationship: 'friend',
    })
  })

  test('a handle is resolved and stored as the actor, and null clears it', async () => {
    const { deps, people } = setup()
    const person = value(await addPerson(deps, USER, { handle: '@anna@example.social', name: 'Anna' }))
    expect(person.actor).toEqual({
      following: false,
      handle: '@anna@example.social',
      icon: ANNA_ACTOR.icon,
      name: 'Anna A.',
      uri: ANNA_ACTOR.actor_uri,
    })
    expect(people.get(person.id)?.actor_uri).toBe(ANNA_ACTOR.actor_uri)
    const cleared = value(await updatePersonById(deps, USER, person.id, { handle: null }))
    expect(cleared.actor).toBeNull()
    expect(people.get(person.id)).toMatchObject({ actor_handle: null, actor_uri: null })
  })

  test('an unresolvable handle is a 400 with the message a follow gives', async () => {
    const { deps } = setup()
    expect(await addPerson(deps, USER, { handle: '@nobody@nowhere', name: 'X' })).toEqual({
      error: 'Could not resolve an actor for “@nobody@nowhere”.',
      ok: false,
      status: 400,
    })
  })

  test('a handle is refused where federation is not set up', async () => {
    const { deps } = setup({ resolve: false })
    expect(await addPerson(deps, USER, { handle: '@anna@example.social', name: 'Anna' })).toMatchObject({
      error: HANDLES_UNAVAILABLE,
      status: 400,
    })
  })

  test('a second live profile for the same actor is a 409 naming the first', async () => {
    const { deps } = setup()
    const first = value(await addPerson(deps, USER, { handle: '@anna@example.social', name: 'Anna' }))
    expect(await addPerson(deps, USER, { handle: '@anna@example.social', name: 'Annie' })).toMatchObject({
      error: 'Another person already has this fediverse account: Anna',
      status: 409,
    })
    expect(
      value(await updatePersonById(deps, USER, first.id, { handle: '@anna@example.social' })).actor?.uri,
    ).toBe(ANNA_ACTOR.actor_uri)
  })

  test('null clears the birthday; an unknown person is a 404', async () => {
    const { deps } = setup()
    const person = value(await addPerson(deps, USER, { birth_date: '--06-01', name: 'Bo' }))
    expect(person.birth_date).toBe('--06-01')
    expect(value(await updatePersonById(deps, USER, person.id, { birth_date: null })).birth_date).toBeNull()
    expect(await updatePersonById(deps, USER, 'nope', { name: 'X' })).toMatchObject({ status: 404 })
  })
})

describe('the actor read at query time', () => {
  test('prefers the follow row, then the timeline, then the cache, and refreshes a stale cache', async () => {
    const fake = setup()
    const person = value(await addPerson(fake.deps, USER, { handle: '@anna@example.social', name: 'Anna' }))
    fake.timeline.push({
      actor_uri: ANNA_ACTOR.actor_uri,
      avatar_url: 'https://example.social/new.png',
      display_name: 'Anna B.',
      handle: '@anna@example.social',
    })
    let [listed] = await listPeopleView(fake.deps, USER)
    expect(listed?.actor).toMatchObject({
      following: false,
      icon: 'https://example.social/new.png',
      name: 'Anna B.',
    })
    expect(fake.people.get(person.id)?.actor_name).toBe('Anna A.')

    fake.following.push({
      accepted: true,
      actor_uri: ANNA_ACTOR.actor_uri,
      avatar_url: null,
      display_name: 'Anna C.',
      handle: '@anna@example.social',
    })
    ;[listed] = await listPeopleView(fake.deps, USER)
    expect(listed?.actor).toMatchObject({
      following: true,
      icon: 'https://example.social/new.png',
      name: 'Anna C.',
    })

    const detail = await getPersonDetail(fake.deps, USER, person.id)
    expect(detail?.actor?.name).toBe('Anna C.')
    expect(fake.people.get(person.id)).toMatchObject({
      actor_icon: 'https://example.social/new.png',
      actor_name: 'Anna C.',
    })
  })
})

describe('soft delete', () => {
  test('a deleted person is gone from lists, details, dates and posts until restored', async () => {
    const fake = setup()
    const person = value(await addPerson(fake.deps, USER, { birth_date: '1990-11-25', name: 'Anna' }))
    value(await addPersonDate(fake.deps, USER, person.id, { day: 1, label: 'Wedding', month: 12 }))

    expect(await deletePersonById(fake.deps, USER, person.id)).toBe(true)
    expect(await listPeopleView(fake.deps, USER)).toEqual([])
    expect(await getPersonDetail(fake.deps, USER, person.id)).toBeNull()
    expect(value(await listImportantDates(fake.deps, USER, {})).dates).toEqual([])
    expect(await listPersonPosts(fake.deps, USER, person.id)).toMatchObject({ status: 404 })
    expect(await addPersonDate(fake.deps, USER, person.id, { day: 1, label: 'x', month: 1 })).toMatchObject({
      status: 404,
    })
    const [deleted] = await listPeopleView(fake.deps, USER, { deleted: true })
    expect(deleted).toMatchObject({ id: person.id, purge_at: expect.any(String) })

    const restored = value(await restorePersonById(fake.deps, USER, person.id))
    expect(restored.id).toBe(person.id)
    expect(value(await listImportantDates(fake.deps, USER, {})).dates).toHaveLength(2)
  })

  test('restoring is refused while another live profile holds the same actor', async () => {
    const fake = setup()
    const first = value(await addPerson(fake.deps, USER, { handle: '@anna@example.social', name: 'Anna' }))
    await deletePersonById(fake.deps, USER, first.id)
    value(await addPerson(fake.deps, USER, { handle: '@anna@example.social', name: 'Annie' }))
    expect(await restorePersonById(fake.deps, USER, first.id)).toMatchObject({ status: 409 })
  })

  test('purge removes the person for good, deleted or not', async () => {
    const fake = setup()
    const person = value(await addPerson(fake.deps, USER, { name: 'Anna' }))
    expect(await deletePersonById(fake.deps, USER, person.id, { purge: true })).toBe(true)
    expect(fake.people.size).toBe(0)
    expect(await restorePersonById(fake.deps, USER, person.id)).toMatchObject({ status: 404 })
    expect(await deletePersonById(fake.deps, USER, 'not-a-uuid')).toBe(false)
  })
})

describe('dates', () => {
  test('add, change and delete; a change to an unreal date is refused', async () => {
    const { deps } = setup()
    const person = value(await addPerson(deps, USER, { name: 'Anna' }))
    const date = value(await addPersonDate(deps, USER, person.id, { day: 29, label: 'Leap', month: 2 }))
    expect(date).toMatchObject({ kind: 'other', notify_days_before: null, year: null })
    expect(await updatePersonDateById(deps, USER, person.id, date.id, { year: 2027 })).toMatchObject({
      error: 'Not a real date',
      status: 400,
    })
    expect(value(await updatePersonDateById(deps, USER, person.id, date.id, { year: 2028 })).year).toBe(2028)
    expect(value(await deletePersonDateById(deps, USER, person.id, date.id))).toBe(true)
    expect(await deletePersonDateById(deps, USER, person.id, date.id)).toMatchObject({ status: 404 })
  })
})

describe('listImportantDates', () => {
  test('defaults to today to 60 days on in the user’s zone and lists birthdays and dates', async () => {
    const { deps } = setup()
    const person = value(await addPerson(deps, USER, { birth_date: '1990-12-24', name: 'Anna' }))
    value(
      await addPersonDate(deps, USER, person.id, {
        day: 1,
        kind: 'anniversary',
        label: 'Wedding',
        month: 1,
        year: 2020,
      }),
    )
    const view = value(await listImportantDates(deps, USER, {}))
    expect(view).toMatchObject({ from: '2026-11-20', timezone: 'Europe/Stockholm', to: '2027-01-19' })
    expect(view.dates.map((d) => [d.date, d.label, d.years])).toEqual([
      ['2026-12-24', "Anna's birthday", 36],
      ['2027-01-01', 'Wedding', 7],
    ])
  })

  test('leaves out archived people and refuses a window too long or backwards', async () => {
    const { deps } = setup()
    value(await addPerson(deps, USER, { archived: true, birth_date: '--12-01', name: 'Old friend' }))
    expect(value(await listImportantDates(deps, USER, {})).dates).toEqual([])
    expect(await listImportantDates(deps, USER, { from: '2026-01-01', to: '2027-02-06' })).toMatchObject({
      status: 400,
    })
    expect(await listImportantDates(deps, USER, { from: '2026-02-01', to: '2026-01-01' })).toMatchObject({
      status: 400,
    })
  })
})

describe('listPersonPosts', () => {
  test('lists the posts of a person with a handle, bounded, and 404s without one', async () => {
    const fake = setup()
    const withHandle = value(
      await addPerson(fake.deps, USER, { handle: '@anna@example.social', name: 'Anna' }),
    )
    const without = value(await addPerson(fake.deps, USER, { name: 'Bo' }))
    const post = { id: 'p1' } as never
    fake.posts.set(ANNA_ACTOR.actor_uri, [post, post, post])
    expect(value(await listPersonPosts(fake.deps, USER, withHandle.id, 2))).toHaveLength(2)
    expect(await listPersonPosts(fake.deps, USER, without.id)).toMatchObject({ status: 404 })
  })
})

describe('raiseDueImportantDates', () => {
  test('raises the due birthdays and dates once each, with a dedupe key and a link to the person', async () => {
    const fake = setup({ now: new Date('2026-12-21T08:00:00Z') })
    const anna = value(
      await addPerson(fake.deps, USER, {
        birth_date: '1990-12-24',
        birthday_notify_days_before: 3,
        name: 'Anna',
      }),
    )
    const date = value(
      await addPersonDate(fake.deps, USER, anna.id, {
        day: 21,
        label: 'Name day',
        month: 12,
        notify_days_before: 0,
      }),
    )
    value(await addPersonDate(fake.deps, USER, anna.id, { day: 25, label: 'Quiet', month: 12 }))
    expect(await raiseDueImportantDates(fake.deps, USER)).toBe(2)
    expect(fake.raised).toEqual(
      expect.arrayContaining([
        {
          data: { date_id: null, occurrence_date: '2026-12-24', person_id: anna.id },
          dedupe_key: `important_date:birthday:${anna.id}:2026-12-24`,
          link: `/people/${anna.id}`,
          title: "Anna's birthday is in 3 days (turns 36)",
          type: 'important_date',
        },
        {
          data: { date_id: date.id, occurrence_date: '2026-12-21', person_id: anna.id },
          dedupe_key: `important_date:${date.id}:2026-12-21`,
          link: `/people/${anna.id}`,
          title: 'Anna: Name day is today',
          type: 'important_date',
        },
      ]),
    )
  })

  test('a deleted person raises nothing', async () => {
    const fake = setup({ now: new Date('2026-12-21T08:00:00Z') })
    const anna = value(
      await addPerson(fake.deps, USER, {
        birth_date: '1990-12-24',
        birthday_notify_days_before: 3,
        name: 'Anna',
      }),
    )
    await deletePersonById(fake.deps, USER, anna.id)
    expect(await raiseDueImportantDates(fake.deps, USER)).toBe(0)
  })
})
