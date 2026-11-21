package net.aurboda.ui.screens

import net.aurboda.MoreDestination
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    @Test
    fun `notifications open first`() {
        assertEquals("/notifications", (moreGroups.first().items.first().destination as MoreDestination.Web).path)
    }

    @Test
    fun `strength is in the Training group`() {
        val training = moreGroups.single { it.header == "Training" }
        assertTrue(training.items.any { (it.destination as? MoreDestination.Web)?.path == "/strength" })
    }

    private fun visiblePaths(hiddenPages: List<String>) =
        visibleMoreGroups(moreGroups, hiddenPages).flatMap { it.items }
            .mapNotNull { (it.destination as? MoreDestination.Web)?.path }

    @Test
    fun `nothing hidden keeps every group`() {
        assertEquals(moreGroups, visibleMoreGroups(moreGroups, emptyList()))
    }

    @Test
    fun `a hidden web page leaves the hub`() {
        val paths = visiblePaths(listOf("/meals", "/reminders", "/check-ins", "/people"))
        assertFalse(paths.contains("/meals"))
        assertFalse(paths.contains("/reminders"))
        assertFalse(paths.contains("/check-ins"))
        assertFalse(paths.contains("/people"))
        assertTrue(paths.contains("/reports"))
    }

    @Test
    fun `a group whose entries are all hidden disappears`() {
        val groups = visibleMoreGroups(moreGroups, listOf("/dashboards", "/challenges"))
        assertFalse(groups.any { it.header == "Sharing" })
    }

    @Test
    fun `protected pages, native screens and unknown paths are never hidden`() {
        val groups = visibleMoreGroups(moreGroups, MENU_ALWAYS_SHOWN + listOf("/no-such-page"))
        assertEquals(moreGroups, groups)
        val items = groups.flatMap { it.items }
        assertTrue(items.any { it.destination == MoreDestination.Live })
        assertTrue(items.any { it.destination == MoreDestination.Account })
    }

    @Test
    fun `admin pages are never hidden`() {
        assertFalse(isPageHidden("/admin/users", listOf("/admin/users")))
        assertTrue(isPageHidden("/meals", listOf("/meals")))
    }
}
