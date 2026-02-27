package net.aurboda

import android.content.Context
import android.util.Log
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
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

private const val TAG = "ActivityWatchSync"
private const val PREFS_NAME = "AurbodaAppPrefs"
private const val AW_SYNC_ENABLED_KEY = "activityWatchSyncEnabled"
private const val AW_LAST_SYNC_PREFIX = "aw_last_sync_"
private const val AW_URL = "http://localhost:5600"
private const val AW_TIMEOUT_MS = 2000L

// ============================================================================
// Preferences
// ============================================================================

fun isActivityWatchSyncEnabled(context: Context): Boolean {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  return prefs.getBoolean(AW_SYNC_ENABLED_KEY, false)
}

fun setActivityWatchSyncEnabled(
  context: Context,
  enabled: Boolean,
) {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  prefs.edit().putBoolean(AW_SYNC_ENABLED_KEY, enabled).apply()
}

private fun getLastSyncTime(
  context: Context,
  bucketId: String,
): String? {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  return prefs.getString("$AW_LAST_SYNC_PREFIX$bucketId", null)
}

private fun setLastSyncTime(
  context: Context,
  bucketId: String,
  timestamp: String,
) {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  prefs.edit().putString("$AW_LAST_SYNC_PREFIX$bucketId", timestamp).apply()
}

// ============================================================================
// API Models
// ============================================================================

@Serializable
data class AwEvent(
  val timestamp: String,
  val duration: Double,
  val data: JsonObject,
)

@Serializable
data class AurbodaAwEvent(
  val app: String,
  val duration: Double,
  val timestamp: String,
  val title: String? = null,
)

@Serializable
data class AurbodaAwSyncBody(
  val device_name: String,
  val events: List<AurbodaAwEvent>,
  val is_mobile: Boolean = true,
)

@Serializable
data class AurbodaAwSyncResponse(
  val success: Boolean,
  val result: AurbodaAwSyncResult? = null,
  val error: String? = null,
)

@Serializable
data class AurbodaAwSyncResult(
  val status: String,
  val records_stored: Int,
  val device_name: String,
  val error: String? = null,
)

// ============================================================================
// Result
// ============================================================================

data class ActivityWatchSyncResult(
  val available: Boolean = false,
  val bucketsFound: Int = 0,
  val eventsFetched: Int = 0,
  val eventsPushed: Int = 0,
  val error: String? = null,
)

// ============================================================================
// AW Local API Client
// ============================================================================

/**
 * Check if ActivityWatch is reachable on localhost.
 */
suspend fun checkActivityWatchAvailable(httpClient: HttpClient): Boolean =
  try {
    val response = httpClient.get("$AW_URL/api/0/info")
    response.status == HttpStatusCode.OK
  } catch (_: Exception) {
    false
  }

/**
 * Fetch bucket list from ActivityWatch and filter for app-usage buckets.
 * Returns a list of (bucketId, bucketType) pairs.
 *
 * Desktop: type == "currentwindow" (aw-watcher-window)
 * Android: bucket ID starts with "aw-android-appevents"
 */
suspend fun fetchAppEventBuckets(httpClient: HttpClient): List<Pair<String, String>> =
  try {
    val response = httpClient.get("$AW_URL/api/0/buckets/")
    if (response.status != HttpStatusCode.OK) return emptyList()

    val body = response.bodyAsText()
    val buckets = appJson.decodeFromString<Map<String, JsonObject>>(body)

    buckets.entries
      .filter { (id, bucket) ->
        val type = bucket["type"]?.jsonPrimitive?.contentOrNull
        type == "currentwindow" || id.startsWith("aw-android-appevents")
      }.map { (id, bucket) ->
        val type = bucket["type"]?.jsonPrimitive?.contentOrNull ?: "unknown"
        id to type
      }
  } catch (e: Exception) {
    Log.e(TAG, "🚫 Error fetching AW buckets: ${e.message}")
    emptyList()
  }

/**
 * Fetch events from a specific bucket since the given timestamp.
 */
suspend fun fetchBucketEvents(
  httpClient: HttpClient,
  bucketId: String,
  since: String?,
): List<AwEvent> =
  try {
    val url =
      buildString {
        append("$AW_URL/api/0/buckets/$bucketId/events?limit=500")
        if (since != null) append("&start=$since")
      }
    val response = httpClient.get(url)
    if (response.status != HttpStatusCode.OK) return emptyList()

    val body = response.bodyAsText()
    appJson.decodeFromString<List<AwEvent>>(body)
  } catch (e: Exception) {
    Log.e(TAG, "🚫 Error fetching events from $bucketId: ${e.message}")
    emptyList()
  }

