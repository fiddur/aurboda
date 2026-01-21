package net.aurboda

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable

private const val TAG = "AuthApi"

@Serializable
data class LoginRequest(
    val username: String,
    val password: String
)

@Serializable
data class LoginResponse(
    val token: String,
    val refresh: String
)

sealed class LoginResult {
    data class Success(val token: String, val refreshToken: String) : LoginResult()
    data class Error(val message: String) : LoginResult()
}

class AuthApi(private val httpClient: HttpClient) {

    suspend fun login(serverUrl: String, username: String, password: String): LoginResult {
        val loginUrl = "$serverUrl/api/v2/login"
        Log.d(TAG, "Attempting login to: $loginUrl for user: $username")
        return try {
            val response = httpClient.post(loginUrl) {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(username, password))
            }
            val loginResponse = response.body<LoginResponse>()
            Log.d(TAG, "Login successful for user: $username")
            LoginResult.Success(loginResponse.token, loginResponse.refresh)
        } catch (e: Exception) {
            Log.e(TAG, "Login failed: ${e.message}", e)
            LoginResult.Error(e.message ?: "Login failed")
        }
    }

    companion object {
        fun create(): AuthApi {
            val client = HttpClient(Android) {
                install(ContentNegotiation) {
                    json(appJson)
                }
            }
            return AuthApi(client)
        }
    }
}
