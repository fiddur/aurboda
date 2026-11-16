package net.aurboda

import android.net.Uri
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Sign-in through an OpenID Connect provider (docs/sso.md, "In the Android app").
 *
 * The provider's page runs in the system browser. The server's callback sends it back to
 * [OIDC_CALLBACK_SCHEME]://[OIDC_CALLBACK_HOST] with `?code=` or `?error=`. Another app could claim
 * the same scheme and see the code, but the code is worthless without the verifier `start`
 * answered with, which only this process holds (in [OidcLogin.pending]).
 */
const val OIDC_CALLBACK_SCHEME = "net.aurboda.oidc"
const val OIDC_CALLBACK_HOST = "callback"

/** As long as the server keeps a sign-in flow open. */
const val OIDC_PENDING_TTL_MS = 10 * 60 * 1000L

const val OIDC_NOT_STARTED_MESSAGE = "The sign-in could not be completed. Try again."
const val OIDC_NO_BROWSER_MESSAGE = "No browser is installed to sign in with."

sealed class OidcCallback {
  data class Code(val code: String) : OidcCallback()

  data class Failure(val error: String) : OidcCallback()
}

fun isOidcCallbackUri(uri: Uri): Boolean = uri.scheme == OIDC_CALLBACK_SCHEME && uri.host == OIDC_CALLBACK_HOST

/** The code or error the server's callback sent back, or null for any other URI or one carrying neither. */
fun parseOidcCallback(uri: Uri): OidcCallback? {
  if (!isOidcCallbackUri(uri)) return null
  uri.getQueryParameter("code")?.takeIf { it.isNotEmpty() }?.let { return OidcCallback.Code(it) }
  uri.getQueryParameter("error")?.takeIf { it.isNotEmpty() }?.let { return OidcCallback.Failure(it) }
  return null
}

/** The web login page's sentences for the same codes (apps/web/src/utils/oidc.ts), except not_linked. */
fun oidcErrorMessage(error: String): String =
  when (error) {
    "already_linked" -> "That sign-in is already linked to another account here."
    "domain_not_allowed" ->
      "That account is not allowed here: its email is not verified, or not in a domain this server accepts."
    "expired" -> "The sign-in took too long or was already used. Please try again."
    "failed" -> OIDC_FAILED_MESSAGE
    "not_linked" ->
      "No Aurboda account is linked to this sign-in. Sign in another way and link it under Settings " +
        "on the web, or create the account on the web."
    "signup_closed" -> "No account is linked to that sign-in, and new accounts cannot be created here right now."
    else -> OIDC_FAILED_MESSAGE
  }

private const val OIDC_FAILED_MESSAGE = "The sign-in did not succeed. Please try again."

data class PendingOidcLogin(
  val serverUrl: String,
  val verifier: String,
  val startedAtMs: Long,
)

/** The one sign-in waiting for the browser to come back. In memory only: gone when the process dies. */
class PendingOidcLoginHolder(
  private val now: () -> Long = { System.currentTimeMillis() },
) {
  private var pending: PendingOidcLogin? = null

  @Synchronized
  fun start(
    serverUrl: String,
    verifier: String,
  ) {
    pending = PendingOidcLogin(serverUrl, verifier, now())
  }

  /** The pending sign-in, cleared as it is read; null when there is none or it is older than [OIDC_PENDING_TTL_MS]. */
  @Synchronized
  fun take(): PendingOidcLogin? {
    val taken = pending ?: return null
    pending = null
    return taken.takeIf { now() - it.startedAtMs <= OIDC_PENDING_TTL_MS }
  }
}

object OidcLogin {
  val pending = PendingOidcLoginHolder()

  private val callbackState = MutableStateFlow<OidcCallback?>(null)

  /** The latest callback from the browser, until the login screen takes it with [consumeCallback]. */
  val callback: StateFlow<OidcCallback?> = callbackState.asStateFlow()

  fun deliver(callback: OidcCallback) {
    callbackState.value = callback
  }

  fun consumeCallback() {
    callbackState.value = null
  }
}
