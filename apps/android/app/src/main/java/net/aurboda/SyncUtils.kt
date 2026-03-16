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
import io.ktor.http.contentType

const val SYNC_UTILS_TAG = "SyncUtils"

/** Result of a POST operation with error details for display */
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

  fun errorMessage(): String? =
    when (this) {
      is Success -> null
      is HttpError -> "HTTP $statusCode $statusDescription"
      is NetworkError -> "Network error: $message"
    }
}

/**
 * Post a single chunk of data to the server.
 * This is the core posting logic used by both regular and chunked posting.
 *
 * Note: Must be inline with reified T to preserve type information for serialization.
 */
suspend inline fun <reified T : Any> postChunk(
  data: PostWrapper<T>,
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
  logTag: String = SYNC_UTILS_TAG,
): PostResult =
  try {
    val response =
      httpClient.post(apiUrl) {
        contentType(ContentType.Application.Json)
        headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        setBody(data)
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
 * Post data in chunks to avoid 413 Request Entity Too Large errors.
 * HeartRateRecord can be very large (thousands of samples per record).
 *
 * @param dataList The list of records to post
 * @param apiUrl The URL to post to
 * @param authToken The auth token for the request
 * @param httpClient The HTTP client to use
 * @param chunkSize Maximum number of records per chunk (default 10)
 * @param recordTypeName Name of the record type for logging
 * @param logTag Tag for log messages
 * @return PostResult.Success if all chunks succeed, or the first error encountered
 *
 * Note: Must be inline with reified T to preserve type information for serialization.
 */
suspend inline fun <reified T : Any> postDataChunked(
  dataList: List<T>,
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
  chunkSize: Int = 10,
  recordTypeName: String = "data",
  logTag: String = SYNC_UTILS_TAG,
): PostResult {
  if (dataList.isEmpty()) {
    Log.d(logTag, "No $recordTypeName to send")
    return PostResult.Success
  }

  val chunks = dataList.chunked(chunkSize)
  Log.d(logTag, "Sending $recordTypeName in ${chunks.size} chunks of up to $chunkSize records each")

  for ((index, chunk) in chunks.withIndex()) {
    val chunkNum = index + 1
    Log.d(logTag, "Sending $recordTypeName chunk $chunkNum/${chunks.size} with ${chunk.size} records")

    val result =
      postChunk(
        data = PostWrapper(chunk),
        apiUrl = apiUrl,
        authToken = authToken,
        httpClient = httpClient,
        logTag = logTag,
      )

    if (!result.isSuccess) {
      Log.e(logTag, "$recordTypeName chunk $chunkNum failed: ${result.errorMessage()}")
      return result
    }

    Log.d(logTag, "$recordTypeName chunk $chunkNum succeeded")
  }

  Log.d(logTag, "All ${chunks.size} chunks of $recordTypeName sent successfully")
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

/**
 * Send deletion IDs to the backend. Shared by SyncWorker and MainActivity.
 */
suspend fun sendDeletions(
  deletionIds: List<String>,
  serverUrl: String,
  authToken: String,
  httpClient: HttpClient,
  logTag: String = SYNC_UTILS_TAG,
): PostResult {
  if (deletionIds.isEmpty()) return PostResult.Success

  return try {
    val response =
      httpClient.post("$serverUrl/sync/deletions") {
        contentType(ContentType.Application.Json)
        headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        setBody(PostWrapper(deletionIds))
      }
    if (response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created) {
      Log.d(logTag, "Sent ${deletionIds.size} deletions successfully")
      PostResult.Success
    } else {
      Log.e(logTag, "Deletions failed: HTTP ${response.status.value} ${response.status.description}")
      PostResult.HttpError(response.status.value, response.status.description)
    }
  } catch (e: Exception) {
    Log.e(logTag, "Error posting deletions", e)
    PostResult.NetworkError(e.message ?: "Unknown error")
  }
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
  logTag: String = SYNC_UTILS_TAG,
): PostResult {
  if (records.isEmpty()) return PostResult.Success

  val groupedRecords = records.groupBy { it::class }

  for ((recordClass, classRecords) in groupedRecords) {
    if (classRecords.isEmpty()) continue
    val typeName = recordClass.simpleName ?: "UnknownRecordType"
    val syncUrl = "$serverUrl/sync/$typeName"

    val result =
      when (recordClass) {
        ActiveCaloriesBurnedRecord::class ->
          postChunk(
            PostWrapper(ActiveCaloriesBurnedRecordSerializable.fromRecordsList(classRecords)),
            syncUrl,
            authToken,
            httpClient,
            logTag,
          )
        BodyFatRecord::class ->
          postChunk(PostWrapper(BodyFatRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        BodyWaterMassRecord::class ->
          postChunk(PostWrapper(BodyWaterMassRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        BoneMassRecord::class ->
          postChunk(PostWrapper(BoneMassRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        DistanceRecord::class ->
          postChunk(PostWrapper(DistanceRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        ExerciseSessionRecord::class ->
          postChunk(PostWrapper(ExerciseSessionRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        FloorsClimbedRecord::class ->
          postChunk(PostWrapper(FloorsClimbedRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        HeartRateRecord::class ->
          postDataChunked(
            HeartRateRecordSerializable.fromRecordsList(classRecords),
            syncUrl,
            authToken,
            httpClient,
            chunkSize = 10,
            recordTypeName = typeName,
            logTag = logTag,
          )
        HeartRateVariabilityRmssdRecord::class ->
          postChunk(PostWrapper(HrvRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        HeightRecord::class ->
          postChunk(PostWrapper(HeightRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        LeanBodyMassRecord::class ->
          postChunk(PostWrapper(LeanBodyMassRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        NutritionRecord::class ->
          postChunk(PostWrapper(NutritionRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        PowerRecord::class ->
          postChunk(PostWrapper(PowerRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        RestingHeartRateRecord::class ->
          postChunk(PostWrapper(RestingHeartRateRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        SleepSessionRecord::class ->
          postChunk(PostWrapper(SleepSessionRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        SpeedRecord::class ->
          postChunk(PostWrapper(SpeedRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        StepsRecord::class ->
          postChunk(PostWrapper(StepsRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        TotalCaloriesBurnedRecord::class ->
          postChunk(
            PostWrapper(TotalCaloriesBurnedRecordSerializable.fromRecordsList(classRecords)),
            syncUrl,
            authToken,
            httpClient,
            logTag,
          )
        Vo2MaxRecord::class ->
          postChunk(PostWrapper(Vo2MaxRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        WeightRecord::class ->
          postChunk(PostWrapper(WeightRecordSerializable.fromRecordsList(classRecords)), syncUrl, authToken, httpClient, logTag)
        else -> {
          Log.w(logTag, "No serializer for $typeName, skipping ${classRecords.size} records")
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
  logTag: String = SYNC_UTILS_TAG,
): PostResult {
  // Send deletions first
  val deletionResult = sendDeletions(deletionIds, serverUrl, authToken, httpClient, logTag)
  if (!deletionResult.isSuccess) return deletionResult

  // Then send records
  return sendRecords(records, serverUrl, authToken, httpClient, logTag)
}
