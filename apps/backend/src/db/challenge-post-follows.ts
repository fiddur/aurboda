import { query } from './connection.ts'

/** The user's explicit follow choices among `rootObjectUris`; a post with no row is absent from the map. */
export const getChallengePostFollows = async (
  user: string,
  rootObjectUris: readonly string[],
): Promise<Map<string, boolean>> => {
  if (rootObjectUris.length === 0) return new Map()
  const result = await query<{ root_object_uri: string; following: boolean }>(
    user,
    'SELECT root_object_uri, following FROM challenge_post_follows WHERE root_object_uri = ANY($1::text[])',
    [[...new Set(rootObjectUris)]],
  )
  return new Map(result.rows.map((row) => [row.root_object_uri, row.following]))
}

export const setChallengePostFollow = async (
  user: string,
  rootObjectUri: string,
  following: boolean,
): Promise<void> => {
  await query(
    user,
    `INSERT INTO challenge_post_follows (root_object_uri, following) VALUES ($1, $2)
     ON CONFLICT (root_object_uri) DO UPDATE SET following = EXCLUDED.following, updated_at = NOW()`,
    [rootObjectUri, following],
  )
}
