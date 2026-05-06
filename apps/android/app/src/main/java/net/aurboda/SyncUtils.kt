package net.aurboda

import android.util.Log
import androidx.health.connect.client.records.*
import io.ktor.client.HttpClient
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.delay
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.serializer

const val SYNC_UTILS_TAG = "SyncUtils"

/** Maximum retries per chunk on transient errors (network drop, 5xx, 408, 429). */
@PublishedApi
internal const val MAX_CHUNK_ATTEMPTS: Int = 4

/**
 * HeartRateRecord is a SeriesRecord — each record holds many samples, so the JSON payload can
 * blow past the backend's 10MB limit if we send too many in one go. Backend body limit is 10mb;
 * 50 records ≈ a few hundred KB in practice. Tunable from one place.
 */
private const val HEART_RATE_CHUNK_SIZE = 50

/** Result of a POST operation with error details for display. */
sealed class PostResult {
  data object Success : PostResult()

  data class HttpError(
    val statusCode: Int,
    val statusDescription: String,
  ) : PostResult()

  data class NetworkError(
    val message: String,
  ) : PostResult()

  val isSuccess: Boolean
    get() = this is Success

  /** Errors that may succeed on retry (network failures and server-side hiccups). */
  val isTransient: Boolean
    get() =
      when (this) {
        is Success -> false
        is NetworkError -> true
        is HttpError -> statusCode >= 500 || statusCode == 408 || statusCode == 429
      }

  fun errorMessage(): String? =
    when (this) {
      is Success -> null
      is HttpError -> "HTTP $statusCode $statusDescription"
      is NetworkError -> "Network error: $message"
    }
}

/**
 * Post a single pre-serialized JSON body to the server.
 * Non-inline to keep dispatch sites compact (avoids JVM "method too large" with many record types).
 */
suspend fun postChunkRaw(
  jsonBody: String,
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
  logTag: String = SYNC_UTILS_TAG,
): PostResult =
  try {
    val response =
      httpClient.post(apiUrl) {
        headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        // Bypass Ktor ContentNegotiation: we already serialized — TextContent is sent as-is,
        // avoiding the JSON converter wrapping the String into "..." again.
        setBody(TextContent(jsonBody, ContentType.Application.Json))
      }
    if (response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created) {
      Log.d(logTag, "POST successful: ${response.status}")
      PostResult.Success
    } else {
      Log.e(logTag, "POST failed: HTTP ${response.status.value} ${response.status.description}")
      PostResult.HttpError(response.status.value, response.status.description)
    }
  } catch (e: Exception) {
    Log.e(logTag, "POST error: ${e.message}", e)
    PostResult.NetworkError(e.message ?: "Unknown error")
  }

/**
 * Encode a PostWrapper<T> using the supplied item serializer and POST it.
 */
suspend fun <T : Any> postChunk(
  data: PostWrapper<T>,
  itemSerializer: KSerializer<T>,
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
  logTag: String = SYNC_UTILS_TAG,
): PostResult {
  val jsonBody = appJson.encodeToString(PostWrapper.serializer(itemSerializer), data)
  return postChunkRaw(jsonBody, apiUrl, authToken, httpClient, logTag)
}

/**
 * Post a chunk with bounded exponential-backoff retry on transient failures.
 * 4xx (other than 408/429) bypass retry — they will not succeed on retry.
 */
suspend fun <T : Any> postChunkWithRetry(
  data: PostWrapper<T>,
  itemSerializer: KSerializer<T>,
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
  logTag: String = SYNC_UTILS_TAG,
): PostResult {
  val jsonBody = appJson.encodeToString(PostWrapper.serializer(itemSerializer), data)
  var lastResult: PostResult = PostResult.NetworkError("not attempted")
  for (attempt in 1..MAX_CHUNK_ATTEMPTS) {
    val result = postChunkRaw(jsonBody, apiUrl, authToken, httpClient, logTag)
    if (result.isSuccess) return result
    lastResult = result
    if (!result.isTransient || attempt == MAX_CHUNK_ATTEMPTS) return result
    val backoffMs = 500L * (1L shl (attempt - 1))
    Log.w(logTag, "Transient error on attempt $attempt: ${result.errorMessage()}; retrying in ${backoffMs}ms")
    delay(backoffMs)
  }
  return lastResult
}

