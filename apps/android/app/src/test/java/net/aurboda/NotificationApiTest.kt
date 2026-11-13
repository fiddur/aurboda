package net.aurboda

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import java.net.URLDecoder
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// Robolectric only for android.util.Log, which the error paths hit.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationApiTest {
    private fun client(handler: (method: String, url: String) -> Pair<HttpStatusCode, String>): HttpClient =
        HttpClient(
            MockEngine { request ->
                val (status, body) = handler(request.method.value, request.url.toString())
                respond(content = body, status = status, headers = headersOf(HttpHeaders.ContentType, "application/json"))
            },
        ) { install(ContentNegotiation) { json(appJson) } }

    @Test
    fun `push fetch asks for unread push notifications after the mark`() = runTest {
        var seen: String? = null
        val http = client { _, url ->
            seen = url
            HttpStatusCode.OK to """{"notifications":[],"unread_count":0}"""
        }
        val result = fetchPushNotifications(http, "https://aurboda.net/api", "tok", Instant.parse("2026-11-13T10:00:00Z"))
        assertTrue(result is PushFetch.Ok)
        val url = seen!!
        assertTrue(url, url.startsWith("https://aurboda.net/api/notifications?push_only=true&unread_only=true&limit=20&after="))
        assertEquals("2026-11-13T10:00:00Z", URLDecoder.decode(url.substringAfter("after="), "UTF-8"))
    }

    @Test
    fun `a server without notifications is unsupported, other errors fail`() = runTest {
        assertEquals(
            PushFetch.Unsupported,
            fetchPushNotifications(client { _, _ -> HttpStatusCode.NotFound to "{}" }, "https://a/api", "tok", null),
        )
        assertEquals(
            PushFetch.Failed,
            fetchPushNotifications(client { _, _ -> HttpStatusCode.InternalServerError to "{}" }, "https://a/api", "tok", null),
        )
    }

    @Test
    fun `mark read and actions are bodiless POSTs that report success`() = runTest {
        val calls = mutableListOf<Pair<String, String>>()
        val ok = client { method, url ->
            calls += method to url
            HttpStatusCode.OK to "{}"
        }
        assertTrue(markNotificationRead(ok, "https://a/api", "tok", "n1"))
        assertTrue(runNotificationAction(ok, "https://a/api", "tok", "n1", "cancel"))
        assertEquals(
            listOf("POST" to "https://a/api/notifications/n1/read", "POST" to "https://a/api/notifications/n1/actions/cancel"),
            calls,
        )
        assertFalse(runNotificationAction(client { _, _ -> HttpStatusCode.Conflict to "{}" }, "https://a/api", "tok", "n1", "cancel"))
    }

    @Test
    fun `unread count comes from the page`() = runTest {
        val http = client { _, _ -> HttpStatusCode.OK to """{"notifications":[],"unread_count":4}""" }
        assertEquals(4, fetchUnreadNotificationCount(http, "https://a/api", "tok"))
    }
}
