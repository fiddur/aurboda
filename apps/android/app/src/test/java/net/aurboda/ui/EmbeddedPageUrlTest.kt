package net.aurboda.ui

import net.aurboda.ui.screens.embeddedPageUrl
import org.junit.Assert.assertEquals
import org.junit.Test

class EmbeddedPageUrlTest {
    @Test
    fun `site paths resolve against the server URL with the embed flag`() {
        assertEquals("https://aurboda.net/goals?embed=1", embeddedPageUrl("https://aurboda.net", "/goals", "github"))
        assertEquals("https://aurboda.net/goals?embed=1", embeddedPageUrl("https://aurboda.net/", "/goals", "github"))
    }

    @Test
    fun `absolute URLs load as-is with the embed flag`() {
        assertEquals(
            "https://other.example/u/anna/walk?embed=1",
            embeddedPageUrl("https://aurboda.net", "https://other.example/u/anna/walk", "github"),
        )
    }

    @Test
    fun `an existing query string is extended, not doubled`() {
        assertEquals("https://aurboda.net/chart?metric=steps&embed=1", embeddedPageUrl("https://aurboda.net", "/chart?metric=steps", "github"))
    }

    @Test
    fun `the embed flag goes before a fragment`() {
        assertEquals(
            "https://aurboda.net/settings?embed=1#notifications",
            embeddedPageUrl("https://aurboda.net", "/settings#notifications", "github"),
        )
        assertEquals(
            "https://aurboda.net/chart?metric=steps&embed=1#top",
            embeddedPageUrl("https://aurboda.net", "/chart?metric=steps#top", "github"),
        )
    }

    @Test
    fun `the Play build adds the store flag, the other channels do not`() {
        assertEquals("https://aurboda.net/settings?embed=1&store=play", embeddedPageUrl("https://aurboda.net", "/settings", "play"))
        assertEquals(
            "https://aurboda.net/chart?metric=steps&embed=1&store=play#top",
            embeddedPageUrl("https://aurboda.net", "/chart?metric=steps#top", "play"),
        )
        assertEquals("https://aurboda.net/?embed=1", embeddedPageUrl("https://aurboda.net", "/", "github"))
        assertEquals("https://aurboda.net/?embed=1", embeddedPageUrl("https://aurboda.net", "/", "fdroid"))
    }
}
