import type { PersonActor, PostMention } from '@aurboda/api-spec'

import type { Activity, PersonRecord } from '../db/index.ts'

import { getActivityById, getOverlappingActivities, getPeopleForActivities, getPerson } from '../db/index.ts'
import { UUID_RE } from '../utils.ts'
import { defaultPeopleDeps, resolveActors } from './people.ts'

export interface PostMentionDeps {
  /** The live people linked to the activity or any row of its merge group. */
  linkedPersonIds: (user: string, activity: Activity) => Promise<string[]>
  getPerson: (user: string, id: string) => Promise<PersonRecord | null>
  actors: (user: string, records: PersonRecord[]) => Promise<Map<string, PersonActor>>
}

const linkedPersonIds = async (user: string, activity: Activity): Promise<string[]> => {
  const overlapping = await getOverlappingActivities(user, activity)
  const rowIds = [activity.id, ...(activity.override_target_ids ?? []), ...overlapping.map((a) => a.id)]
  const ids = [...new Set(rowIds.filter((id): id is string => id !== undefined && UUID_RE.test(id)))]
  const linked = await getPeopleForActivities(user, ids)
  return [...new Set([...linked.values()].flat().map((person) => person.id))]
}

export const postMentionDeps: PostMentionDeps = {
  actors: (user, records) => resolveActors(defaultPeopleDeps(), user, records),
  getPerson: (user, id) => getPerson(user, id),
  linkedPersonIds,
}

export type PostMentionsResult = { ok: true; mentions: PostMention[] } | { ok: false; error: string }

/**
 * The accounts a share of `activity` mentions for `personIds`: each must be a live person linked to
 * the activity and with a handle. Only the actor and its handle are kept, never the person.
 */
export const resolvePostMentions = async (
  user: string,
  activity: Activity,
  personIds: string[],
  deps: PostMentionDeps = postMentionDeps,
): Promise<PostMentionsResult> => {
  const ids = [...new Set(personIds.map((id) => id.toLowerCase()))]
  if (ids.length === 0) return { mentions: [], ok: true }
  const records = await Promise.all(ids.map((id) => deps.getPerson(user, id)))
  const unknown = ids.filter((_, i) => records[i] === null)
  if (unknown.length > 0) return { error: `Unknown people: ${unknown.join(', ')}`, ok: false }
  const people = records.filter((record): record is PersonRecord => record !== null)

  const linked = new Set((await deps.linkedPersonIds(user, activity)).map((id) => id.toLowerCase()))
  const notLinked = people.filter((person) => !linked.has(person.id.toLowerCase()))
  if (notLinked.length > 0) {
    return {
      error: `Only people this activity was with can be mentioned, not ${notLinked.map((p) => p.name).join(', ')}`,
      ok: false,
    }
  }

  const actors = await deps.actors(user, people)
  const mentions = people.map((person) => {
    const actor = person.actor_uri ? actors.get(person.actor_uri) : undefined
    const handle = actor?.handle ?? person.actor_handle
    return person.actor_uri && handle ? { actor_uri: person.actor_uri, handle } : null
  })
  const withoutHandle = people.filter((_, i) => mentions[i] === null)
  if (withoutHandle.length > 0) {
    return {
      error: `Only people with a fediverse handle can be mentioned, not ${withoutHandle.map((p) => p.name).join(', ')}`,
      ok: false,
    }
  }
  return { mentions: mentions.filter((m): m is PostMention => m !== null), ok: true }
}

/** `resolvePostMentions` for the activity a stored post shares; refused for a post sharing none. */
export const resolveEditedPostMentions = async (
  user: string,
  activityId: string | null,
  personIds: string[],
  deps: PostMentionDeps = postMentionDeps,
  getActivity: (user: string, id: string) => Promise<Activity | null> = getActivityById,
): Promise<PostMentionsResult> => {
  if (personIds.length === 0) return { mentions: [], ok: true }
  const activity = activityId ? await getActivity(user, activityId) : null
  if (!activity) return { error: 'Only an activity share can mention people', ok: false }
  return resolvePostMentions(user, activity, personIds, deps)
}