/**
 * Post data in chunks to avoid 413 Request Entity Too Large errors.
 * HeartRateRecord can be very large (thousands of samples per record).
 *
 * @param dataList The list of records to post
 * @param itemSerializer kotlinx.serialization serializer for the item type
 * @param chunkSize Maximum number of records per chunk
 * @param recordTypeName Name of the record type for logging and progress reporting
 * @param reporter Sync progress reporter for per-chunk UI updates
 */
suspend fun <T : Any> postDataChunked(
  dataList: List<T>,
  itemSerializer: KSerializer<T>,
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
  chunkSize: Int,
  recordTypeName: String,
  reporter: SyncProgressReporter = NoOpSyncProgressReporter,
  logTag: String = SYNC_UTILS_TAG,
): PostResult {
  if (dataList.isEmpty()) {
    Log.d(logTag, "No $recordTypeName to send")
    return PostResult.Success
  }

  val chunks = dataList.chunked(chunkSize)
  val total = chunks.size
  Log.d(logTag, "Sending $recordTypeName in $total chunks of up to $chunkSize records each")

  reporter.updateRecordType(recordTypeName) {
    it.copy(status = SyncStageStatus.Active, totalChunks = total, currentChunk = 0)
  }

  var sent = 0
  for ((index, chunk) in chunks.withIndex()) {
    val chunkNum = index + 1
    Log.d(logTag, "Sending $recordTypeName chunk $chunkNum/$total with ${chunk.size} records")
    reporter.updateRecordType(recordTypeName) { it.copy(currentChunk = chunkNum) }

    val result =
      postChunkWithRetry(
        data = PostWrapper(chunk),
        itemSerializer = itemSerializer,
        apiUrl = apiUrl,
        authToken = authToken,
        httpClient = httpClient,
        logTag = logTag,
      )

    if (!result.isSuccess) {
      val msg = "$recordTypeName chunk $chunkNum/$total failed: ${result.errorMessage()}"
      Log.e(logTag, msg)
      reporter.updateRecordType(recordTypeName) {
        it.copy(status = SyncStageStatus.Failed, errorMessage = result.errorMessage())
      }
      return result
    }

    sent += chunk.size
    reporter.updateRecordType(recordTypeName) { it.copy(sentRecords = sent) }
    Log.d(logTag, "$recordTypeName chunk $chunkNum succeeded")
  }

  reporter.updateRecordType(recordTypeName) {
    it.copy(status = SyncStageStatus.Done, currentChunk = total, sentRecords = sent)
  }
  Log.d(logTag, "All $total chunks of $recordTypeName sent successfully")
  return PostResult.Success
}

/**
 * Filter out records written by Aurboda's own outbound sync or BLE sensors.
 * This prevents sync loops where data we pushed to Health Connect gets re-ingested.
 */
fun List<Record>.filterNotOwnOrigin(): List<Record> =
  filter { record ->
    val isOwnOrigin = record.metadata.dataOrigin.packageName == "net.aurboda"
    val isOutboundSync =
      record.metadata.clientRecordId
        ?.startsWith(OUTBOUND_SYNC_CLIENT_ID_PREFIX) == true
    !(isOwnOrigin || isOutboundSync)
  }

/** Send deletion IDs to the backend. Shared by SyncWorker and MainActivity. */
suspend fun sendDeletions(
  deletionIds: List<String>,
  serverUrl: String,
  authToken: String,
  httpClient: HttpClient,
  logTag: String = SYNC_UTILS_TAG,
): PostResult {
  if (deletionIds.isEmpty()) return PostResult.Success

  return postChunkWithRetry(
    data = PostWrapper(deletionIds),
    itemSerializer = String.serializer(),
    apiUrl = "$serverUrl/sync/deletions",
    authToken = authToken,
    httpClient = httpClient,
    logTag = logTag,
  ).also { result ->
    if (result.isSuccess) {
      Log.d(logTag, "Sent ${deletionIds.size} deletions successfully")
    } else {
      Log.e(logTag, "Deletions failed: ${result.errorMessage()}")
    }
  }
}

/**
 * Send a non-chunked record group as one POST. Reports per-record-type progress.
 */
private suspend fun <S : Any> sendSingleType(
  serializables: List<S>,
  itemSerializer: KSerializer<S>,
  syncUrl: String,
  authToken: String,
  httpClient: HttpClient,
  recordTypeName: String,
  reporter: SyncProgressReporter,
  logTag: String,
): PostResult {
  reporter.updateRecordType(recordTypeName) {
    it.copy(status = SyncStageStatus.Active, totalChunks = 1, currentChunk = 1)
  }
  val result =
    postChunkWithRetry(PostWrapper(serializables), itemSerializer, syncUrl, authToken, httpClient, logTag)
  reporter.updateRecordType(recordTypeName) {
    when {
      result.isSuccess ->
        it.copy(
          status = SyncStageStatus.Done,
          sentRecords = serializables.size,
          currentChunk = 1,
        )
      else -> it.copy(status = SyncStageStatus.Failed, errorMessage = result.errorMessage())
    }
  }
  return result
}

