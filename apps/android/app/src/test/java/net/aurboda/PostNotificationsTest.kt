package net.aurboda

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PostNotificationsTest {

    private fun entry(objectUri: String, actorUri: String, published: String) =
        TimelineEntry(objectUri = objectUri, actorUri = actorUri, publishedAt = published)

    private val alice = "https://mastodon.example/users/alice"
    private val bob = "https://mastodon.example/users/bob"

    @Test
    fun `first run notifies nothing but records the high-water mark`() {
        val entries = listOf(
            entry("p1", alice, "2026-07-15T10:00:00Z"),
            entry("p2", bob, "2026-07-15T11:00:00Z"),
        )
        val decision = decideNotifications(entries, notifyActorUris = setOf(alice, bob), highWater = null)

        assertTrue(decision.toNotify.isEmpty())
        assertEquals(Instant.parse("2026-07-15T11:00:00Z"), decision.newHighWater)
    }

    @Test
    fun `notifies only posts newer than high-water from notify-on actors`() {
        val hw = Instant.parse("2026-07-15T10:00:00Z")
        val entries = listOf(
            entry("old", alice, "2026-07-15T09:00:00Z"), // older than hw → skip
            entry("new-alice", alice, "2026-07-15T10:30:00Z"), // notify
            entry("new-bob", bob, "2026-07-15T11:00:00Z"), // bob muted → skip
        )
        val decision = decideNotifications(entries, notifyActorUris = setOf(alice), highWater = hw)

        assertEquals(listOf("new-alice"), decision.toNotify.map { it.objectUri })
        assertEquals(Instant.parse("2026-07-15T11:00:00Z"), decision.newHighWater)
    }

    @Test
    fun `toNotify is ordered oldest-first`() {
        val hw = Instant.parse("2026-07-15T00:00:00Z")
        val entries = listOf(
            entry("c", alice, "2026-07-15T12:00:00Z"),
            entry("a", alice, "2026-07-15T08:00:00Z"),
            entry("b", alice, "2026-07-15T10:00:00Z"),
        )
        val decision = decideNotifications(entries, notifyActorUris = setOf(alice), highWater = hw)
        assertEquals(listOf("a", "b", "c"), decision.toNotify.map { it.objectUri })
    }

    @Test
    fun `high-water never moves backwards when the page is empty`() {
        val hw = Instant.parse("2026-07-15T10:00:00Z")
        val decision = decideNotifications(emptyList(), notifyActorUris = setOf(alice), highWater = hw)
        assertTrue(decision.toNotify.isEmpty())
        assertEquals(hw, decision.newHighWater)
    }

    @Test
    fun `empty first run leaves high-water null`() {
        val decision = decideNotifications(emptyList(), notifyActorUris = emptySet(), highWater = null)
        assertNull(decision.newHighWater)
    }

    @Test
    fun `unparseable timestamps are ignored`() {
        val hw = Instant.parse("2026-07-15T10:00:00Z")
        val entries = listOf(
            entry("bad", alice, "not-a-date"),
            entry("good", alice, "2026-07-15T11:00:00Z"),
        )
        val decision = decideNotifications(entries, notifyActorUris = setOf(alice), highWater = hw)
        assertEquals(listOf("good"), decision.toNotify.map { it.objectUri })
        assertEquals(Instant.parse("2026-07-15T11:00:00Z"), decision.newHighWater)
    }

    @Test
    fun `htmlToSnippet strips tags, unescapes entities, and truncates`() {
        assertEquals("Hello world", htmlToSnippet("<p>Hello <b>world</b></p>"))
        assertEquals("a & b < c", htmlToSnippet("a &amp; b &lt; c"))
        val long = htmlToSnippet("<p>${"x".repeat(200)}</p>", maxLength = 10)
        assertTrue(long.endsWith("…"))
        assertEquals(10, long.length)
    }
}
