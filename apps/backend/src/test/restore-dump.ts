import { execFileSync } from 'node:child_process'
import { inject } from 'vitest'

/**
 * docs/data-export.md, "Restoring into another Aurboda installation", step 3, piped into the
 * database container's own psql as the documented compose does: that psql can be older than
 * the pg_dump that made the dump, which a host psql would hide.
 */
export const restoreDumpAsDocumented = (dumpPath: string, role: string, database: string): void => {
  const container = inject('pgContainerId')
  const adminUri = inject('pgAdminUri')
  if (!container || !adminUri) {
    throw new Error('Test database not available: this run started without the integration global setup')
  }
  const restore = String.raw`(echo 'SET ROLE "${role}";'; gunzip -c "$DUMP" | grep -v -e '^COMMENT ON EXTENSION' -e '^SET transaction_timeout' -e '^\\restrict ' -e '^\\unrestrict ') | docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 --quiet -U "$SUPERUSER" -d "$DATABASE"`
  execFileSync('bash', ['-c', restore], {
    env: {
      ...process.env,
      CONTAINER: container,
      DATABASE: database,
      DUMP: dumpPath,
      SUPERUSER: decodeURIComponent(new URL(adminUri).username),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
}
