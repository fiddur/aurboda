package net.aurboda

import android.content.Context
import android.util.Log
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.util.UUID

private const val TAG = "PendingDataStore"
private const val PREFS_NAME = "PendingDataStore"
private const val ENTRIES_KEY = "pending_entries"

@Serializable
data class PendingActivityPayload(
    val activity_type: String,
    val start_time: String,
    val end_time: String? = null,
    val title: String? = null,
    val notes: String? = null,
)

@Serializable
data class PendingMetricPayload(
    val metric: String,
    val value: Double,
    val time: String,
)

@Serializable
sealed class PendingPayload {
    @Serializable
    @kotlinx.serialization.SerialName("activity")
    data class Activity(val payload: PendingActivityPayload) : PendingPayload()

    @Serializable
    @kotlinx.serialization.SerialName("metric")
    data class Metric(val payload: PendingMetricPayload) : PendingPayload()
}

@Serializable
data class PendingEntry(
    val id: String = UUID.randomUUID().toString(),
    val data: PendingPayload,
    val created_at: String,
)

fun addPendingEntry(context: Context, entry: PendingEntry) {
    val entries = getPendingEntries(context).toMutableList()
    entries.add(entry)
    savePendingEntries(context, entries)
    Log.d(TAG, "Added pending entry ${entry.id}, total: ${entries.size}")
}

fun getPendingEntries(context: Context): List<PendingEntry> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val json = prefs.getString(ENTRIES_KEY, null) ?: return emptyList()
    return try {
        appJson.decodeFromString<List<PendingEntry>>(json)
    } catch (e: Exception) {
        Log.e(TAG, "Failed to decode pending entries", e)
        emptyList()
    }
}

fun removePendingEntry(context: Context, id: String) {
    val entries = getPendingEntries(context).filter { it.id != id }
    savePendingEntries(context, entries)
    Log.d(TAG, "Removed pending entry $id, remaining: ${entries.size}")
}

fun pendingEntryCount(context: Context): Int = getPendingEntries(context).size

private fun savePendingEntries(context: Context, entries: List<PendingEntry>) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(ENTRIES_KEY, appJson.encodeToString(entries)).apply()
}
