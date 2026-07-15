package net.aurboda

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode

/**
 * Read-only backend calls for the post notifier: the newest page of the home
 * timeline and the following list (to know which actors still have notifications
 * on). Both return null on any error — the worker simply retries next period.
 */
private const val TAG = "NotificationApi"

/** GET {apiUrl}/feed/timeline — newest home-timeline posts. */
suspend fun fetchTimelinePage(httpClient: HttpClient, apiUrl: String, authToken: String): TimelinePage? =
    getJson(httpClient, "$apiUrl/feed/timeline", authToken)

/** GET {apiUrl}/feed/following — the actors this user follows (with notify flags). */
suspend fun fetchFollowingList(httpClient: HttpClient, apiUrl: String, authToken: String): FollowingList? =
    getJson(httpClient, "$apiUrl/feed/following", authToken)

private suspend inline fun <reified T> getJson(
    httpClient: HttpClient,
    url: String,
    authToken: String,
): T? =
    try {
        val response = httpClient.get(url) {
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        }
        if (response.status == HttpStatusCode.OK) {
            appJson.decodeFromString<T>(response.bodyAsText())
        } else {
            Log.w(TAG, "GET $url returned ${response.status}")
            null
        }
    } catch (e: Exception) {
        Log.w(TAG, "GET $url failed: ${e.message}")
        null
    }
