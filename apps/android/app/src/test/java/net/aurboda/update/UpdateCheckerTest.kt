package net.aurboda.update

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateCheckerTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun createMockClient(responseBody: String, statusCode: HttpStatusCode = HttpStatusCode.OK): HttpClient {
        return HttpClient(MockEngine { _ ->
            respond(
                content = responseBody,
                status = statusCode,
                headers = headersOf(HttpHeaders.ContentType, "application/json")
            )
        }) {
            install(ContentNegotiation) {
                json(json)
            }
        }
    }

    @Test
    fun `checkForUpdate returns UpdateAvailable when server version is higher`() = runTest {
        val responseJson = """
            {
                "versionCode": 100,
                "versionName": "1.0.100",
                "downloadUrl": "https://example.com/app.apk",
                "releaseNotes": "Bug fixes"
            }
        """.trimIndent()

        val client = createMockClient(responseJson)
        val result = checkForUpdate(client, "https://example.com/version.json", currentVersionCode = 50)

        assertTrue(result is UpdateCheckResult.UpdateAvailable)
        val updateResult = result as UpdateCheckResult.UpdateAvailable
        assertEquals(100, updateResult.versionInfo.versionCode)
        assertEquals("1.0.100", updateResult.versionInfo.versionName)
        assertEquals("https://example.com/app.apk", updateResult.versionInfo.downloadUrl)
        assertEquals("Bug fixes", updateResult.versionInfo.releaseNotes)
    }

    @Test
    fun `checkForUpdate returns NoUpdate when versions match`() = runTest {
        val responseJson = """
            {
                "versionCode": 50,
                "versionName": "1.0.50",
                "downloadUrl": "https://example.com/app.apk"
            }
        """.trimIndent()

        val client = createMockClient(responseJson)
        val result = checkForUpdate(client, "https://example.com/version.json", currentVersionCode = 50)

        assertTrue(result is UpdateCheckResult.NoUpdate)
    }

    @Test
    fun `checkForUpdate returns NoUpdate when current version is higher`() = runTest {
        val responseJson = """
            {
                "versionCode": 50,
                "versionName": "1.0.50",
                "downloadUrl": "https://example.com/app.apk"
            }
        """.trimIndent()

        val client = createMockClient(responseJson)
        val result = checkForUpdate(client, "https://example.com/version.json", currentVersionCode = 100)

        assertTrue(result is UpdateCheckResult.NoUpdate)
    }

    @Test
    fun `checkForUpdate returns Error on HTTP error`() = runTest {
        val client = createMockClient("Not Found", HttpStatusCode.NotFound)
        val result = checkForUpdate(client, "https://example.com/version.json", currentVersionCode = 50)

        assertTrue(result is UpdateCheckResult.Error)
        val errorResult = result as UpdateCheckResult.Error
        assertTrue(errorResult.message.contains("404"))
    }

    @Test
    fun `checkForUpdate returns Error on invalid JSON`() = runTest {
        val client = createMockClient("not valid json")
        val result = checkForUpdate(client, "https://example.com/version.json", currentVersionCode = 50)

        assertTrue(result is UpdateCheckResult.Error)
    }

    @Test
    fun `VersionInfo parses JSON correctly`() {
        val jsonString = """
            {
                "versionCode": 42,
                "versionName": "1.0.42",
                "downloadUrl": "https://github.com/user/repo/releases/download/latest/app.apk",
                "releaseNotes": "New features and improvements"
            }
        """.trimIndent()

        val versionInfo = json.decodeFromString<VersionInfo>(jsonString)

        assertEquals(42, versionInfo.versionCode)
        assertEquals("1.0.42", versionInfo.versionName)
        assertEquals("https://github.com/user/repo/releases/download/latest/app.apk", versionInfo.downloadUrl)
        assertEquals("New features and improvements", versionInfo.releaseNotes)
    }

    @Test
    fun `VersionInfo parses JSON without optional releaseNotes`() {
        val jsonString = """
            {
                "versionCode": 10,
                "versionName": "1.0.10",
                "downloadUrl": "https://example.com/app.apk"
            }
        """.trimIndent()

        val versionInfo = json.decodeFromString<VersionInfo>(jsonString)

        assertEquals(10, versionInfo.versionCode)
        assertEquals("1.0.10", versionInfo.versionName)
        assertEquals("https://example.com/app.apk", versionInfo.downloadUrl)
        assertEquals(null, versionInfo.releaseNotes)
    }

    @Test
    fun `VersionInfo ignores unknown keys`() {
        val jsonString = """
            {
                "versionCode": 5,
                "versionName": "1.0.5",
                "downloadUrl": "https://example.com/app.apk",
                "unknownField": "should be ignored"
            }
        """.trimIndent()

        val versionInfo = json.decodeFromString<VersionInfo>(jsonString)

        assertEquals(5, versionInfo.versionCode)
    }
}
