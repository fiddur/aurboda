package net.aurboda

import android.content.Context
import java.time.Instant

private const val PREFS_NAME = "AurbodaAppPrefs"
private const val LAST_ATTEMPT_KEY = "bgSyncLastAttemptMs"
private const val LAST_SUCCESS_KEY = "bgSyncLastSuccessMs"
private const val LAST_RESULT_KEY = "bgSyncLastResult"
private const val LAST_ERROR_KEY = "bgSyncLastError"
private const val LAST_DURATION_KEY = "bgSyncLastDurationMs"

enum class BackgroundSyncResult { Success, Retry, Skipped }

data class BackgroundSyncStatus(
  val lastAttempt: Instant? = null,
  val lastSuccess: Instant? = null,
  val lastResult: BackgroundSyncResult? = null,
  val lastError: String? = null,
  val lastDurationMs: Long? = null,
)

fun loadBackgroundSyncStatus(context: Context): BackgroundSyncStatus {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  val attemptMs = prefs.getLong(LAST_ATTEMPT_KEY, 0L).takeIf { it > 0 }
  val successMs = prefs.getLong(LAST_SUCCESS_KEY, 0L).takeIf { it > 0 }
  val resultName = prefs.getString(LAST_RESULT_KEY, null)
  val durationMs = prefs.getLong(LAST_DURATION_KEY, -1L).takeIf { it >= 0 }
  val parsedResult = resultName?.let { runCatching { BackgroundSyncResult.valueOf(it) }.getOrNull() }
  return BackgroundSyncStatus(
    lastAttempt = attemptMs?.let(Instant::ofEpochMilli),
    lastSuccess = successMs?.let(Instant::ofEpochMilli),
    lastResult = parsedResult,
    lastError = prefs.getString(LAST_ERROR_KEY, null),
    lastDurationMs = durationMs,
  )
}

fun recordBackgroundSyncAttempt(context: Context, attemptAt: Instant) {
  context
    .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    .edit()
    .putLong(LAST_ATTEMPT_KEY, attemptAt.toEpochMilli())
    .apply()
  publishStatus(context)
}

fun recordBackgroundSyncResult(
  context: Context,
  result: BackgroundSyncResult,
  finishedAt: Instant,
  durationMs: Long,
  error: String? = null,
) {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  val edit = prefs.edit()
    .putString(LAST_RESULT_KEY, result.name)
    .putLong(LAST_DURATION_KEY, durationMs)
  when (result) {
    BackgroundSyncResult.Success -> edit.putLong(LAST_SUCCESS_KEY, finishedAt.toEpochMilli()).remove(LAST_ERROR_KEY)
    BackgroundSyncResult.Skipped -> edit.remove(LAST_ERROR_KEY)
    BackgroundSyncResult.Retry -> if (error != null) edit.putString(LAST_ERROR_KEY, error) else edit.remove(LAST_ERROR_KEY)
  }
  edit.apply()
  publishStatus(context)
}

private fun publishStatus(context: Context) {
  val app = context.applicationContext as? AurbodaApplication ?: return
  app.backgroundSyncStatus.value = loadBackgroundSyncStatus(context)
}
