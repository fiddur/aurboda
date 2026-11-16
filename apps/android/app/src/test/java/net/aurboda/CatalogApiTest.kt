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

// Robolectric only for android.util.Log.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class CatalogApiTest {
    private fun client(status: HttpStatusCode, body: String, seen: MutableList<Pair<String, String?>>): HttpClient =
        HttpClient(
            MockEngine { request ->
                seen += request.url.toString() to request.headers[HttpHeaders.Authorization]
                respond(content = body, status = status, headers = headersOf(HttpHeaders.ContentType, "application/json"))
            },
        ) { install(ContentNegotiation) { json(appJson) } }

    @Test
    fun `fetchActivityTypeCatalog gets the catalogue's entries with the token`() = runTest {
        val seen = mutableListOf<Pair<String, String?>>()
        val http = client(
            HttpStatusCode.OK,
            """{"success":true,"data":{"version":"1","groups":[],"entries":[
               {"name":"headache","display_name":"Headache","display_category":"health","group":"symptoms",
                "icon":"🤕","color":"#aa3344","aliases":[],"same_as":{},"in_use":false,"missing_fields":[]}]}}""",
            seen,
        )
        val result = fetchActivityTypeCatalog(http, "https://aurboda.net/api", "tok")
        assertEquals(listOf("https://aurboda.net/api/activity-type-catalog" to "Bearer tok"), seen)
        assertEquals(listOf("headache"), (result as DataResult.Success).data.map { it.name })
    }

    @Test
    fun `fetchMetricCatalog gets the catalogue's entries`() = runTest {
        val seen = mutableListOf<Pair<String, String?>>()
        val http = client(
            HttpStatusCode.OK,
            """{"success":true,"data":{"version":"1","groups":[],"entries":[
               {"name":"ldl","display_name":"LDL","group":"lipids","aliases":[],"unit":"mmol/L",
                "units":[{"unit":"mg/dL","factor":0.02586}],"in_use":false}]}}""",
            seen,
        )
        val result = fetchMetricCatalog(http, "https://aurboda.net/api", "tok")
        assertEquals("https://aurboda.net/api/metric-catalog", seen.single().first)
        assertEquals("mg/dL", (result as DataResult.Success).data.single().units.single().unit)
    }

    @Test
    fun `a refused catalogue fetch is an error`() = runTest {
        val result = fetchMetricCatalog(client(HttpStatusCode.Unauthorized, "{}", mutableListOf()), "https://x", "tok")
        assertTrue(result is DataResult.Error)
    }
}
