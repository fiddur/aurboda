import { query } from '../src/db/connection.ts'
/**
 * One-off cleanup: delete all Health Connect raw_records whose dataOrigin is
 * com.fitbit.FitbitMobile, from a given start date onwards, for one user.
 *
 * Cascades through deleteHealthConnectRecords() so the derived time_series and
 * activity rows are removed in the same step (they have no external_id, so a
 * naive DELETE on raw_records would orphan them).
 *
 * Usage:
 *   node apps/backend/scripts/delete-fitbit-data.ts <user> <iso-start> [--apply]
 *
 * Without --apply, runs in dry-run mode: prints the count and a sample of
 * external_ids without deleting anything.
 */
import { deleteHealthConnectRecords } from '../src/db/health-connect.ts'

const BATCH_SIZE = 500

const main = async () => {
  const [user, startIso, applyFlag] = process.argv.slice(2)
  const apply = applyFlag === '--apply'

  if (!user || !startIso) {
    console.error('Usage: node delete-fitbit-data.ts <user> <iso-start> [--apply]')
    process.exit(1)
  }

  console.info(`🔍 Looking up Fitbit raw_records for user=${user} since ${startIso}`)

  const { rows } = await query<{ external_id: string; record_type: string }>(
    user,
    `SELECT external_id, record_type
     FROM raw_records
     WHERE source = 'health_connect'
       AND recorded_at >= $1::timestamptz
       AND data->'metadata'->>'dataOrigin' = 'com.fitbit.FitbitMobile'
     ORDER BY recorded_at`,
    [startIso],
  )

  const byType = new Map<string, number>()
  for (const row of rows) byType.set(row.record_type, (byType.get(row.record_type) ?? 0) + 1)

  console.info(`\n📊 Found ${rows.length} matching raw_records:`)
  for (const [type, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.info(`   ${type.padEnd(40)} ${n}`)
  }

  if (rows.length === 0) {
    console.info('✅ Nothing to delete.')
    return
  }

  if (!apply) {
    console.info('\n🧪 Dry run — pass --apply to actually delete.')
    console.info(
      `   Sample external_ids: ${rows
        .slice(0, 3)
        .map((r) => r.external_id)
        .join(', ')}`,
    )
    return
  }

  console.info(`\n🗑️  Deleting in batches of ${BATCH_SIZE}…`)
  let totalDeleted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r) => r.external_id)
    const n = await deleteHealthConnectRecords(user, batch)
    totalDeleted += n
    console.info(`   batch ${i / BATCH_SIZE + 1}: ${n}/${batch.length} deleted (cumulative ${totalDeleted})`)
  }

  console.info(`\n✅ Done. Deleted ${totalDeleted} raw_records (plus cascaded time_series and activities).`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Failed:', err)
    process.exit(1)
  })
