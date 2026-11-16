package net.aurboda

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.runTest
import net.aurboda.api.models.OidcPreset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// Robolectric only for android.util.Log.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AuthApiOidcTest {
    private data class Seen(val url: String, val body: String?)

    private fun authApi(status: HttpStatusCode, body: String, seen: MutableList<Seen>): AuthApi =
        AuthApi(
            HttpClient(
                MockEngine { request ->
                    seen += Seen(request.url.toString(), (request.body as? TextContent)?.text?.replace(Regex("\\s"), ""))
                    respond(content = body, status = status, headers = headersOf(HttpHeaders.ContentType, "application/json"))
                },
            ) { install(ContentNegotiation) { json(appJson) } },
        )

    @Test
    fun `oidcProviders lists the server's providers`() = runTest {
        val seen = mutableListOf<Seen>()
        val api = authApi(
            HttpStatusCode.OK,
            """{"providers":[{"id":"google","display_name":"Google","preset":"google","allow_signup":false},
               {"id":"work","display_name":"Work SSO","preset":null,"allow_signup":true}]}""",
            seen,
        )
        val providers = api.oidcProviders("https://aurboda.example/")
        assertEquals("https://aurboda.example/api/auth/oidc/providers", seen.single().url)
        assertEquals(listOf("google", "work"), providers.map { it.id })
        assertEquals(OidcPreset.google, providers[0].preset)
        assertEquals(null, providers[1].preset)
    }

    @Test
    fun `oidcProviders is empty for a server without the route`() = runTest {
        val api = authApi(HttpStatusCode.NotFound, """{"error":"Not found"}""", mutableListOf())
        assertEquals(emptyList<Any>(), api.oidcProviders("https://old.example"))
    }

    @Test
    fun `oidcStart asks for an app flow and returns the URL and the verifier`() = runTest {
        val seen = mutableListOf<Seen>()
        val api = authApi(
            HttpStatusCode.OK,
            """{"success":true,"authorization_url":"https://accounts.google.com/auth?state=s","verifier":"v"}""",
            seen,
        )
        val result = api.oidcStart("https://aurboda.example", "google")
        assertEquals("https://aurboda.example/api/auth/oidc/google/start", seen.single().url)
        assertTrue(seen.single().body.orEmpty().contains("\"client\":\"app\""))
        assertEquals(OidcStartResult.Success("https://accounts.google.com/auth?state=s", "v"), result)
    }

    @Test
    fun `oidcStart passes the server's error on`() = runTest {
        val api = authApi(
            HttpStatusCode.NotFound,
            """{"success":false,"error":"Unknown sign-in provider"}""",
            mutableListOf(),
        )
        assertEquals(OidcStartResult.Error("Unknown sign-in provider"), api.oidcStart("https://a.example", "gone"))
    }

    @Test
    fun `oidcExchange sends the code with the verifier and returns the session`() = runTest {
        val seen = mutableListOf<Seen>()
        val api = authApi(
            HttpStatusCode.OK,
            """{"success":true,"token":"tok","is_admin":false,"username":"ada"}""",
            seen,
        )
        val result = api.oidcExchange("https://aurboda.example", "the-code", "the-verifier")
        assertEquals("https://aurboda.example/api/auth/oidc/exchange", seen.single().url)
        val body = seen.single().body.orEmpty()
        assertTrue(body.contains("\"code\":\"the-code\""))
        assertTrue(body.contains("\"verifier\":\"the-verifier\""))
        assertEquals(OidcExchangeResult.Success(username = "ada", token = "tok"), result)
    }

    @Test
    fun `oidcExchange passes a refused code's error on`() = runTest {
        val api = authApi(
            HttpStatusCode.BadRequest,
            """{"success":false,"error":"This sign-in has expired or was used already; start again"}""",
            mutableListOf(),
        )
        assertEquals(
            OidcExchangeResult.Error("This sign-in has expired or was used already; start again"),
            api.oidcExchange("https://aurboda.example", "c", "v"),
        )
    }
}
