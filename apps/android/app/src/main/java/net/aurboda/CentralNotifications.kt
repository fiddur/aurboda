package net.aurboda

import java.time.Instant
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A button on a server notification (subset of `NotificationAction`). */
@Serializable
data class ServerNotificationAction(
    val key: String,
    val label: String,
)

/** One notification from `GET /notifications` (subset of `Notification`). */
@Serializable
data class ServerNotification(
    val id: String,
    val type: String,
    val title: String,
    val body: String? = null,
    val link: String? = null,
    @SerialName("created_at") val createdAt: String,
    val actions: List<ServerNotificationAction> = emptyList(),
)

/** A page of `GET /notifications` (subset of `NotificationsResponse`). */
@Serializable
data class ServerNotificationsPage(
    val notifications: List<ServerNotification> = emptyList(),
    @SerialName("unread_count") val unreadCount: Int = 0,
)

/** One row of `GET /notifications/types` (subset of `NotificationTypeSetting`). */
@Serializable
data class NotificationTypeLite(
    val type: String,
    val group: String? = null,
    @SerialName("group_label") val groupLabel: String? = null,
    val push: Boolean = false,
    @SerialName("in_app") val inApp: Boolean = false,
)

/** `GET /notifications/types` (subset of `NotificationTypesResponse`). */
@Serializable
data class NotificationTypesList(
    val types: List<NotificationTypeLite> = emptyList(),
)

data class CentralDecision(
    /** Notifications to show, oldest first. */
    val toNotify: List<ServerNotification>,
    val newHighWater: Instant?,
)

/**
 * The first run ([highWater] null) shows nothing and only records a mark. The query it answers
 * returns every unread push notification, so an empty first answer means anything later is new:
 * the mark then becomes [Instant.EPOCH] rather than staying unset.
 */
fun decideCentralNotifications(notifications: List<ServerNotification>, highWater: Instant?): CentralDecision {
    val dated = notifications.mapNotNull { n -> parsePublishedAt(n.createdAt)?.let { n to it } }
    val maxSeen = dated.maxOfOrNull { it.second }
    if (highWater == null) {
        return CentralDecision(toNotify = emptyList(), newHighWater = maxSeen ?: Instant.EPOCH)
    }
    val toNotify = dated
        .filter { (_, createdAt) -> createdAt.isAfter(highWater) }
        .sortedBy { it.second }
        .map { it.first }
    return CentralDecision(toNotify = toNotify, newHighWater = listOfNotNull(highWater, maxSeen).maxOrNull())
}

/** The legacy post high-water seeds the first central poll, so posts since the last legacy run are not swallowed. */
fun initialCentralHighWater(central: Instant?, legacy: Instant?): Instant? = central ?: legacy

data class DeepLinkTarget(val tab: String, val morePath: String?)

fun notificationTapTarget(link: String?): DeepLinkTarget {
    if (link == null) return DeepLinkTarget(MainActivity.TAB_MORE, "/notifications")
    if (link == "/feed" || link.startsWith("/feed?") || link.startsWith("/feed#")) {
        return DeepLinkTarget(MainActivity.TAB_FEED, null)
    }
    if (link.startsWith("/") && !link.startsWith("//")) return DeepLinkTarget(MainActivity.TAB_MORE, link)
    return DeepLinkTarget(MainActivity.TAB_MORE, "/notifications")
}

data class ChannelSpec(val id: String, val name: String)

val OTHER_NOTIFICATION_CHANNEL = ChannelSpec("notifications_other", "Other")

fun notificationChannelFor(type: String, types: List<NotificationTypeLite>): ChannelSpec {
    val match = types.firstOrNull { it.type == type } ?: return OTHER_NOTIFICATION_CHANNEL
    val group = match.group ?: return OTHER_NOTIFICATION_CHANNEL
    return ChannelSpec("notifications_$group", match.groupLabel ?: group)
}

fun androidNotificationId(serverId: String): Int = serverId.hashCode()

private val UUID_PATTERN = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
private val ACTION_KEY_PATTERN = Regex("^[a-z0-9_]{1,64}$")

fun isValidNotificationId(id: String?): Boolean = id != null && UUID_PATTERN.matches(id)

fun isValidActionKey(key: String?): Boolean = key != null && ACTION_KEY_PATTERN.matches(key)

fun badgeText(count: Int): String = if (count > 9) "9+" else count.toString()
