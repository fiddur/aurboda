package net.aurboda

import java.time.Instant
import java.time.OffsetDateTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Data models + pure decision logic for the home-timeline post notifier
 * (NotificationWorker). Only the fields the notifier needs are declared; the
 * shared `appJson` ignores unknown keys, so the rest of the API payload is fine.
 */

/** One home-timeline post (subset of the backend `TimelineEntry`). */
@Serializable
data class TimelineEntry(
    @SerialName("object_uri") val objectUri: String,
    @SerialName("actor_uri") val actorUri: String,
    val handle: String? = null,
    @SerialName("display_name") val displayName: String? = null,
    val content: String = "",
    @SerialName("published_at") val publishedAt: String,
) {
    /** Best available human name for the notification title. */
    val authorLabel: String get() = displayName ?: handle ?: actorUri
}

/** A page of the home timeline (subset of `TimelineResponse`). */
@Serializable
data class TimelinePage(
    val entries: List<TimelineEntry> = emptyList(),
)

/** A followed actor (subset of `FollowingActor`) — only what the notifier needs. */
@Serializable
data class FollowingActorLite(
    @SerialName("actor_uri") val actorUri: String,
    @SerialName("notify_on_post") val notifyOnPost: Boolean = true,
)

/** The owner's following list (subset of `FollowingResponse`). */
@Serializable
data class FollowingList(
    val following: List<FollowingActorLite> = emptyList(),
)

/** Outcome of a notifier poll: which posts to notify + the new high-water mark. */
data class NotifyDecision(
    /** Posts to raise a notification for, oldest-first. */
    val toNotify: List<TimelineEntry>,
    /** New high-water mark (latest post seen), or the previous one when nothing was seen. */
    val newHighWater: Instant?,
)

/** Lenient ISO-8601 parse (`Z` or an explicit offset), null when unparseable. */
fun parsePublishedAt(value: String): Instant? =
    runCatching { OffsetDateTime.parse(value).toInstant() }.getOrNull()

/**
 * Decide which timeline posts to notify about.
 *
 * Notify a post when it is (a) newer than [highWater], and (b) from an actor in
 * [notifyActorUris] (a followed account with notifications left on). The new
 * high-water mark advances to the latest post seen across the whole page — so a
 * muted or already-seen post never re-triggers.
 *
 * On the first run ([highWater] is null) nothing is notified — we only record the
 * high-water mark, so enabling the feature doesn't dump the whole backlog.
 */
fun decideNotifications(
    entries: List<TimelineEntry>,
    notifyActorUris: Set<String>,
    highWater: Instant?,
): NotifyDecision {
    val dated = entries.mapNotNull { entry -> parsePublishedAt(entry.publishedAt)?.let { entry to it } }
    val maxSeen = dated.maxOfOrNull { it.second }
    val newHighWater = listOfNotNull(highWater, maxSeen).maxOrNull()

    if (highWater == null) {
        return NotifyDecision(toNotify = emptyList(), newHighWater = newHighWater)
    }

    val toNotify = dated
        .filter { (entry, published) -> published.isAfter(highWater) && entry.actorUri in notifyActorUris }
        .sortedBy { it.second }
        .map { it.first }
    return NotifyDecision(toNotify = toNotify, newHighWater = newHighWater)
}

/** Turn sanitised post HTML into a short plain-text snippet for a notification body. */
fun htmlToSnippet(html: String, maxLength: Int = 140): String {
    val text = html
        .replace(Regex("<[^>]+>"), " ")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace(Regex("\\s+"), " ")
        .trim()
    return if (text.length > maxLength) text.take(maxLength - 1).trimEnd() + "…" else text
}
