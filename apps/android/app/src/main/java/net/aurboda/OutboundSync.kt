package net.aurboda

import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.records.metadata.Metadata
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.time.ZoneOffset

private const val TAG = "OutboundSync"

/**
 * Prefix for clientRecordId on records written by outbound sync.
 * Used by inbound sync to skip these records and prevent sync loops.
 */
const val OUTBOUND_SYNC_CLIENT_ID_PREFIX = "aurboda-sync-"

// ============================================================================
// API Models (hand-written because the generated models type payload as Map<String, String>)
// ============================================================================

@Serializable
data class OutboundSyncEntryApi(
  val id: String,
  val entity_type: String,
  val entity_id: String,
  val operation: String,
  val hc_record_type: String,
  val payload: JsonObject,
  val hc_record_id: String? = null,
  val status: String,
  val created_at: String,
  val synced_at: String? = null,
)

@Serializable
data class OutboundSyncResponseApi(
  val success: Boolean,
  val data: List<OutboundSyncEntryApi>? = null,
  val error: String? = null,
  val total_pending: Int? = null,
)

@Serializable
data class OutboundSyncAckItemApi(
  val id: String,
  val hc_record_id: String? = null,
)

@Serializable
data class OutboundSyncAckBodyApi(
  val entries: List<OutboundSyncAckItemApi>,
)

@Serializable
data class OutboundSyncAckResponseApi(
  val success: Boolean,
  val acknowledged: Int? = null,
  val error: String? = null,
)

@Serializable
data class OutboundSyncFailItemApi(
  val id: String,
  val reason: String,
)

@Serializable
data class OutboundSyncFailBody(
  val entries: List<OutboundSyncFailItemApi>,
)

// ============================================================================
// API Client
// ============================================================================

data class OutboundSyncFetchResult(
  val entries: List<OutboundSyncEntryApi> = emptyList(),
  val totalPending: Int = 0,
)

/**
 * Fetch pending outbound sync entries from the backend.
 */
suspend fun fetchOutboundSyncEntries(
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
): OutboundSyncFetchResult {
  return try {
    val response =
      httpClient.get("$apiUrl/sync/outbound") {
        headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
      }
    if (response.status != HttpStatusCode.OK) {
      Log.e(TAG, "🚫 Failed to fetch outbound sync: HTTP ${response.status.value}")
      return OutboundSyncFetchResult()
    }
    val body = response.bodyAsText()
    val parsed = appJson.decodeFromString<OutboundSyncResponseApi>(body)
    if (!parsed.success) {
      Log.e(TAG, "🚫 Outbound sync response error: ${parsed.error}")
      return OutboundSyncFetchResult()
    }
    val entries = parsed.data ?: emptyList()
    val totalPending = parsed.total_pending ?: entries.size
    if (entries.isNotEmpty()) {
      Log.d(TAG, "📥 Fetched ${entries.size} pending outbound sync entries ($totalPending total in queue)")
    }
    OutboundSyncFetchResult(entries = entries, totalPending = totalPending)
  } catch (e: Exception) {
    Log.e(TAG, "🚫 Error fetching outbound sync entries", e)
    OutboundSyncFetchResult()
  }
}

/**
 * Acknowledge successfully synced outbound entries to the backend.
 */
suspend fun acknowledgeOutboundSync(
  entries: List<OutboundSyncAckItemApi>,
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
): Boolean {
  if (entries.isEmpty()) return true
  return try {
    val response =
      httpClient.post("$apiUrl/sync/outbound/ack") {
        contentType(ContentType.Application.Json)
        headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        setBody(OutboundSyncAckBodyApi(entries = entries))
      }
    if (response.status == HttpStatusCode.OK) {
      Log.d(TAG, "✅ Acknowledged ${entries.size} outbound sync entries")
      true
    } else {
      Log.e(TAG, "🚫 Ack failed: HTTP ${response.status.value}")
      false
    }
  } catch (e: Exception) {
    Log.e(TAG, "🚫 Error acknowledging outbound sync", e)
    false
  }
}

