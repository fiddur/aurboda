package net.aurboda

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CentralNotificationsTest {

    private fun notification(id: String, createdAt: String, link: String? = null) =
        ServerNotification(id = id, type = "feed_reply", title = "Title $id", link = link, createdAt = createdAt)

    @Test
    fun `first run notifies nothing and records the newest created_at`() {
        val decision = decideCentralNotifications(
            listOf(
                notification("a", "2026-11-13T10:00:00Z"),
                notification("b", "2026-11-13T11:00:00Z"),
            ),
            highWater = null,
        )
        assertTrue(decision.toNotify.isEmpty())
        assertEquals(Instant.parse("2026-11-13T11:00:00Z"), decision.newHighWater)
    }

    @Test
    fun `first run with an empty answer sets the mark to the epoch`() {
        val decision = decideCentralNotifications(emptyList(), highWater = null)
        assertTrue(decision.toNotify.isEmpty())
        assertEquals(Instant.EPOCH, decision.newHighWater)
    }

    @Test
    fun `notifies only those strictly after the mark, oldest first, and moves the mark`() {
        val mark = Instant.parse("2026-11-13T10:00:00Z")
        val decision = decideCentralNotifications(
            listOf(
                notification("late", "2026-11-13T12:00:00Z"),
                notification("same", "2026-11-13T10:00:00Z"),
                notification("early", "2026-11-13T09:00:00Z"),
                notification("mid", "2026-11-13T11:00:00+00:00"),
            ),
            highWater = mark,
        )
        assertEquals(listOf("mid", "late"), decision.toNotify.map { it.id })
        assertEquals(Instant.parse("2026-11-13T12:00:00Z"), decision.newHighWater)
    }

    @Test
    fun `nothing new keeps the mark`() {
        val mark = Instant.parse("2026-11-13T10:00:00Z")
        val decision = decideCentralNotifications(listOf(notification("old", "2026-11-13T09:00:00Z")), mark)
        assertTrue(decision.toNotify.isEmpty())
        assertEquals(mark, decision.newHighWater)
    }

    @Test
    fun `unparseable created_at is skipped`() {
        val mark = Instant.parse("2026-11-13T10:00:00Z")
        val decision = decideCentralNotifications(
            listOf(notification("bad", "yesterday"), notification("good", "2026-11-13T11:00:00Z")),
            mark,
        )
        assertEquals(listOf("good"), decision.toNotify.map { it.id })
        assertEquals(Instant.parse("2026-11-13T11:00:00Z"), decision.newHighWater)
    }

    @Test
    fun `initial high-water prefers the central mark, then the legacy one`() {
        val central = Instant.parse("2026-11-13T10:00:00Z")
        val legacy = Instant.parse("2026-11-12T10:00:00Z")
        assertEquals(central, initialCentralHighWater(central, legacy))
        assertEquals(legacy, initialCentralHighWater(null, legacy))
        assertNull(initialCentralHighWater(null, null))
    }

    @Test
    fun `feed links open the Feed tab`() {
        assertEquals(DeepLinkTarget(MainActivity.TAB_FEED, null), notificationTapTarget("/feed"))
        assertEquals(DeepLinkTarget(MainActivity.TAB_FEED, null), notificationTapTarget("/feed?post=1"))
        assertEquals(DeepLinkTarget(MainActivity.TAB_FEED, null), notificationTapTarget("/feed#top"))
    }

    @Test
    fun `other site paths open in the More tab`() {
        assertEquals(DeepLinkTarget(MainActivity.TAB_MORE, "/feedback"), notificationTapTarget("/feedback"))
        assertEquals(DeepLinkTarget(MainActivity.TAB_MORE, "/settings#notifications"), notificationTapTarget("/settings#notifications"))
    }

    @Test
    fun `missing or foreign links open the notifications page`() {
        val fallback = DeepLinkTarget(MainActivity.TAB_MORE, "/notifications")
        assertEquals(fallback, notificationTapTarget(null))
        assertEquals(fallback, notificationTapTarget("https://evil.example/x"))
        assertEquals(fallback, notificationTapTarget("//evil.example/x"))
        assertEquals(fallback, notificationTapTarget(""))
    }

    @Test
    fun `a type's group picks its channel`() {
        val types = listOf(NotificationTypeLite(type = "feed_reply", group = "feed", groupLabel = "Feed", push = true))
        assertEquals(ChannelSpec("notifications_feed", "Feed"), notificationChannelFor("feed_reply", types))
    }

    @Test
    fun `unknown types and types without a group go to Other`() {
        val types = listOf(NotificationTypeLite(type = "feed_reply"))
        val other = ChannelSpec("notifications_other", "Other")
        assertEquals(other, notificationChannelFor("feed_reply", types))
        assertEquals(other, notificationChannelFor("brand_new_type", types))
        assertEquals(other, notificationChannelFor("feed_reply", emptyList()))
    }

    @Test
    fun `android notification id is stable per server id`() {
        val id = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
        assertEquals(id.hashCode(), androidNotificationId(id))
        assertEquals(androidNotificationId(id), androidNotificationId(id))
    }

    @Test
    fun `ids and action keys are validated before use in a URL`() {
        assertTrue(isValidNotificationId("1b4e28ba-2fa1-11d2-883f-0016d3cca427"))
        assertFalse(isValidNotificationId("../../admin"))
        assertFalse(isValidNotificationId(null))
        assertTrue(isValidActionKey("cancel_share"))
        assertFalse(isValidActionKey("Cancel"))
        assertFalse(isValidActionKey("a/b"))
        assertFalse(isValidActionKey(""))
        assertFalse(isValidActionKey(null))
    }

    @Test
    fun `badge text caps at nine`() {
        assertEquals("1", badgeText(1))
        assertEquals("9", badgeText(9))
        assertEquals("9+", badgeText(10))
    }

    @Test
    fun `decodes a page with actions`() {
        val page = appJson.decodeFromString<ServerNotificationsPage>(
            """{"success":true,"notifications":[{"id":"n1","type":"autoshare_pending","title":"Sharing soon",
               "body":null,"link":"/feed","created_at":"2026-11-13T10:00:00.000Z","data":{"x":1},"in_app":true,
               "push":true,"read_at":null,"actions":[{"key":"cancel","label":"Don't share"}]}],
               "next_cursor":null,"unread_count":3}""",
        )
        assertEquals(3, page.unreadCount)
        val n = page.notifications.single()
        assertNull(n.body)
        assertEquals("/feed", n.link)
        assertEquals(listOf(ServerNotificationAction("cancel", "Don't share")), n.actions)
    }

    @Test
    fun `decodes a page without actions and with an unknown type`() {
        val page = appJson.decodeFromString<ServerNotificationsPage>(
            """{"notifications":[{"id":"n1","type":"something_new","title":"Hi","created_at":"2026-11-13T10:00:00Z"}],
               "unread_count":0}""",
        )
        val n = page.notifications.single()
        assertEquals("something_new", n.type)
        assertTrue(n.actions.isEmpty())
    }

    @Test
    fun `decodes a types list with and without group`() {
        val withGroup = appJson.decodeFromString<NotificationTypesList>(
            """{"types":[{"type":"feed_reply","group":"feed","group_label":"Feed","push":true,"in_app":true,
               "label":"Replies","description":"x","admin_only":false}]}""",
        )
        assertEquals("feed", withGroup.types.single().group)
        assertEquals("Feed", withGroup.types.single().groupLabel)
        assertTrue(withGroup.types.single().push)

        val withoutGroup = appJson.decodeFromString<NotificationTypesList>(
            """{"types":[{"type":"feed_reply","push":false,"in_app":true}]}""",
        )
        assertNull(withoutGroup.types.single().group)
        assertNull(withoutGroup.types.single().groupLabel)
    }
}
