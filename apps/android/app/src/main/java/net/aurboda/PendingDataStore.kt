package net.aurboda

import android.content.Context
import android.util.Log
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
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
    val data: JsonObject? = null,
    val people: List<String>? = null,
    val comment: String? = null,
    val created_activity_id: String? = null,
)

@Serializable
data class PendingMetricPayload(
    val metric: String,
    val value: Double,
    val time: String,
    val unit: String? = null,
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
    val fail_count: Int = 0,
    val last_error: String? = null,
    /** The server refused the entry itself (see [isPermanentRefusal]): a sync no longer sends it until it is edited. */
    val refused: Boolean = false,
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

fun updatePendingEntry(context: Context, updated: PendingEntry) {
    val entries = getPendingEntries(context).map { if (it.id == updated.id) updated else it }
    savePendingEntries(context, entries)
    Log.d(TAG, "Updated pending entry ${updated.id}")
}

fun PendingEntry.withCreatedActivityId(activityId: String): PendingEntry =
    when (val payload = data) {
        is PendingPayload.Activity ->
            copy(data = PendingPayload.Activity(payload.payload.copy(created_activity_id = activityId)))
        is PendingPayload.Metric -> this
    }

/** Kept before the comment is posted, so a retry after any failure posts only the comment. */
fun recordCreatedActivity(context: Context, id: String, activityId: String) {
    val entry = getPendingEntries(context).find { it.id == id } ?: return
    updatePendingEntry(context, entry.withCreatedActivityId(activityId))
}

/**
 * A failed attempt without a status (offline) says nothing about the entry, so one the server
 * refused before keeps that verdict and its reason.
 */
fun PendingEntry.failedWith(error: String, statusCode: Int?): PendingEntry =
    if (refused && statusCode == null) {
        copy(fail_count = fail_count + 1)
    } else {
        copy(fail_count = fail_count + 1, last_error = error, refused = isPermanentRefusal(statusCode))
    }

fun markPendingEntryFailed(context: Context, id: String, error: String, statusCode: Int? = null) {
    val entries = getPendingEntries(context).map { if (it.id == id) it.failedWith(error, statusCode) else it }
    savePendingEntries(context, entries)
    Log.d(TAG, "Marked pending entry $id as failed (error: $error, status: $statusCode)")
}

fun pendingEntryCount(context: Context): Int = getPendingEntries(context).size

/** The entries a sync sends, and how many it leaves for the user because the server refused them. */
data class PendingQueue(val toSend: List<PendingEntry>, val refused: Int)

fun pendingQueueOf(entries: List<PendingEntry>): PendingQueue {
    val (refused, toSend) = entries.partition { it.refused }
    return PendingQueue(toSend = toSend, refused = refused.size)
}

/** The pending-data stage's message when a sync has nothing to send. */
fun idlePendingDataMessage(refused: Int): String =
    when (refused) {
        0 -> "No queued entries"
        1 -> "1 entry needs attention"
        else -> "$refused entries need attention"
    }

private fun savePendingEntries(context: Context, entries: List<PendingEntry>) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(ENTRIES_KEY, appJson.encodeToString(entries)).apply()
}

/** Which cached "in use" lists a flush of `sent` made stale, judged as the Add tab does when online. */
data class CatalogAdoptions(val activityTypes: Boolean, val metrics: Boolean)

fun catalogAdoptions(
    sent: List<PendingPayload>,
    activityTypes: List<ActivityTypeDefinition>,
    activityTypeCatalog: List<CatalogActivityType>,
    metricCatalog: List<CatalogMetric>,
): CatalogAdoptions = CatalogAdoptions(
    activityTypes = sent.filterIsInstance<PendingPayload.Activity>().any { entry ->
        val type = entry.payload.activity_type
        activityTypes.none { it.name == type } && activityTypeCatalog.any { it.name == type }
    },
    metrics = sent.filterIsInstance<PendingPayload.Metric>().any { entry ->
        metricCatalog.find { it.name == entry.payload.metric }?.inUse == false
    },
)