/**
 * Best-effort report of transient sync failures to the backend.
 * If reporting fails, the entries stay pending and will retry on next sync.
 */
suspend fun reportOutboundSyncFailures(
  entries: List<OutboundSyncFailItemApi>,
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
): Boolean {
  if (entries.isEmpty()) return true
  return try {
    val url = "$apiUrl/sync/outbound/fail"
    val response =
      httpClient.post(url) {
        header("Authorization", "Bearer $authToken")
        contentType(ContentType.Application.Json)
        setBody(OutboundSyncFailBody(entries = entries))
      }
    response.status.isSuccess()
  } catch (e: Exception) {
    // Best-effort — if we can't report, the entries stay pending and will retry next sync
    Log.w(TAG, "⚠️ Could not report sync failures to backend: ${e.message}")
    false
  }
}

// ============================================================================
// Health Connect Record Builder
// ============================================================================

/** Result of a write attempt — either a record ID, a permanent skip, or a transient failure. */
sealed class WriteResult {
  data class Success(
    val recordId: String,
  ) : WriteResult()

  /** Permanent failure — will be acked to clear the queue. */
  data class Skipped(
    val reason: String,
  ) : WriteResult()

  /** Transient failure — will NOT be acked, entry stays pending for retry. */
  data class TransientFailure(
    val reason: String,
  ) : WriteResult()
}

/**
 * Write an outbound sync entry to Health Connect.
 * Returns Success with the HC record ID, or Skipped with a reason.
 */
suspend fun writeToHealthConnect(
  entry: OutboundSyncEntryApi,
  healthConnectClient: HealthConnectClient,
  grantedPermissions: Set<String>,
): WriteResult =
  try {
    when (entry.operation) {
      // insertRecords() handles both insert and update: Health Connect deduplicates by
      // clientRecordId, so re-inserting with the same ID effectively upserts the record.
      "insert", "update" -> writeUpsertRecord(entry, healthConnectClient, grantedPermissions)
      "delete" -> {
        val success = deleteHealthConnectRecord(entry, healthConnectClient)
        // Return a marker so ack knows it succeeded (no new record ID for deletes)
        if (success) WriteResult.Success("deleted") else WriteResult.Skipped("delete failed")
      }
      else -> {
        Log.w(TAG, "⚠️ Unknown operation: ${entry.operation} for entry ${entry.id}")
        WriteResult.Skipped("unknown operation: ${entry.operation}")
      }
    }
  } catch (e: Exception) {
    Log.e(TAG, "🚫 Failed to write ${entry.hc_record_type} to Health Connect: ${e.message}", e)
    WriteResult.TransientFailure("exception: ${e.message}")
  }

/**
 * Write an insert/update record to Health Connect.
 * Uses clientRecordId with OUTBOUND_SYNC_CLIENT_ID_PREFIX for loop prevention.
 */
