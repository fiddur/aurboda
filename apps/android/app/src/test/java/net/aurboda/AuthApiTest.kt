package net.aurboda

import org.junit.Test
import org.junit.Assert.*

/**
 * Unit tests for AuthApi data classes and serialization
 */
class AuthApiTest {

    @Test
    fun `LoginRequest serializes correctly`() {
        val request = LoginRequest("testuser", "testpass")
        val json = appJson.encodeToString(LoginRequest.serializer(), request)

        assertTrue(json.contains("\"username\""))
        assertTrue(json.contains("\"testuser\""))
        assertTrue(json.contains("\"password\""))
        assertTrue(json.contains("\"testpass\""))
    }

    @Test
    fun `LoginRequest deserializes correctly`() {
        val json = """{"username":"user1","password":"pass1"}"""
        val request = appJson.decodeFromString<LoginRequest>(json)

        assertEquals("user1", request.username)
        assertEquals("pass1", request.password)
    }

    @Test
    fun `LoginResponse deserializes correctly`() {
        val json = """{"token":"abc123","refresh":"def456"}"""
        val response = appJson.decodeFromString<LoginResponse>(json)

        assertEquals("abc123", response.token)
        assertEquals("def456", response.refresh)
    }

    @Test
    fun `LoginResponse serializes correctly`() {
        val response = LoginResponse("mytoken", "myrefresh")
        val json = appJson.encodeToString(LoginResponse.serializer(), response)

        assertTrue(json.contains("\"token\""))
        assertTrue(json.contains("\"mytoken\""))
        assertTrue(json.contains("\"refresh\""))
        assertTrue(json.contains("\"myrefresh\""))
    }

    @Test
    fun `LoginResult Success contains token data`() {
        val result = LoginResult.Success("token123", "refresh456")

        assertEquals("token123", result.token)
        assertEquals("refresh456", result.refreshToken)
    }

    @Test
    fun `LoginResult Error contains message`() {
        val result = LoginResult.Error("Network error occurred")

        assertEquals("Network error occurred", result.message)
    }

    @Test
    fun `LoginResult can be checked with when expression`() {
        val successResult: LoginResult = LoginResult.Success("token", "refresh")
        val errorResult: LoginResult = LoginResult.Error("error")

        val successMessage = when (successResult) {
            is LoginResult.Success -> "Got token: ${successResult.token}"
            is LoginResult.Error -> "Got error: ${successResult.message}"
        }

        val errorMessage = when (errorResult) {
            is LoginResult.Success -> "Got token: ${errorResult.token}"
            is LoginResult.Error -> "Got error: ${errorResult.message}"
        }

        assertEquals("Got token: token", successMessage)
        assertEquals("Got error: error", errorMessage)
    }

    @Test
    fun `LoginResponse ignores unknown keys`() {
        val json = """{"token":"t1","refresh":"r1","unknown":"ignored"}"""
        val response = appJson.decodeFromString<LoginResponse>(json)

        assertEquals("t1", response.token)
        assertEquals("r1", response.refresh)
    }
}
