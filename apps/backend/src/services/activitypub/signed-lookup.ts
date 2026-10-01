import type { Context } from '@fedify/fedify'
import type { LookupObjectOptions } from '@fedify/fedify/vocab'

/**
 * Fetch options that sign every request as `user`'s actor, so instances running
 * authorized fetch (Mastodon secure mode, GoToSocial) answer instead of a 401.
 * Falls back to an unsigned fetch when there is no local user to sign as, or
 * when their key can't be loaded — an unsigned fetch still works everywhere
 * that doesn't demand a signature.
 */
export const signedFetchOptions = async (
  ctx: Pick<Context<void>, 'getDocumentLoader'>,
  user: string | null,
): Promise<Pick<LookupObjectOptions, 'documentLoader'>> => {
  if (user == null) return {}
  try {
    return { documentLoader: await ctx.getDocumentLoader({ identifier: user }) }
  } catch {
    return {}
  }
}
