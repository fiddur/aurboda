package net.aurboda.widget

import android.content.Context

private const val PREFS_NAME = "challenge_widget"

/** Which challenge one widget instance shows. [name] is a cached label for the loading/error states. */
data class ChallengeWidgetConfig(val url: String, val name: String)

fun saveChallengeWidgetConfig(context: Context, appWidgetId: Int, config: ChallengeWidgetConfig) {
    context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString("url_$appWidgetId", config.url)
        .putString("name_$appWidgetId", config.name)
        .apply()
}

fun loadChallengeWidgetConfig(context: Context, appWidgetId: Int): ChallengeWidgetConfig? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val url = prefs.getString("url_$appWidgetId", null) ?: return null
    return ChallengeWidgetConfig(url = url, name = prefs.getString("name_$appWidgetId", null) ?: "")
}

fun clearChallengeWidgetConfig(context: Context, appWidgetIds: IntArray) {
    val editor = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    for (id in appWidgetIds) editor.remove("url_$id").remove("name_$id")
    editor.apply()
}
