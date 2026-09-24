package net.aurboda

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// Robolectric only for android.util.Log, which the error paths hit.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ChallengeApiTest {
    private fun client(handler: (url: String, auth: String?) -> Pair<HttpStatusCode, String>): HttpClient =
        HttpClient(
            MockEngine { request ->
                val (status, body) = handler(request.url.toString(), request.headers[HttpHeaders.Authorization])
                respond(content = body, status = status, headers = headersOf(HttpHeaders.ContentType, "application/json"))
            },
        ) { install(ContentNegotiation) { json(appJson) } }

    private val credentials = CredentialsManager.Credentials("https://aurboda.net", "fiddur", "tok")

    @Test
    fun `fetchPublicChallengeStandings hits the host's public endpoint, unauthenticated, and parses members`() = runTest {
        var seen: Pair<String, String?>? = null
        val http =
            client { url, auth ->
                seen = url to auth
                HttpStatusCode.OK to
                    """{"success":true,"members":[{"buckets":[{"bucket_start":"2026-08-01T00:00:00.000Z","value":4486}],
                       "display_name":"fiddur","identity_base_url":"https://aurboda.net/u/fiddur","last_updated":null,
                       "stale":false,"status":"active","total":4486}]}"""
            }
        val result = fetchPublicChallengeStandings(http, "https://aurboda.net/api/", "fiddur", "august steppers")
        assertEquals("https://aurboda.net/api/public/fiddur/august%20steppers/standings", seen?.first)
        assertEquals(null, seen?.second)
        assertTrue(result is DataResult.Success)
        val members = (result as DataResult.Success).data.members!!
        assertEquals(1, members.size)
        assertEquals(4486.0, members[0].total, 0.0)
        assertEquals("2026-08-01T00:00:00.000Z", members[0].buckets[0].bucketStart)
    }

    @Test
    fun `fetchDiscoverChallenges sends the bearer token and unwraps the list`() = runTest {
        var seen: Pair<String, String?>? = null
        val http =
            client { url, auth ->
                seen = url to auth
                HttpStatusCode.OK to
                    """{"success":true,"peers_unreachable":1,"challenges":[{"end_ts":"2026-10-01T00:00:00.000Z",
                       "host_actor_uri":"https://peer.example/users/alice","host_display_name":"Alice","host_handle":"@alice@peer.example",
                       "host_identity":"https://peer.example/u/alice","name":"October steps","share_url":"https://peer.example/u/alice/oct",
                       "spec":{"aggregation":"sum","bucket_size":"auto","pattern":"steps","source_type":"metric","unit":"steps"},
                       "start_ts":"2026-09-01T00:00:00.000Z","status":"ongoing","timezone":"Europe/Stockholm"}]}"""
            }
        val result = fetchDiscoverChallenges(http, "https://aurboda.net/api", "tok")
        assertEquals("https://aurboda.net/api/challenges/discover" to "Bearer tok", seen)
        val found = (result as DataResult.Success).data.single()
        assertEquals("October steps", found.name)
        assertEquals("@alice@peer.example", found.hostHandle)
    }

    @Test
    fun `a cancelled request propagates the cancellation instead of becoming an error result`() = runTest {
        val http =
            HttpClient(MockEngine { throw kotlinx.coroutines.CancellationException("worker stopped") }) {
                install(ContentNegotiation) { json(appJson) }
            }
        val thrown = runCatching { fetchChallenges(http, "https://aurboda.net/api", "tok") }.exceptionOrNull()
        assertTrue(thrown is kotlinx.coroutines.CancellationException)
    }

    @Test
    fun `fetchChallenges sends the bearer token and unwraps the list`() = runTest {
        var seenAuth: String? = null
        val http =
            client { _, auth ->
                seenAuth = auth
                HttpStatusCode.OK to
                    """{"success":true,"challenges":[{"created_at":"2026-07-30T00:00:00.000Z","end_ts":"2026-08-31T22:00:00.000Z",
                       "id":"11111111-1111-4111-8111-111111111111","name":"August steppers","share_url":"https://aurboda.net/u/fiddur/august-steppers",
                       "slug":"august-steppers","spec":{"aggregation":"sum","bucket_size":"auto","pattern":"steps","source_type":"metric","unit":"steps"},
                       "start_ts":"2026-07-31T22:00:00.000Z","timezone":"Europe/Stockholm","updated_at":"2026-07-30T00:00:00.000Z","visibility":"public"}]}"""
            }
        val result = fetchChallenges(http, "https://aurboda.net/api", "tok")
        assertEquals("Bearer tok", seenAuth)
        assertEquals("August steppers", (result as DataResult.Success).data.single().name)
    }

    @Test
    fun `resolveApiBase answers the own instance locally and discovers others via well-known`() = runTest {
        val urls = mutableListOf<String>()
        val http =
            client { url, _ ->
                urls += url
                HttpStatusCode.OK to
                    """{"api_base":"https://other.example/api","federation":true,"product":"aurboda","version":"1.2.3"}"""
            }
        assertEquals(DataResult.Success("https://aurboda.net/api"), resolveApiBase(http, credentials, "https://aurboda.net/"))
        assertTrue(urls.isEmpty())

        assertEquals(DataResult.Success("https://other.example/api"), resolveApiBase(http, credentials, "https://other.example"))
        assertEquals(listOf("https://other.example/.well-known/aurboda"), urls)
    }

    @Test
    fun `discoverApiBase refuses an instance without federation and reports HTTP errors`() = runTest {
        val noFed = client { _, _ -> HttpStatusCode.OK to """{"api_base":"x","federation":false,"product":"aurboda","version":"1"}""" }
        assertTrue(discoverApiBase(noFed, "https://other.example") is DataResult.Error)

        val missing = client { _, _ -> HttpStatusCode.NotFound to "" }
        assertTrue(discoverApiBase(missing, "https://other.example") is DataResult.Error)
    }
}