/**
 * Send records to the server, grouped by record type and serialized appropriately.
 * Handles ALL Health Connect record types that have serializers defined.
 * Uses chunked posting for HeartRateRecord (large payloads with many samples).
 */
suspend fun sendRecords(
  records: List<Record>,
  serverUrl: String,
  authToken: String,
  httpClient: HttpClient,
  reporter: SyncProgressReporter = NoOpSyncProgressReporter,
  logTag: String = SYNC_UTILS_TAG,
): PostResult {
  if (records.isEmpty()) return PostResult.Success

  val groupedRecords = records.groupBy { it::class }

  for ((recordClass, classRecords) in groupedRecords) {
    if (classRecords.isEmpty()) continue
    val typeName = recordClass.simpleName ?: "UnknownRecordType"
    val syncUrl = "$serverUrl/sync/$typeName"

    classRecords.oldestModifiedTime()?.let(reporter::reportDataInstant)

    val result =
      when (recordClass) {
        ActiveCaloriesBurnedRecord::class ->
          sendSingleType(
            ActiveCaloriesBurnedRecordSerializable.fromRecordsList(classRecords),
            ActiveCaloriesBurnedRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        BasalBodyTemperatureRecord::class ->
          sendSingleType(
            BasalBodyTemperatureRecordSerializable.fromRecordsList(classRecords),
            BasalBodyTemperatureRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        BasalMetabolicRateRecord::class ->
          sendSingleType(
            BasalMetabolicRateRecordSerializable.fromRecordsList(classRecords),
            BasalMetabolicRateRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        BloodGlucoseRecord::class ->
          sendSingleType(
            BloodGlucoseRecordSerializable.fromRecordsList(classRecords),
            BloodGlucoseRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        BloodPressureRecord::class ->
          sendSingleType(
            BloodPressureRecordSerializable.fromRecordsList(classRecords),
            BloodPressureRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        BodyFatRecord::class ->
          sendSingleType(
            BodyFatRecordSerializable.fromRecordsList(classRecords),
            BodyFatRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        BodyTemperatureRecord::class ->
          sendSingleType(
            BodyTemperatureRecordSerializable.fromRecordsList(classRecords),
            BodyTemperatureRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        BodyWaterMassRecord::class ->
          sendSingleType(
            BodyWaterMassRecordSerializable.fromRecordsList(classRecords),
            BodyWaterMassRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        BoneMassRecord::class ->
          sendSingleType(
            BoneMassRecordSerializable.fromRecordsList(classRecords),
            BoneMassRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        CervicalMucusRecord::class ->
          sendSingleType(
            CervicalMucusRecordSerializable.fromRecordsList(classRecords),
            CervicalMucusRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        CyclingPedalingCadenceRecord::class ->
          sendSingleType(
            CyclingPedalingCadenceRecordSerializable.fromRecordsList(classRecords),
            CyclingPedalingCadenceRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        DistanceRecord::class ->
          sendSingleType(
            DistanceRecordSerializable.fromRecordsList(classRecords),
            DistanceRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        ElevationGainedRecord::class ->
          sendSingleType(
            ElevationGainedRecordSerializable.fromRecordsList(classRecords),
            ElevationGainedRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        ExerciseSessionRecord::class ->
          sendSingleType(
            ExerciseSessionRecordSerializable.fromRecordsList(classRecords),
            ExerciseSessionRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        FloorsClimbedRecord::class ->
          sendSingleType(
            FloorsClimbedRecordSerializable.fromRecordsList(classRecords),
            FloorsClimbedRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        HeartRateRecord::class ->
          postDataChunked(
            HeartRateRecordSerializable.fromRecordsList(classRecords),
            HeartRateRecordSerializable.serializer(),
            syncUrl,
            authToken,
            httpClient,
            chunkSize = HEART_RATE_CHUNK_SIZE,
            recordTypeName = typeName,
            reporter = reporter,
            logTag = logTag,
          )
        HeartRateVariabilityRmssdRecord::class ->
          sendSingleType(
            HrvRecordSerializable.fromRecordsList(classRecords),
            HrvRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        HeightRecord::class ->
          sendSingleType(
            HeightRecordSerializable.fromRecordsList(classRecords),
            HeightRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        HydrationRecord::class ->
          sendSingleType(
            HydrationRecordSerializable.fromRecordsList(classRecords),
            HydrationRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        IntermenstrualBleedingRecord::class ->
          sendSingleType(
            IntermenstrualBleedingRecordSerializable.fromRecordsList(classRecords),
            IntermenstrualBleedingRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        LeanBodyMassRecord::class ->
          sendSingleType(
            LeanBodyMassRecordSerializable.fromRecordsList(classRecords),
            LeanBodyMassRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        MenstruationFlowRecord::class ->
          sendSingleType(
            MenstruationFlowRecordSerializable.fromRecordsList(classRecords),
            MenstruationFlowRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        MenstruationPeriodRecord::class ->
          sendSingleType(
            MenstruationPeriodRecordSerializable.fromRecordsList(classRecords),
            MenstruationPeriodRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        NutritionRecord::class ->
          sendSingleType(
            NutritionRecordSerializable.fromRecordsList(classRecords),
            NutritionRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        OvulationTestRecord::class ->
          sendSingleType(
            OvulationTestRecordSerializable.fromRecordsList(classRecords),
            OvulationTestRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        OxygenSaturationRecord::class ->
          sendSingleType(
            OxygenSaturationRecordSerializable.fromRecordsList(classRecords),
            OxygenSaturationRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        PowerRecord::class ->
          sendSingleType(
            PowerRecordSerializable.fromRecordsList(classRecords),
            PowerRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        RespiratoryRateRecord::class ->
          sendSingleType(
            RespiratoryRateRecordSerializable.fromRecordsList(classRecords),
            RespiratoryRateRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        RestingHeartRateRecord::class ->
          sendSingleType(
            RestingHeartRateRecordSerializable.fromRecordsList(classRecords),
            RestingHeartRateRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        SexualActivityRecord::class ->
          sendSingleType(
            SexualActivityRecordSerializable.fromRecordsList(classRecords),
            SexualActivityRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        SleepSessionRecord::class ->
          sendSingleType(
            SleepSessionRecordSerializable.fromRecordsList(classRecords),
            SleepSessionRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        SpeedRecord::class ->
          sendSingleType(
            SpeedRecordSerializable.fromRecordsList(classRecords),
            SpeedRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        StepsRecord::class ->
          sendSingleType(
            StepsRecordSerializable.fromRecordsList(classRecords),
            StepsRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        TotalCaloriesBurnedRecord::class ->
          sendSingleType(
            TotalCaloriesBurnedRecordSerializable.fromRecordsList(classRecords),
            TotalCaloriesBurnedRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        Vo2MaxRecord::class ->
          sendSingleType(
            Vo2MaxRecordSerializable.fromRecordsList(classRecords),
            Vo2MaxRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        WeightRecord::class ->
          sendSingleType(
            WeightRecordSerializable.fromRecordsList(classRecords),
            WeightRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        WheelchairPushesRecord::class ->
          sendSingleType(
            WheelchairPushesRecordSerializable.fromRecordsList(classRecords),
            WheelchairPushesRecordSerializable.serializer(),
            syncUrl, authToken, httpClient, typeName, reporter, logTag,
          )
        else -> {
          Log.w(logTag, "No serializer for $typeName, skipping ${classRecords.size} records")
          reporter.updateRecordType(typeName) { it.copy(status = SyncStageStatus.Skipped, errorMessage = "no serializer") }
          PostResult.Success
        }
      }

    if (!result.isSuccess) {
      Log.w(logTag, "Failed to send $typeName: ${result.errorMessage()}")
      return result
    }
    Log.d(logTag, "Sent ${classRecords.size} $typeName records")
  }

  return PostResult.Success
}

/**
 * Send a page of changes (deletions + records) to the backend.
 * Deletions are sent first, then records.
 */
suspend fun sendPage(
  records: List<Record>,
  deletionIds: List<String>,
  serverUrl: String,
  authToken: String,
  httpClient: HttpClient,
  reporter: SyncProgressReporter = NoOpSyncProgressReporter,
  logTag: String = SYNC_UTILS_TAG,
): PostResult {
  val deletionResult = sendDeletions(deletionIds, serverUrl, authToken, httpClient, logTag)
  if (!deletionResult.isSuccess) return deletionResult
  return sendRecords(records, serverUrl, authToken, httpClient, reporter, logTag)
}
