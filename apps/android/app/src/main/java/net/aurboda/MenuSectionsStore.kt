package net.aurboda

import android.content.Context

object MenuSectionsStore {
    private const val PREFS_NAME = "MenuSections"
    private const val OPEN_KEY = "open_sections"

    fun load(context: Context): Set<String> =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getStringSet(OPEN_KEY, null)
            ?.toSet()
            ?: emptySet()

    fun save(context: Context, open: Set<String>) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putStringSet(OPEN_KEY, open)
            .apply()
    }
}
