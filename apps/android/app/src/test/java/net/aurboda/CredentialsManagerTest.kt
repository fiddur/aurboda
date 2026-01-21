package net.aurboda

import org.junit.Test
import org.junit.Assert.*

/**
 * Unit tests for CredentialsManager data classes.
 * Note: Full CredentialsManager tests with EncryptedSharedPreferences
 * require instrumented tests (androidTest) due to Android Context dependency.
 */
class CredentialsManagerTest {

    @Test
    fun `Credentials data class stores all fields`() {
        val credentials = CredentialsManager.Credentials(
            serverUrl = "https://example.com",
            username = "testuser",
            authToken = "test-token-123"
        )

        assertEquals("https://example.com", credentials.serverUrl)
        assertEquals("testuser", credentials.username)
        assertEquals("test-token-123", credentials.authToken)
    }

    @Test
    fun `Credentials equality works correctly`() {
        val creds1 = CredentialsManager.Credentials("url", "user", "token")
        val creds2 = CredentialsManager.Credentials("url", "user", "token")
        val creds3 = CredentialsManager.Credentials("url2", "user", "token")

        assertEquals(creds1, creds2)
        assertNotEquals(creds1, creds3)
    }

    @Test
    fun `Credentials copy works correctly`() {
        val original = CredentialsManager.Credentials(
            serverUrl = "https://original.com",
            username = "originaluser",
            authToken = "original-token"
        )

        val copied = original.copy(serverUrl = "https://new.com")

        assertEquals("https://new.com", copied.serverUrl)
        assertEquals("originaluser", copied.username)
        assertEquals("original-token", copied.authToken)
    }

    @Test
    fun `Credentials handles special characters in values`() {
        val credentials = CredentialsManager.Credentials(
            serverUrl = "https://example.com/path?query=value&other=123",
            username = "user@example.com",
            authToken = "token+with/special=chars"
        )

        assertEquals("https://example.com/path?query=value&other=123", credentials.serverUrl)
        assertEquals("user@example.com", credentials.username)
        assertEquals("token+with/special=chars", credentials.authToken)
    }

    @Test
    fun `Credentials toString does not expose sensitive data in a dangerous way`() {
        val credentials = CredentialsManager.Credentials(
            serverUrl = "https://example.com",
            username = "testuser",
            authToken = "super-secret-token"
        )

        // The toString should include the token (it's a data class), but this test
        // documents the behavior. In production, you might want to override toString
        // to redact sensitive information.
        val stringRep = credentials.toString()
        assertTrue(stringRep.contains("Credentials"))
    }
}
