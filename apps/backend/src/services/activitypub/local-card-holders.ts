import { holdsBoostCardWithoutFollowing, isMissingDatabase } from '../../db/index.ts'

export interface LocalCardHolderDeps {
  listUsers: () => Promise<string[]>
  holds?: (user: string, noteUri: string, authorUri: string) => Promise<boolean>
}

/**
 * The local users who hold a boost card of a Note without following its author. Asked one
 * user at a time, since each has an own database and pool; a user whose database is missing
 * or fails is skipped.
 */
export const createLocalBoostCardHolders =
  ({ holds = holdsBoostCardWithoutFollowing, listUsers }: LocalCardHolderDeps) =>
  async (noteUri: string, authorUri: string): Promise<string[]> => {
    const holders: string[] = []
    for (const user of await listUsers()) {
      try {
        if (await holds(user, noteUri, authorUri)) holders.push(user)
      } catch (error) {
        if (!isMissingDatabase(error)) console.warn(`⚠️ Boost card holder lookup for ${user} failed:`, error)
      }
    }
    return holders
  }
