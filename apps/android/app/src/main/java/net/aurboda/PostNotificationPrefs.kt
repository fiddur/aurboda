package net.aurboda

import android.content.Context
import java.time.Instant

/**
 * Persistent settings for the home-timeline post notifier: the user's global
 * on/off toggle and the high-water mark (latest post already notified about, ISO
 * string). Stored in the shared app prefs alongside the background-sync flag.
 */
private const val POST_NOTIF_PREFS = "AurbodaAppPrefs"
private const val POST_NOTIF_ENABLED_KEY = "postNotificationsEnabled"
private const val POST_NOTIF_HIGH_WATER_KEY = "postNotificationsHighWater"

private fun postNotifPrefs(context: Context) =
    context.getSharedPreferences(POST_NOTIF_PREFS, Context.MODE_PRIVATE)

fun isPostNotificationsEnabled(context: Context): Boolean =
    postNotifPrefs(context).getBoolean(POST_NOTIF_ENABLED_KEY, false)

fun setPostNotificationsEnabled(context: Context, enabled: Boolean) {
    postNotifPrefs(context).edit().putBoolean(POST_NOTIF_ENABLED_KEY, enabled).apply()
}

/** Latest post already notified about, or null if the notifier hasn't run yet. */
fun getNotifyHighWater(context: Context): Instant? {
    val raw = postNotifPrefs(context).getString(POST_NOTIF_HIGH_WATER_KEY, null) ?: return null
    return runCatching { Instant.parse(raw) }.getOrNull()
}

fun setNotifyHighWater(context: Context, highWater: Instant) {
    postNotifPrefs(context).edit().putString(POST_NOTIF_HIGH_WATER_KEY, highWater.toString()).apply()
}
