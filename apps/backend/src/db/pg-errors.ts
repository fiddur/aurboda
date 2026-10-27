/**
 * True when a query failed because the target database does not exist
 * (`invalid_catalog_name`). Public routes address a user's database directly by
 * username, so this is how "no such user" surfaces — map it to a 404.
 */
export const isMissingDatabase = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { code?: string }).code === '3D000'

/** True when a query violated a unique constraint or index (`unique_violation`). */
export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { code?: string }).code === '23505'
