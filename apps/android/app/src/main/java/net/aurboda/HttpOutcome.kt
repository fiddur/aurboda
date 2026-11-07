package net.aurboda

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** What a server answer means for the sync run that got it. */
enum class HttpOutcome { Ok, Unauthorized, ReadOnly, Retryable, Failed }

fun classifyHttpStatus(status: Int): HttpOutcome =
  when {
    status in 200..299 -> HttpOutcome.Ok
    status == 401 -> HttpOutcome.Unauthorized
    status == 402 -> HttpOutcome.ReadOnly
    status >= 500 || status == 408 || status == 429 -> HttpOutcome.Retryable
    else -> HttpOutcome.Failed
  }

const val SESSION_REFUSED_MESSAGE = "Your session is no longer valid. Please log in again."

const val READ_ONLY_FALLBACK_MESSAGE = "This account is read-only until the plan is renewed"

/**
 * Why a sync run ended early. A refused token or a read-only account ends the whole run rather
 * than one step: every later request would get the same answer, so retrying only spins.
 */
data class SyncStop(
  val outcome: HttpOutcome,
  val message: String,
)

/** [serverMessage] is the server's explanation of a 402, see [readOnlyMessage]. */
fun syncStopOf(status: Int?, serverMessage: String? = null): SyncStop? =
  when (status?.let(::classifyHttpStatus)) {
    HttpOutcome.Unauthorized -> SyncStop(HttpOutcome.Unauthorized, SESSION_REFUSED_MESSAGE)
    HttpOutcome.ReadOnly -> SyncStop(HttpOutcome.ReadOnly, serverMessage ?: READ_ONLY_FALLBACK_MESSAGE)
    else -> null
  }

/**
 * Whether a queued entry's failed upload counts against it. A read-only refusal says nothing
 * about the entry, and every run until the plan is renewed would add another failure.
 */
fun countsAsEntryFailure(stop: SyncStop?): Boolean = stop?.outcome != HttpOutcome.ReadOnly

/** The `error` of a 402 body (`{ success: false, error, payment_url }`), or a fallback when it has none. */
fun readOnlyMessage(body: String?): String =
  body
    ?.let { runCatching { appJson.parseToJsonElement(it) as? JsonObject }.getOrNull() }
    ?.get("error")
    ?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }
    ?.takeIf { it.isNotBlank() }
    ?: READ_ONLY_FALLBACK_MESSAGE
