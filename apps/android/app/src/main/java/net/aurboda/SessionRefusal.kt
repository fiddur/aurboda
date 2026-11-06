package net.aurboda

import android.content.Context
import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.plugins.api.ClientPlugin
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.http.HttpHeaders
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

private const val TAG = "SessionRefusal"
private const val PREFS_NAME = "AurbodaAppPrefs"
private const val SESSION_REFUSED_KEY = "sessionRefused"

fun bearerToken(authorization: String?): String? =
  authorization
    ?.takeIf { it.startsWith("Bearer ") }
    ?.removePrefix("Bearer ")
    ?.takeIf { it.isNotEmpty() }

/**
 * The one place a 401 is acted on: every response to a bearer-authenticated request on a client
 * with this plugin that the server answers 401 hands the refused token to [onRefused].
 */
fun tokenRefusalPlugin(onRefused: (token: String) -> Unit): ClientPlugin<Unit> =
  createClientPlugin("TokenRefusal") {
    onResponse { response ->
      if (classifyHttpStatus(response.status.value) != HttpOutcome.Unauthorized) return@onResponse
      val token = bearerToken(response.call.request.headers[HttpHeaders.Authorization]) ?: return@onResponse
      onRefused(token)
    }
  }

/** Only the stored token being refused logs out: a late answer to a request made with an older token must not. */
fun isStoredTokenRefused(storedToken: String?, refusedToken: String): Boolean = storedToken != null && storedToken == refusedToken

/**
 * Forget the credentials when the server refuses the stored token, and flag it so the UI shows
 * the login screen with [SESSION_REFUSED_MESSAGE] — now if it is running, or on the next open.
 */
fun forgetRefusedToken(context: Context, refusedToken: String) {
  if (!isStoredTokenRefused(CredentialsManager.getCredentials(context)?.authToken, refusedToken)) return
  Log.w(TAG, "Server refused the stored token; clearing credentials")
  CredentialsManager.clearCredentials(context)
  context
    .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    .edit()
    .putBoolean(SESSION_REFUSED_KEY, true)
    .apply()
  (context.applicationContext as? AurbodaApplication)?.sessionRefused?.value = true
}

fun isSessionRefused(context: Context): Boolean =
  context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(SESSION_REFUSED_KEY, false)

fun clearSessionRefused(context: Context) {
  context
    .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    .edit()
    .remove(SESSION_REFUSED_KEY)
    .apply()
  (context.applicationContext as? AurbodaApplication)?.sessionRefused?.value = false
}

fun sessionRefusedFlow(context: Context): StateFlow<Boolean> =
  (context.applicationContext as? AurbodaApplication)?.sessionRefused ?: MutableStateFlow(isSessionRefused(context))

/**
 * The embedded pages get the stored token through the auth bridge and never tell the app when the
 * server refuses it, so the app asks itself: a 401 here reaches [tokenRefusalPlugin] on [httpClient].
 */
suspend fun verifyStoredToken(context: Context, httpClient: HttpClient) {
  val credentials = CredentialsManager.getCredentials(context) ?: return
  try {
    httpClient.get("${credentials.apiUrl}/user/settings") {
      headers { append(HttpHeaders.Authorization, "Bearer ${credentials.authToken}") }
    }
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    Log.d(TAG, "Token check failed: ${e.message}")
  }
}
