package net.aurboda

import net.aurboda.api.models.LoginBody
import net.aurboda.api.models.LoginResponse
import org.junit.Test
import org.junit.Assert.*

/**
 * Unit tests for AuthApi data classes and serialization
 */
class AuthApiTest {

    @Test
    fun `LoginBody serializes correctly`() {
        val request = LoginBody(password = "testpass", username = "testuser")
        val json = appJson.encodeToString(LoginBody.serializer(), request)

        assertTrue(json.contains("\"username\""))
        assertTrue(json.contains("\"testuser\""))
        assertTrue(json.contains("\"password\""))
        assertTrue(json.contains("\"testpass\""))
    }

    @Test
    fun `LoginBody deserializes correctly`() {
        val json = """{"username":"user1","password":"pass1"}"""
        val request = appJson.decodeFromString<LoginBody>(json)

        assertEquals("user1", request.username)
        assertEquals("pass1", request.password)
    }

    @Test
    fun `LoginResponse deserializes correctly`() {
        val json = """{"token":"abc123"}"""
        val response = appJson.decodeFromString<LoginResponse>(json)

        assertEquals("abc123", response.token)
    }

    @Test
    fun `LoginResponse serializes correctly`() {
        val response = LoginResponse(token = "mytoken")
        val json = appJson.encodeToString(LoginResponse.serializer(), response)

        assertTrue(json.contains("\"token\""))
        assertTrue(json.contains("\"mytoken\""))
    }

    @Test
    fun `LoginResult Success contains token`() {
        val result = LoginResult.Success("token123")

        assertEquals("token123", result.token)
    }

    @Test
    fun `LoginResult Error contains message`() {
        val result = LoginResult.Error("Network error occurred")

        assertEquals("Network error occurred", result.message)
    }

    @Test
    fun `LoginResult can be checked with when expression`() {
        val successResult: LoginResult = LoginResult.Success("token")
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
        val json = """{"token":"t1","unknown":"ignored"}"""
        val response = appJson.decodeFromString<LoginResponse>(json)

        assertEquals("t1", response.token)
    }
}
