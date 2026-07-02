/**
 * Small predicates over PostgreSQL error codes, shared across layers.
 */

/**
 * True when a query failed because the target database does not exist
 * (`invalid_catalog_name`). Public routes address a user's database directly by
 * username, so this is how "no such user" surfaces — map it to a 404.
 */
export const isMissingDatabase = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { code?: string }).code === '3D000'
