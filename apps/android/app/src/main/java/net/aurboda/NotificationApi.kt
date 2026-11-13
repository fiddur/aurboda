package net.aurboda

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.isSuccess
import java.net.URLEncoder
import java.time.Instant

/**
 * Backend calls for the notifier: the central notifications store, and for a server without it
 * the newest page of the home timeline and the following list (to know which actors still have
 * notifications on). None of them throw — the worker simply retries next period.
 */
private const val TAG = "NotificationApi"

suspend fun fetchTimelinePage(httpClient: HttpClient, apiUrl: String, authToken: String): TimelinePage? =
    getJson(httpClient, "$apiUrl/feed/timeline", authToken)

suspend fun fetchFollowingList(httpClient: HttpClient, apiUrl: String, authToken: String): FollowingList? =
    getJson(httpClient, "$apiUrl/feed/following", authToken)

sealed interface PushFetch {
    data class Ok(val page: ServerNotificationsPage) : PushFetch

    /** The server has no `/notifications` (it predates central notifications). */
    data object Unsupported : PushFetch

    data object Failed : PushFetch
}

suspend fun fetchPushNotifications(
    httpClient: HttpClient,
    apiUrl: String,
    authToken: String,
    after: Instant?,
): PushFetch {
    val afterParam = after?.let { "&after=" + URLEncoder.encode(it.toString(), "UTF-8") } ?: ""
    val url = "$apiUrl/notifications?push_only=true&unread_only=true&limit=20$afterParam"
    return try {
        val response = httpClient.get(url) {
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        }
        when (response.status) {
            HttpStatusCode.OK -> PushFetch.Ok(appJson.decodeFromString<ServerNotificationsPage>(response.bodyAsText()))
            HttpStatusCode.NotFound -> PushFetch.Unsupported
            else -> {
                Log.w(TAG, "GET $url returned ${response.status}")
                PushFetch.Failed
            }
        }
    } catch (e: Exception) {
        Log.w(TAG, "GET $url failed: ${e.message}")
        PushFetch.Failed
    }
}

suspend fun fetchUnreadNotificationCount(httpClient: HttpClient, apiUrl: String, authToken: String): Int? =
    getJson<ServerNotificationsPage>(httpClient, "$apiUrl/notifications?limit=1", authToken)?.unreadCount

suspend fun fetchNotificationTypes(httpClient: HttpClient, apiUrl: String, authToken: String): NotificationTypesList? =
    getJson(httpClient, "$apiUrl/notifications/types", authToken)

suspend fun markNotificationRead(httpClient: HttpClient, apiUrl: String, authToken: String, id: String): Boolean =
    postEmpty(httpClient, "$apiUrl/notifications/$id/read", authToken)

suspend fun runNotificationAction(
    httpClient: HttpClient,
    apiUrl: String,
    authToken: String,
    id: String,
    key: String,
): Boolean = postEmpty(httpClient, "$apiUrl/notifications/$id/actions/$key", authToken)

private suspend fun postEmpty(httpClient: HttpClient, url: String, authToken: String): Boolean =
    try {
        val response = httpClient.post(url) {
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        }
        if (!response.status.isSuccess()) Log.w(TAG, "POST $url returned ${response.status}")
        response.status.isSuccess()
    } catch (e: Exception) {
        Log.w(TAG, "POST $url failed: ${e.message}")
        false
    }

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
