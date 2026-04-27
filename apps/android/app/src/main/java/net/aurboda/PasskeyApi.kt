package net.aurboda

import android.content.Context
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialException
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.JsonObject
import net.aurboda.api.models.WebAuthnAuthOptionsResponse
import net.aurboda.api.models.WebAuthnAuthVerifyBody
import net.aurboda.api.models.WebAuthnAuthVerifyResponse

private const val TAG = "PasskeyApi"

sealed class PasskeyLoginResult {
  data class Success(val username: String, val token: String) : PasskeyLoginResult()
  data class Error(val message: String) : PasskeyLoginResult()
}

/**
 * Passkey login via Android's Credential Manager API.
 *
 * The flow:
 *  1. POST /api/webauthn/auth/options → get the WebAuthn request JSON
 *  2. Pass it to CredentialManager.getCredential() so the user can pick a
 *     passkey from the system UI (or 1Password, Google Password Manager, etc.)
 *  3. POST the resulting assertion JSON to /api/webauthn/auth/verify and
 *     receive an Aurboda auth token on success.
 */
class PasskeyApi(
  private val httpClient: HttpClient,
  private val credentialManagerFactory: (Context) -> CredentialManager = { CredentialManager.create(it) },
) {

  suspend fun login(context: Context, serverUrl: String): PasskeyLoginResult {
    val base = serverUrl.trimEnd('/')
    Log.d(TAG, "Passkey login to: $base")
    return try {
      // /auth/options expects an empty body — see schema (always discoverable).
      val optionsResp = httpClient.post("$base/api/webauthn/auth/options") {
        contentType(ContentType.Application.Json)
        setBody(JsonObject(emptyMap()))
      }.body<WebAuthnAuthOptionsResponse>()

      val requestJson = optionsResp.optionsJson

      val credentialManager = credentialManagerFactory(context)
      val getRequest = GetCredentialRequest(
        listOf(GetPublicKeyCredentialOption(requestJson = requestJson)),
      )
      val response = credentialManager.getCredential(context, getRequest)
      val credential = response.credential
      if (credential !is PublicKeyCredential) {
        return PasskeyLoginResult.Error("Unexpected credential type: ${credential.type}")
      }

      val verifyResp = httpClient.post("$base/api/webauthn/auth/verify") {
        contentType(ContentType.Application.Json)
        setBody(WebAuthnAuthVerifyBody(responseJson = credential.authenticationResponseJson))
      }.body<WebAuthnAuthVerifyResponse>()

      val token = verifyResp.token
      val username = verifyResp.username
      if (verifyResp.verified && token != null && username != null) {
        PasskeyLoginResult.Success(username = username, token = token)
      } else {
        PasskeyLoginResult.Error(verifyResp.error ?: "Verification failed")
      }
    } catch (e: GetCredentialException) {
      Log.e(TAG, "Credential Manager error: ${e.message}", e)
      PasskeyLoginResult.Error(e.message ?: "Passkey unavailable")
    } catch (e: Exception) {
      Log.e(TAG, "Passkey login failed: ${e.message}", e)
      PasskeyLoginResult.Error(e.message ?: "Passkey login failed")
    }
  }

  companion object {
    fun create(): PasskeyApi {
      val client = HttpClient(Android) {
        install(ContentNegotiation) {
          json(appJson)
        }
      }
      return PasskeyApi(client)
    }
  }
}
