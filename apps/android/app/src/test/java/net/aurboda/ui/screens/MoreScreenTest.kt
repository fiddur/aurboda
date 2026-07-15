package net.aurboda.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MoreScreenTest {

    private val allItems = moreGroups.flatMap { it.items }
    private val webPaths = allItems.mapNotNull { (it.destination as? MoreDestination.Web)?.path }

    @Test
    fun `every web path is absolute and non-empty`() {
        assertTrue(webPaths.isNotEmpty())
        webPaths.forEach { path ->
            assertTrue("path should start with '/': $path", path.startsWith("/"))
            assertTrue("path should have a segment: $path", path.length > 1)
        }
    }

    @Test
    fun `web paths are unique`() {
        assertEquals(webPaths.size, webPaths.toSet().size)
    }

    @Test
    fun `item labels are unique`() {
        val labels = allItems.map { it.label }
        assertEquals(labels.size, labels.toSet().size)
    }

    @Test
    fun `native Live and Account destinations are present exactly once`() {
        assertEquals(1, allItems.count { it.destination == MoreDestination.Live })
        assertEquals(1, allItems.count { it.destination == MoreDestination.Account })
    }
}
