import type { CentralDb } from './central-db.ts'

/** The public tag relay run by the Social Web Foundation: every hashtag is an actor there. */
export const DEFAULT_TAG_ACTOR_HOST = 'tags.pub'

/** The stored host, or the default when it is unset or empty. */
export const tagActorHostOrDefault = (stored: string | null | undefined): string =>
  stored == null || stored.trim() === '' ? DEFAULT_TAG_ACTOR_HOST : stored.trim()

export const readTagActorHost = async (centralDb: Pick<CentralDb, 'getServerSetting'>): Promise<string> =>
  tagActorHostOrDefault(await centralDb.getServerSetting('tag_actor_host'))

/** Whether `actorUri` is an account on the tag actor host: there every account is a hashtag feed, not a person. */
export const isOnTagActorHost = (actorUri: string, host: string): boolean => {
  try {
    return new URL(actorUri).host.toLowerCase() === host.trim().toLowerCase()
  } catch {
    return false
  }
}
