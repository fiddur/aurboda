import type { ActivityPerson } from '@aurboda/api-spec'

import { getPeopleForActivities, listLivePersonIds } from '../db/index.ts'
import { UUID_RE } from '../utils.ts'

export interface ActivityPeopleDeps {
  listLiveIds: (user: string, ids: string[]) => Promise<string[]>
  peopleFor: (user: string, activityIds: string[]) => Promise<Map<string, ActivityPerson[]>>
}

export const activityPeopleDeps: ActivityPeopleDeps = {
  listLiveIds: (user, ids) => listLivePersonIds(user, ids),
  peopleFor: (user, ids) => getPeopleForActivities(user, ids),
}

/** Why `ids` cannot be an activity's people (naming the ids that are not live people), or null. */
export const activityPeopleError = async (
  user: string,
  ids: string[] | undefined,
  deps: ActivityPeopleDeps = activityPeopleDeps,
): Promise<string | null> => {
  if (!ids || ids.length === 0) return null
  const wellFormed = ids.filter((id) => UUID_RE.test(id))
  const live = new Set((await deps.listLiveIds(user, wellFormed)).map((id) => id.toLowerCase()))
  const unknown = ids.filter((id) => !UUID_RE.test(id) || !live.has(id.toLowerCase()))
  return unknown.length === 0 ? null : `Unknown people: ${unknown.join(', ')}`
}

const byName = (a: ActivityPerson, b: ActivityPerson): number =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

/** The people of each item (undefined when none), the union over the activity rows `rowIdsOf` names. */
export const peopleOfActivities = async <T>(
  user: string,
  items: T[],
  rowIdsOf: (item: T) => (string | undefined)[],
  deps: ActivityPeopleDeps = activityPeopleDeps,
): Promise<(ActivityPerson[] | undefined)[]> => {
  const idsPerItem = items.map((item) =>
    [...new Set(rowIdsOf(item))].filter((id): id is string => id !== undefined && UUID_RE.test(id)),
  )
  const allIds = [...new Set(idsPerItem.flat())]
  if (allIds.length === 0) return items.map(() => undefined)
  const linked = await deps.peopleFor(user, allIds)
  return idsPerItem.map((ids) => {
    const people = new Map<string, ActivityPerson>()
    for (const id of ids) for (const person of linked.get(id) ?? []) people.set(person.id, person)
    return people.size === 0 ? undefined : [...people.values()].sort(byName)
  })
}

/** The rows of a list item: its own id (without a `merged:` prefix) and the rows folded into it. */
export const activityRowIds = (item: {
  id?: string
  source_ids?: string[]
  override_target_ids?: string[]
}): (string | undefined)[] => [
  item.id?.replace(/^merged:/, ''),
  ...(item.source_ids ?? []),
  ...(item.override_target_ids ?? []),
]

/** The people of one activity shown over the rows `rowIds`; undefined when none. */
export const activityPeopleOf = async (
  user: string,
  rowIds: (string | undefined)[],
  deps: ActivityPeopleDeps = activityPeopleDeps,
): Promise<ActivityPerson[] | undefined> => (await peopleOfActivities(user, [rowIds], (ids) => ids, deps))[0]