private suspend fun writeUpsertRecord(
  entry: OutboundSyncEntryApi,
  healthConnectClient: HealthConnectClient,
  grantedPermissions: Set<String>,
): WriteResult {
  val clientRecordId = "$OUTBOUND_SYNC_CLIENT_ID_PREFIX${entry.entity_id}"
  val payload = entry.payload

  Log.d(TAG, "📋 Processing ${entry.hc_record_type} (${entry.operation}), payload keys: ${payload.keys}")

  val record: Record =
    when (entry.hc_record_type) {
      "ActiveCaloriesBurnedRecord" -> {
        if (!hasWritePermission<ActiveCaloriesBurnedRecord>(
            grantedPermissions,
          )
        ) {
          return WriteResult.Skipped("no WRITE_ACTIVE_CALORIES_BURNED permission")
        }
        val value = payload.getDouble("value") ?: return WriteResult.Skipped("missing/invalid 'value' in payload: ${payload.keys}")
        val startTime = payload.getInstant("time") ?: return WriteResult.Skipped("missing/invalid 'time' in payload: ${payload["time"]}")
        // Per-minute calorie data: each record covers a 60-second window.
        // If end_time is provided, use it; otherwise default to start + 60s.
        val endTime = payload.getInstant("end_time") ?: startTime.plusSeconds(60)
        ActiveCaloriesBurnedRecord(
          energy =
            androidx.health.connect.client.units.Energy
              .kilocalories(value),
          startTime = startTime,
          startZoneOffset = ZoneOffset.systemDefault().rules.getOffset(startTime),
          endTime = endTime,
          endZoneOffset = ZoneOffset.systemDefault().rules.getOffset(endTime),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "WeightRecord" -> {
        if (!hasWritePermission<WeightRecord>(grantedPermissions)) return WriteResult.Skipped("no WRITE_WEIGHT permission")
        val value = payload.getDouble("value") ?: return WriteResult.Skipped("missing/invalid 'value' in payload: ${payload.keys}")
        val time = payload.getInstant("time") ?: return WriteResult.Skipped("missing/invalid 'time' in payload: ${payload["time"]}")
        WeightRecord(
          weight =
            androidx.health.connect.client.units.Mass
              .kilograms(value),
          time = time,
          zoneOffset = ZoneOffset.systemDefault().rules.getOffset(time),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "HeightRecord" -> {
        if (!hasWritePermission<HeightRecord>(grantedPermissions)) return WriteResult.Skipped("no WRITE_HEIGHT permission")
        val value = payload.getDouble("value") ?: return WriteResult.Skipped("missing/invalid 'value' in payload: ${payload.keys}")
        val time = payload.getInstant("time") ?: return WriteResult.Skipped("missing/invalid 'time' in payload: ${payload["time"]}")
        HeightRecord(
          height =
            androidx.health.connect.client.units.Length
              .meters(value),
          time = time,
          zoneOffset = ZoneOffset.systemDefault().rules.getOffset(time),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "BodyFatRecord" -> {
        if (!hasWritePermission<BodyFatRecord>(grantedPermissions)) return WriteResult.Skipped("no WRITE_BODY_FAT permission")
        val value = payload.getDouble("value") ?: return WriteResult.Skipped("missing/invalid 'value' in payload: ${payload.keys}")
        val time = payload.getInstant("time") ?: return WriteResult.Skipped("missing/invalid 'time' in payload: ${payload["time"]}")
        BodyFatRecord(
          percentage =
            androidx.health.connect.client.units
              .Percentage(value),
          time = time,
          zoneOffset = ZoneOffset.systemDefault().rules.getOffset(time),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "LeanBodyMassRecord" -> {
        if (!hasWritePermission<LeanBodyMassRecord>(grantedPermissions)) return WriteResult.Skipped("no WRITE_LEAN_BODY_MASS permission")
        val value = payload.getDouble("value") ?: return WriteResult.Skipped("missing/invalid 'value' in payload: ${payload.keys}")
        val time = payload.getInstant("time") ?: return WriteResult.Skipped("missing/invalid 'time' in payload: ${payload["time"]}")
        LeanBodyMassRecord(
          mass =
            androidx.health.connect.client.units.Mass
              .kilograms(value),
          time = time,
          zoneOffset = ZoneOffset.systemDefault().rules.getOffset(time),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "BoneMassRecord" -> {
        if (!hasWritePermission<BoneMassRecord>(grantedPermissions)) return WriteResult.Skipped("no WRITE_BONE_MASS permission")
        val value = payload.getDouble("value") ?: return WriteResult.Skipped("missing/invalid 'value' in payload: ${payload.keys}")
        val time = payload.getInstant("time") ?: return WriteResult.Skipped("missing/invalid 'time' in payload: ${payload["time"]}")
        BoneMassRecord(
          mass =
            androidx.health.connect.client.units.Mass
              .kilograms(value),
          time = time,
          zoneOffset = ZoneOffset.systemDefault().rules.getOffset(time),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "BodyWaterMassRecord" -> {
        if (!hasWritePermission<BodyWaterMassRecord>(grantedPermissions)) return WriteResult.Skipped("no WRITE_BODY_WATER_MASS permission")
        val value = payload.getDouble("value") ?: return WriteResult.Skipped("missing/invalid 'value' in payload: ${payload.keys}")
        val time = payload.getInstant("time") ?: return WriteResult.Skipped("missing/invalid 'time' in payload: ${payload["time"]}")
        BodyWaterMassRecord(
          mass =
            androidx.health.connect.client.units.Mass
              .kilograms(value),
          time = time,
          zoneOffset = ZoneOffset.systemDefault().rules.getOffset(time),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "RestingHeartRateRecord" -> {
        if (!hasWritePermission<RestingHeartRateRecord>(
            grantedPermissions,
          )
        ) {
          return WriteResult.Skipped("no WRITE_RESTING_HEART_RATE permission")
        }
        val value =
          payload.getDouble("value")?.toLong() ?: return WriteResult.Skipped("missing/invalid 'value' in payload: ${payload.keys}")
        val time = payload.getInstant("time") ?: return WriteResult.Skipped("missing/invalid 'time' in payload: ${payload["time"]}")
        RestingHeartRateRecord(
          beatsPerMinute = value,
          time = time,
          zoneOffset = ZoneOffset.systemDefault().rules.getOffset(time),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "StepsRecord" -> {
        if (!hasWritePermission<StepsRecord>(grantedPermissions)) return WriteResult.Skipped("no WRITE_STEPS permission")
        val value =
          payload.getDouble("value")?.toLong() ?: return WriteResult.Skipped("missing/invalid 'value' in payload: ${payload.keys}")
        val startTime = payload.getInstant("time") ?: return WriteResult.Skipped("missing/invalid 'time' in payload: ${payload["time"]}")
        // Synthetic time window: StepsRecord requires a time range but the backend only stores a
        // point-in-time. A 60-second window is acceptable for single-value step entries (e.g.,
        // manual corrections). Aggregated daily totals come from other apps, not outbound sync.
        val endTime = startTime.plusSeconds(60)
        StepsRecord(
          count = value,
          startTime = startTime,
          startZoneOffset = ZoneOffset.systemDefault().rules.getOffset(startTime),
          endTime = endTime,
          endZoneOffset = ZoneOffset.systemDefault().rules.getOffset(endTime),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "HeartRateRecord" -> {
        if (!hasWritePermission<HeartRateRecord>(grantedPermissions)) return WriteResult.Skipped("no WRITE_HEART_RATE permission")
        val value =
          payload.getDouble("value")?.toLong() ?: return WriteResult.Skipped("missing/invalid 'value' in payload: ${payload.keys}")
        val time = payload.getInstant("time") ?: return WriteResult.Skipped("missing/invalid 'time' in payload: ${payload["time"]}")
        // Synthetic time window: HeartRateRecord requires a time range but the backend stores a
        // single sample. A 1-second window wrapping that sample is the minimum valid range.
        val endTime = time.plusSeconds(1)
        HeartRateRecord(
          startTime = time,
          startZoneOffset = ZoneOffset.systemDefault().rules.getOffset(time),
          endTime = endTime,
          endZoneOffset = ZoneOffset.systemDefault().rules.getOffset(endTime),
          samples = listOf(HeartRateRecord.Sample(time = time, beatsPerMinute = value)),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "HeartRateVariabilityRmssdRecord" -> {
        if (!hasWritePermission<HeartRateVariabilityRmssdRecord>(
            grantedPermissions,
          )
        ) {
          return WriteResult.Skipped("no WRITE_HEART_RATE_VARIABILITY permission")
        }
        val value = payload.getDouble("value") ?: return WriteResult.Skipped("missing/invalid 'value' in payload: ${payload.keys}")
        val time = payload.getInstant("time") ?: return WriteResult.Skipped("missing/invalid 'time' in payload: ${payload["time"]}")
        HeartRateVariabilityRmssdRecord(
          heartRateVariabilityMillis = value,
          time = time,
          zoneOffset = ZoneOffset.systemDefault().rules.getOffset(time),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "ExerciseSessionRecord" -> {
        if (!hasWritePermission<ExerciseSessionRecord>(grantedPermissions)) return WriteResult.Skipped("no WRITE_EXERCISE permission")
        val startTime =
          payload.getInstant("start_time")
            ?: return WriteResult.Skipped("missing/invalid 'start_time' in payload: ${payload["start_time"]}")
        val endTime =
          payload.getInstant("end_time") ?: return WriteResult.Skipped("missing/invalid 'end_time' in payload: ${payload["end_time"]}")
        val title = payload.getString("title")
        val notes = payload.getString("notes")
        // Extract exercise type from the nested data object; falls back to OTHER_WORKOUT.
        // Backend stores exerciseType as an int matching HC's EXERCISE_TYPE_* constants.
        val exerciseType =
          payload["data"]
            ?.jsonObject
            ?.get("exerciseType")
            ?.jsonPrimitive
            ?.intOrNull
            ?: ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT
        ExerciseSessionRecord(
          startTime = startTime,
          startZoneOffset = ZoneOffset.systemDefault().rules.getOffset(startTime),
          endTime = endTime,
          endZoneOffset = ZoneOffset.systemDefault().rules.getOffset(endTime),
          exerciseType = exerciseType,
          title = title,
          notes = notes,
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "SleepSessionRecord" -> {
        if (!hasWritePermission<SleepSessionRecord>(grantedPermissions)) return WriteResult.Skipped("no WRITE_SLEEP permission")
        val startTime =
          payload.getInstant("start_time")
            ?: return WriteResult.Skipped("missing/invalid 'start_time' in payload: ${payload["start_time"]}")
        val endTime =
          payload.getInstant("end_time") ?: return WriteResult.Skipped("missing/invalid 'end_time' in payload: ${payload["end_time"]}")
        val title = payload.getString("title")
        val notes = payload.getString("notes")
        SleepSessionRecord(
          startTime = startTime,
          startZoneOffset = ZoneOffset.systemDefault().rules.getOffset(startTime),
          endTime = endTime,
          endZoneOffset = ZoneOffset.systemDefault().rules.getOffset(endTime),
          title = title,
          notes = notes,
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      else -> {
        Log.w(TAG, "⚠️ Unsupported HC record type: ${entry.hc_record_type}")
        return WriteResult.Skipped("unsupported record type: ${entry.hc_record_type}")
      }
    }

  val result = healthConnectClient.insertRecords(listOf(record))
  val recordId = result.recordIdsList.firstOrNull()
  if (recordId != null) {
    Log.d(TAG, "📝 Wrote ${entry.hc_record_type} to Health Connect: $recordId")
  }
  return if (recordId != null) WriteResult.Success(recordId) else WriteResult.Skipped("insertRecords returned no ID")
}

/**
 * Delete a record from Health Connect by its record ID.
 * Returns true if the delete succeeded or the entry is unprocessable (should be ack'd to prevent
 * infinite retry). Returns false only on transient failures that should be retried.
 */
private suspend fun deleteHealthConnectRecord(
  entry: OutboundSyncEntryApi,
  healthConnectClient: HealthConnectClient,
): Boolean {
  val hcRecordId =
    entry.payload.getString("hc_record_id")
      ?: entry.hc_record_id
  if (hcRecordId == null) {
    // No HC record ID available — this entry can never be processed, so ack it to avoid
    // infinite retry. This can happen if the record was created before outbound sync tracked IDs.
    Log.w(TAG, "⚠️ No HC record ID for delete on entry ${entry.id}, acknowledging as unprocessable")
    return true
  }

  // We need to know the record class to delete. Map hc_record_type back to class.
  val recordClass = hcRecordTypeToClass(entry.hc_record_type)
  if (recordClass == null) {
    Log.w(TAG, "⚠️ Unknown record type for delete: ${entry.hc_record_type}, acknowledging as unprocessable")
    return true
  }

  healthConnectClient.deleteRecords(
    recordType = recordClass,
    recordIdsList = listOf(hcRecordId),
    clientRecordIdsList = emptyList(),
  )
  Log.d(TAG, "🗑️ Deleted ${entry.hc_record_type} from Health Connect: $hcRecordId")
  return true
}

// ============================================================================
// Main Processor
// ============================================================================

/**
 * Process all pending outbound sync entries:
 * 1. Fetch pending entries from backend (page by page)
 * 2. Write each to Health Connect
 * 3. Acknowledge successful writes
 * 4. Repeat until queue is drained
 *
 * @return cumulative result across all pages
 */
data class OutboundSyncResult(
  val fetched: Int = 0,
  val written: Int = 0,
  val skipped: Int = 0,
  val transientFailures: Int = 0,
  val acknowledged: Boolean = true,
  val error: String? = null,
  val skipReasons: List<String> = emptyList(),
  val failReasons: List<String> = emptyList(),
  val pagesProcessed: Int = 0,
)

/** Maximum number of pages to process in a single sync pass to avoid runaway loops. */
private const val MAX_OUTBOUND_SYNC_PAGES = 50

suspend fun processOutboundSync(
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
  healthConnectClient: HealthConnectClient,
  grantedPermissions: Set<String>,
): OutboundSyncResult {
  var totalFetched = 0
  var totalWritten = 0
  var totalSkipped = 0
  var totalTransientFailures = 0
  var allAcknowledged = true
  val allSkipReasons = mutableListOf<String>()
  val allFailReasons = mutableListOf<String>()
  var pagesProcessed = 0

  for (page in 1..MAX_OUTBOUND_SYNC_PAGES) {
    val fetchResult = fetchOutboundSyncEntries(apiUrl, authToken, httpClient)
    val entries = fetchResult.entries
    if (entries.isEmpty()) break

    pagesProcessed++
    totalFetched += entries.size
    Log.d(TAG, "🔄 Processing page $page: ${entries.size} entries (${fetchResult.totalPending} total pending)")

    val ackItems = mutableListOf<OutboundSyncAckItemApi>()
    val failItems = mutableListOf<OutboundSyncFailItemApi>()
    var pageSkipped = 0
    var pageTransientFailures = 0

    for (entry in entries) {
      when (val result = writeToHealthConnect(entry, healthConnectClient, grantedPermissions)) {
        is WriteResult.Success -> {
          ackItems.add(
            OutboundSyncAckItemApi(
              id = entry.id,
              hc_record_id = if (result.recordId == "deleted") null else result.recordId,
            ),
          )
        }
        is WriteResult.Skipped -> {
          pageSkipped++
          val reason = "${entry.hc_record_type}: ${result.reason}"
          allSkipReasons.add(reason)
          Log.w(TAG, "⚠️ Skipped entry ${entry.id} (${entry.hc_record_type}/${entry.operation}): ${result.reason}")
          // Acknowledge skipped entries so they don't block the queue permanently.
          // These are unrecoverable failures (missing permission, bad payload, unsupported type)
          // that will never succeed on retry.
          ackItems.add(OutboundSyncAckItemApi(id = entry.id))
        }
        is WriteResult.TransientFailure -> {
          pageTransientFailures++
          val reason = "${entry.hc_record_type}: ${result.reason}"
          allFailReasons.add(reason)
          Log.e(TAG, "🚫 Transient failure for entry ${entry.id} (${entry.hc_record_type}/${entry.operation}): ${result.reason}")
          failItems.add(OutboundSyncFailItemApi(id = entry.id, reason = result.reason))
        }
      }
    }

    totalWritten += ackItems.size - pageSkipped
    totalSkipped += pageSkipped
    totalTransientFailures += pageTransientFailures

    if (ackItems.isNotEmpty()) {
      val ackSuccess = acknowledgeOutboundSync(ackItems, apiUrl, authToken, httpClient)
      if (ackSuccess) {
        Log.d(TAG, "✅ Page $page complete: ${ackItems.size}/${entries.size} entries acked")
      } else {
        Log.w(TAG, "⚠️ Outbound sync page $page: wrote to HC but failed to acknowledge")
        allAcknowledged = false
        break
      }
    }

    // Best-effort report transient failures so backend can track them
    if (failItems.isNotEmpty()) {
      reportOutboundSyncFailures(failItems, apiUrl, authToken, httpClient)
    }

    // If we processed fewer entries than the total pending, there are more pages
    val remaining = fetchResult.totalPending - entries.size
    if (remaining <= 0) break
    Log.d(TAG, "📋 $remaining more entries remaining in queue, fetching next page...")
  }

  if (pagesProcessed > 0) {
    Log.d(TAG, "✅ Outbound sync finished: $totalWritten written, $totalSkipped skipped, $totalTransientFailures transient failures across $pagesProcessed pages")
  }

  return OutboundSyncResult(
    fetched = totalFetched,
    written = totalWritten,
    skipped = totalSkipped,
    transientFailures = totalTransientFailures,
    acknowledged = allAcknowledged,
    skipReasons = allSkipReasons,
    failReasons = allFailReasons,
    pagesProcessed = pagesProcessed,
  )
}

// ============================================================================
// Helpers
// ============================================================================

/** Check if write permission is granted for a specific record type. */
private inline fun <reified T : Record> hasWritePermission(grantedPermissions: Set<String>): Boolean {
  val permission = HealthPermission.getWritePermission(T::class)
  val granted = permission in grantedPermissions
  if (!granted) {
    Log.d(TAG, "⏭️ No write permission for ${T::class.simpleName}, skipping")
  }
  return granted
}

/** Map HC record type name back to its KClass for deletion. */
private fun hcRecordTypeToClass(typeName: String): kotlin.reflect.KClass<out Record>? =
  when (typeName) {
    "WeightRecord" -> WeightRecord::class
    "HeightRecord" -> HeightRecord::class
    "BodyFatRecord" -> BodyFatRecord::class
    "LeanBodyMassRecord" -> LeanBodyMassRecord::class
    "BoneMassRecord" -> BoneMassRecord::class
    "BodyWaterMassRecord" -> BodyWaterMassRecord::class
    "RestingHeartRateRecord" -> RestingHeartRateRecord::class
    "HeartRateRecord" -> HeartRateRecord::class
    "HeartRateVariabilityRmssdRecord" -> HeartRateVariabilityRmssdRecord::class
    "StepsRecord" -> StepsRecord::class
    "ExerciseSessionRecord" -> ExerciseSessionRecord::class
    "SleepSessionRecord" -> SleepSessionRecord::class
    else -> null
  }

/** Extract a Double value from a JsonObject field. */
private fun JsonObject.getDouble(key: String): Double? = this[key]?.jsonPrimitive?.doubleOrNull

/** Extract a String value from a JsonObject field. */
private fun JsonObject.getString(key: String): String? =
  this[key]?.let { element ->
    if (element is JsonPrimitive && !element.isString && element.content == "null") {
      null
    } else {
      element.jsonPrimitive.content
    }
  }

/** Parse an ISO-8601 datetime string from a JsonObject field. */
private fun JsonObject.getInstant(key: String): Instant? =
  getString(key)?.let {
    try {
      Instant.parse(it)
    } catch (e: Exception) {
      null
    }
  }
