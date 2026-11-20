import { holdsBoostCardWithoutFollowing, isMissingDatabase } from '../../db/index.ts'
import { mapWithConcurrency } from '../../utils.ts'

const HOLDER_LOOKUP_CONCURRENCY = 5

export interface LocalCardHolderDeps {
  listUsers: () => Promise<string[]>
  holds?: (user: string, noteUri: string, authorUri: string) => Promise<boolean>
}

/**
 * The local users who hold a boost card of a Note without following its author. Asked a few
 * users at a time, since each has an own database and pool; a user whose database is missing
 * or fails is skipped.
 */
export const createLocalBoostCardHolders =
  ({ holds = holdsBoostCardWithoutFollowing, listUsers }: LocalCardHolderDeps) =>
  async (noteUri: string, authorUri: string): Promise<string[]> => {
    const users = await listUsers()
    const held = await mapWithConcurrency(users, HOLDER_LOOKUP_CONCURRENCY, async (user) => {
      try {
        return await holds(user, noteUri, authorUri)
      } catch (error) {
        if (!isMissingDatabase(error)) console.warn(`⚠️ Boost card holder lookup for ${user} failed:`, error)
        return false
      }
    })
    return users.filter((_, i) => held[i])
  }
