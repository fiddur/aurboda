package net.aurboda.ui

import net.aurboda.ui.screens.embeddedPageUrl
import org.junit.Assert.assertEquals
import org.junit.Test

class EmbeddedPageUrlTest {
    @Test
    fun `site paths resolve against the server URL with the embed flag`() {
        assertEquals("https://aurboda.net/goals?embed=1", embeddedPageUrl("https://aurboda.net", "/goals"))
        assertEquals("https://aurboda.net/goals?embed=1", embeddedPageUrl("https://aurboda.net/", "/goals"))
    }

    @Test
    fun `absolute URLs load as-is with the embed flag`() {
        assertEquals(
            "https://other.example/u/anna/walk?embed=1",
            embeddedPageUrl("https://aurboda.net", "https://other.example/u/anna/walk"),
        )
    }

    @Test
    fun `an existing query string is extended, not doubled`() {
        assertEquals("https://aurboda.net/chart?metric=steps&embed=1", embeddedPageUrl("https://aurboda.net", "/chart?metric=steps"))
    }
}
