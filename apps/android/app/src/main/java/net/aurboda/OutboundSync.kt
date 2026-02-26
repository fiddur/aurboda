package net.aurboda

import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.records.metadata.Metadata
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
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

// ============================================================================
// API Client
// ============================================================================

/**
 * Fetch pending outbound sync entries from the backend.
 */
suspend fun fetchOutboundSyncEntries(
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
): List<OutboundSyncEntryApi> {
  return try {
    val response =
      httpClient.get("$apiUrl/sync/outbound") {
        headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
      }
    if (response.status != HttpStatusCode.OK) {
      Log.e(TAG, "🚫 Failed to fetch outbound sync: HTTP ${response.status.value}")
      return emptyList()
    }
    val body = response.bodyAsText()
    val parsed = appJson.decodeFromString<OutboundSyncResponseApi>(body)
    if (!parsed.success) {
      Log.e(TAG, "🚫 Outbound sync response error: ${parsed.error}")
      return emptyList()
    }
    val entries = parsed.data ?: emptyList()
    if (entries.isNotEmpty()) {
      Log.d(TAG, "📥 Fetched ${entries.size} pending outbound sync entries")
    }
    entries
  } catch (e: Exception) {
    Log.e(TAG, "🚫 Error fetching outbound sync entries", e)
    emptyList()
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

// ============================================================================
// Health Connect Record Builder
// ============================================================================

/**
 * Write an outbound sync entry to Health Connect.
 * Returns the Health Connect record ID on success, null on failure.
 */
suspend fun writeToHealthConnect(
  entry: OutboundSyncEntryApi,
  healthConnectClient: HealthConnectClient,
  grantedPermissions: Set<String>,
): String? =
  try {
    when (entry.operation) {
      // insertRecords() handles both insert and update: Health Connect deduplicates by
      // clientRecordId, so re-inserting with the same ID effectively upserts the record.
      "insert", "update" -> writeUpsertRecord(entry, healthConnectClient, grantedPermissions)
      "delete" -> {
        val success = deleteHealthConnectRecord(entry, healthConnectClient)
        // Return a marker so ack knows it succeeded (no new record ID for deletes)
        if (success) "deleted" else null
      }
      else -> {
        Log.w(TAG, "⚠️ Unknown operation: ${entry.operation} for entry ${entry.id}")
        null
      }
    }
  } catch (e: Exception) {
    Log.e(TAG, "🚫 Failed to write ${entry.hc_record_type} to Health Connect: ${e.message}", e)
    null
  }

/**
 * Write an insert/update record to Health Connect.
 * Uses clientRecordId with OUTBOUND_SYNC_CLIENT_ID_PREFIX for loop prevention.
 */
private suspend fun writeUpsertRecord(
  entry: OutboundSyncEntryApi,
  healthConnectClient: HealthConnectClient,
  grantedPermissions: Set<String>,
): String? {
  val clientRecordId = "$OUTBOUND_SYNC_CLIENT_ID_PREFIX${entry.entity_id}"
  val payload = entry.payload

  val record: Record =
    when (entry.hc_record_type) {
      "WeightRecord" -> {
        if (!hasWritePermission<WeightRecord>(grantedPermissions)) return null
        val value = payload.getDouble("value") ?: return null
        val time = payload.getInstant("time") ?: return null
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
        if (!hasWritePermission<HeightRecord>(grantedPermissions)) return null
        val value = payload.getDouble("value") ?: return null
        val time = payload.getInstant("time") ?: return null
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
        if (!hasWritePermission<BodyFatRecord>(grantedPermissions)) return null
        val value = payload.getDouble("value") ?: return null
        val time = payload.getInstant("time") ?: return null
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
        if (!hasWritePermission<LeanBodyMassRecord>(grantedPermissions)) return null
        val value = payload.getDouble("value") ?: return null
        val time = payload.getInstant("time") ?: return null
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
        if (!hasWritePermission<BoneMassRecord>(grantedPermissions)) return null
        val value = payload.getDouble("value") ?: return null
        val time = payload.getInstant("time") ?: return null
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
        if (!hasWritePermission<BodyWaterMassRecord>(grantedPermissions)) return null
        val value = payload.getDouble("value") ?: return null
        val time = payload.getInstant("time") ?: return null
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
        if (!hasWritePermission<RestingHeartRateRecord>(grantedPermissions)) return null
        val value = payload.getDouble("value")?.toLong() ?: return null
        val time = payload.getInstant("time") ?: return null
        RestingHeartRateRecord(
          beatsPerMinute = value,
          time = time,
          zoneOffset = ZoneOffset.systemDefault().rules.getOffset(time),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "StepsRecord" -> {
        if (!hasWritePermission<StepsRecord>(grantedPermissions)) return null
        val value = payload.getDouble("value")?.toLong() ?: return null
        val startTime = payload.getInstant("time") ?: return null
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
        if (!hasWritePermission<HeartRateRecord>(grantedPermissions)) return null
        val value = payload.getDouble("value")?.toLong() ?: return null
        val time = payload.getInstant("time") ?: return null
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
        if (!hasWritePermission<HeartRateVariabilityRmssdRecord>(grantedPermissions)) return null
        val value = payload.getDouble("value") ?: return null
        val time = payload.getInstant("time") ?: return null
        HeartRateVariabilityRmssdRecord(
          heartRateVariabilityMillis = value,
          time = time,
          zoneOffset = ZoneOffset.systemDefault().rules.getOffset(time),
          metadata = Metadata.manualEntry(clientRecordId),
        )
      }
      "ExerciseSessionRecord" -> {
        if (!hasWritePermission<ExerciseSessionRecord>(grantedPermissions)) return null
        val startTime = payload.getInstant("start_time") ?: return null
        val endTime = payload.getInstant("end_time") ?: return null
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
        if (!hasWritePermission<SleepSessionRecord>(grantedPermissions)) return null
        val startTime = payload.getInstant("start_time") ?: return null
        val endTime = payload.getInstant("end_time") ?: return null
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
        return null
      }
    }

  val result = healthConnectClient.insertRecords(listOf(record))
  val recordId = result.recordIdsList.firstOrNull()
  if (recordId != null) {
    Log.d(TAG, "📝 Wrote ${entry.hc_record_type} to Health Connect: $recordId")
  }
  return recordId
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
 * 1. Fetch pending entries from backend
 * 2. Write each to Health Connect
 * 3. Acknowledge successful writes
 *
 * @return true if all entries were processed successfully (or none pending)
 */
data class OutboundSyncResult(
  val fetched: Int = 0,
  val written: Int = 0,
  val skipped: Int = 0,
  val acknowledged: Boolean = true,
  val error: String? = null,
)

suspend fun processOutboundSync(
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
  healthConnectClient: HealthConnectClient,
  grantedPermissions: Set<String>,
): OutboundSyncResult {
  val entries = fetchOutboundSyncEntries(apiUrl, authToken, httpClient)
  if (entries.isEmpty()) return OutboundSyncResult()

  Log.d(TAG, "🔄 Processing ${entries.size} outbound sync entries")

  val ackItems = mutableListOf<OutboundSyncAckItemApi>()
  var skipped = 0

  for (entry in entries) {
    val hcRecordId = writeToHealthConnect(entry, healthConnectClient, grantedPermissions)
    if (hcRecordId != null) {
      ackItems.add(
        OutboundSyncAckItemApi(
          id = entry.id,
          hc_record_id = if (hcRecordId == "deleted") null else hcRecordId,
        ),
      )
    } else {
      skipped++
      Log.w(TAG, "⚠️ Skipped entry ${entry.id} (${entry.hc_record_type}/${entry.operation})")
    }
  }

  if (ackItems.isNotEmpty()) {
    val ackSuccess = acknowledgeOutboundSync(ackItems, apiUrl, authToken, httpClient)
    if (ackSuccess) {
      Log.d(TAG, "✅ Outbound sync complete: ${ackItems.size}/${entries.size} entries synced")
    } else {
      Log.w(TAG, "⚠️ Outbound sync: wrote to HC but failed to acknowledge")
      return OutboundSyncResult(
        fetched = entries.size,
        written = ackItems.size,
        skipped = skipped,
        acknowledged = false,
      )
    }
  }

  return OutboundSyncResult(
    fetched = entries.size,
    written = ackItems.size,
    skipped = skipped,
    acknowledged = true,
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
