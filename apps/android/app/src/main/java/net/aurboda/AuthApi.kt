package net.aurboda

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CancellationException
import net.aurboda.api.models.LoginBody
import net.aurboda.api.models.LoginResponse
import net.aurboda.api.models.OidcClient
import net.aurboda.api.models.OidcExchangeBody
import net.aurboda.api.models.OidcLoginResponse
import net.aurboda.api.models.OidcPublicProvider
import net.aurboda.api.models.OidcPublicProvidersResponse
import net.aurboda.api.models.OidcStartBody
import net.aurboda.api.models.OidcStartResponse
import net.aurboda.api.models.ServerStatusResponse

private const val TAG = "AuthApi"

sealed class LoginResult {
    data class Success(val token: String) : LoginResult()
    data class Error(val message: String) : LoginResult()
}

sealed class OidcStartResult {
    data class Success(val authorizationUrl: String, val verifier: String) : OidcStartResult()
    data class Error(val message: String) : OidcStartResult()
}

sealed class OidcExchangeResult {
    data class Success(val username: String, val token: String) : OidcExchangeResult()
    data class Error(val message: String) : OidcExchangeResult()
}

class AuthApi(private val httpClient: HttpClient) {

    suspend fun login(serverUrl: String, username: String, password: String): LoginResult {
        val loginUrl = "${serverUrl.trimEnd('/')}/api/login"
        Log.d(TAG, "Attempting login to: $loginUrl for user: $username")
        return try {
            val response = httpClient.post(loginUrl) {
                contentType(ContentType.Application.Json)
                setBody(LoginBody(password = password, username = username))
            }
            val loginResponse = response.body<LoginResponse>()
            Log.d(TAG, "Login successful for user: $username")
            LoginResult.Success(loginResponse.token)
        } catch (e: Exception) {
            Log.e(TAG, "Login failed: ${e.message}", e)
            LoginResult.Error(e.message ?: "Login failed")
        }
    }

    /** Whether the server sends email, so a lost password or passkey can be recovered by an emailed link. */
    suspend fun isEmailEnabled(serverUrl: String): Boolean {
        val statusUrl = "${serverUrl.trimEnd('/')}/api/status"
        return try {
            httpClient.get(statusUrl).body<ServerStatusResponse>().emailEnabled == true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.d(TAG, "Status check failed: ${e.message}")
            false
        }
    }

    /** The server's enabled sign-in providers; empty on any error, or from a server without them. */
    suspend fun oidcProviders(serverUrl: String): List<OidcPublicProvider> {
        val url = "${serverUrl.trimEnd('/')}/api/auth/oidc/providers"
        return try {
            httpClient.get(url).body<OidcPublicProvidersResponse>().providers
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.d(TAG, "Sign-in providers unavailable: ${e.message}")
            emptyList()
        }
    }

    /** Starts a sign-in the server will send back to the app's scheme rather than to the web. */
    suspend fun oidcStart(serverUrl: String, providerId: String): OidcStartResult {
        val url = "${serverUrl.trimEnd('/')}/api/auth/oidc/$providerId/start"
        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(OidcStartBody(client = OidcClient.app))
            }.body<OidcStartResponse>()
            val authorizationUrl = response.authorizationUrl
            val verifier = response.verifier
            if (response.success && authorizationUrl != null && verifier != null) {
                OidcStartResult.Success(authorizationUrl = authorizationUrl, verifier = verifier)
            } else {
                OidcStartResult.Error(response.error ?: "The sign-in could not be started")
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Sign-in start failed: ${e.message}", e)
            OidcStartResult.Error(e.message ?: "The sign-in could not be started")
        }
    }

    /** Trades the code the browser brought back, with the verifier of its start, for a session. */
    suspend fun oidcExchange(serverUrl: String, code: String, verifier: String): OidcExchangeResult {
        val url = "${serverUrl.trimEnd('/')}/api/auth/oidc/exchange"
        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(OidcExchangeBody(code = code, verifier = verifier))
            }.body<OidcLoginResponse>()
            val username = response.username
            val token = response.token
            if (response.success && username != null && token != null) {
                OidcExchangeResult.Success(username = username, token = token)
            } else {
                OidcExchangeResult.Error(response.error ?: OIDC_NOT_STARTED_MESSAGE)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Sign-in exchange failed: ${e.message}", e)
            OidcExchangeResult.Error(e.message ?: OIDC_NOT_STARTED_MESSAGE)
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
