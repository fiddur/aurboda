import { describe, expect, test } from 'vitest'

import {
  type ActivityPeopleDeps,
  activityPeopleError,
  activityRowIds,
  peopleOfActivities,
} from './activity-people.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const ROW1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ROW2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const deps = (
  linked: Record<string, { id: string; name: string }[]> = {},
): ActivityPeopleDeps & { asked: string[][] } => {
  const asked: string[][] = []
  return {
    asked,
    listLiveIds: async (_user, ids) => ids.filter((id) => id === A),
    peopleFor: async (_user, ids) => {
      asked.push(ids)
      return new Map(Object.entries(linked).filter(([id]) => ids.includes(id)))
    },
  }
}

describe('activityPeopleError', () => {
  test('is null for no people and names every id that is not a live person', async () => {
    expect(await activityPeopleError('u', undefined, deps())).toBeNull()
    expect(await activityPeopleError('u', [], deps())).toBeNull()
    expect(await activityPeopleError('u', [A], deps())).toBeNull()
    expect(await activityPeopleError('u', [A, B, 'x'], deps())).toBe(`Unknown people: ${B}, x`)
  })
})

describe('peopleOfActivities', () => {
  test('unions the people over each item’s rows, sorted by name, in one lookup', async () => {
    const d = deps({
      [ROW1]: [{ id: B, name: 'Bo' }],
      [ROW2]: [
        { id: A, name: 'Anna' },
        { id: B, name: 'Bo' },
      ],
    })
    const result = await peopleOfActivities(
      'u',
      [{ id: `merged:${ROW1}`, source_ids: [ROW2] }, { id: ROW1 }, { id: 'nope' }],
      activityRowIds,
      d,
    )
    expect(result).toEqual([
      [
        { id: A, name: 'Anna' },
        { id: B, name: 'Bo' },
      ],
      [{ id: B, name: 'Bo' }],
      undefined,
    ])
    expect(d.asked).toEqual([[ROW1, ROW2]])
  })

  test('makes no lookup without row ids', async () => {
    const d = deps()
    expect(await peopleOfActivities('u', [{}], activityRowIds, d)).toEqual([undefined])
    expect(d.asked).toEqual([])
  })
})