/**
 * Push events to the Aurboda backend.
 */
suspend fun pushEventsToAurboda(
  httpClient: HttpClient,
  apiUrl: String,
  authToken: String,
  events: List<AurbodaAwEvent>,
  deviceName: String,
): AurbodaAwSyncResponse =
  try {
    val response =
      httpClient.post("$apiUrl/sync/activitywatch") {
        contentType(ContentType.Application.Json)
        headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        setBody(AurbodaAwSyncBody(device_name = deviceName, events = events))
      }
    if (response.status == HttpStatusCode.OK) {
      val body = response.bodyAsText()
      appJson.decodeFromString<AurbodaAwSyncResponse>(body)
    } else {
      AurbodaAwSyncResponse(success = false, error = "HTTP ${response.status.value}")
    }
  } catch (e: Exception) {
    Log.e(TAG, "🚫 Error pushing AW events to Aurboda: ${e.message}")
    AurbodaAwSyncResponse(success = false, error = e.message)
  }

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Full ActivityWatch sync pipeline:
 * 1. Check if AW is available (skip silently if not)
 * 2. Fetch app-usage buckets
 * 3. For each bucket, fetch new events since last sync
 * 4. Map to Aurboda format and push to backend
 * 5. Update last sync timestamp on success
 */
suspend fun processActivityWatchSync(
  apiUrl: String,
  authToken: String,
  httpClient: HttpClient,
  context: Context,
): ActivityWatchSyncResult {
  if (!checkActivityWatchAvailable(httpClient)) {
    return ActivityWatchSyncResult(available = false)
  }
  Log.d(TAG, "📱 ActivityWatch detected, starting sync")

  val buckets = fetchAppEventBuckets(httpClient)
  if (buckets.isEmpty()) {
    Log.d(TAG, "📱 No app-usage buckets found")
    return ActivityWatchSyncResult(available = true, bucketsFound = 0)
  }
  Log.d(TAG, "📱 Found ${buckets.size} app-usage bucket(s)")

  val deviceName = android.os.Build.MODEL
  var totalFetched = 0
  var totalPushed = 0

  for ((bucketId, _) in buckets) {
    val since = getLastSyncTime(context, bucketId)
    val events = fetchBucketEvents(httpClient, bucketId, since)
    if (events.isEmpty()) {
      Log.d(TAG, "📱 No new events in $bucketId")
      continue
    }

    totalFetched += events.size
    Log.d(TAG, "📱 Fetched ${events.size} events from $bucketId")

    // Map AW events to Aurboda format
    val aurbodaEvents =
      events.mapNotNull { event ->
        val app = event.data["app"]?.jsonPrimitive?.contentOrNull
        if (app == null) {
          Log.w(TAG, "⚠️ Skipping event without 'app' field: ${event.data.keys}")
          return@mapNotNull null
        }
        val title = event.data["title"]?.jsonPrimitive?.contentOrNull
        AurbodaAwEvent(
          app = app,
          duration = event.duration,
          timestamp = event.timestamp,
          title = title,
        )
      }

    if (aurbodaEvents.isEmpty()) continue

    // Push in chunks of 500 to avoid oversized payloads
    for (chunk in aurbodaEvents.chunked(500)) {
      val response = pushEventsToAurboda(httpClient, apiUrl, authToken, chunk, deviceName)
      if (response.success) {
        totalPushed += response.result?.records_stored ?: chunk.size
        Log.d(TAG, "✅ Pushed ${chunk.size} events from $bucketId")
      } else {
        Log.e(TAG, "🚫 Failed to push events from $bucketId: ${response.error}")
        return ActivityWatchSyncResult(
          available = true,
          bucketsFound = buckets.size,
          eventsFetched = totalFetched,
          eventsPushed = totalPushed,
          error = response.error,
        )
      }
    }

    // Update last sync time to the latest event timestamp
    val latestTimestamp = events.maxByOrNull { it.timestamp }?.timestamp
    if (latestTimestamp != null) {
      setLastSyncTime(context, bucketId, latestTimestamp)
    }
  }

  if (totalFetched > 0) {
    Log.d(TAG, "✅ ActivityWatch sync complete: $totalPushed events pushed")
  }

  return ActivityWatchSyncResult(
    available = true,
    bucketsFound = buckets.size,
    eventsFetched = totalFetched,
    eventsPushed = totalPushed,
  )
}
