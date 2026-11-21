package net.aurboda.ui.screens

import net.aurboda.MoreDestination
import net.aurboda.api.menu.menuAlwaysShown
import net.aurboda.api.menu.navSections
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MoreScreenTest {

    private fun MoreMenu.items(): List<MoreItem> = top + sections.flatMap { it.items } + bottom

    private val allItems = moreMenu.items()
    private val webPaths = allItems.mapNotNull { (it.destination as? MoreDestination.Web)?.path }

    private fun MoreItem.path(): String? = (destination as? MoreDestination.Web)?.path

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
        assertEquals("/notifications", moreMenu.top.first().path())
    }

    @Test
    fun `the sections are the web menu's without admin-only links`() {
        assertEquals(navSections.map { it.id }, moreMenu.sections.map { it.id })
        assertEquals(navSections.map { it.label }, moreMenu.sections.map { it.label })
        assertEquals(navSections.map { it.icon }, moreMenu.sections.map { it.icon })
        navSections.zip(moreMenu.sections).forEach { (web, app) ->
            val links = web.links.filterNot { it.adminOnly }
            assertEquals(links.map { it.href }, app.items.map { it.path() })
            assertEquals(links.map { it.label }, app.items.map { it.label })
        }
    }

    @Test
    fun `no section holds an admin-only link`() {
        assertFalse(webPaths.contains("/admin"))
        val adminHrefs = navSections.flatMap { s -> s.links.filter { it.adminOnly }.map { it.href } }
        assertTrue(adminHrefs.isNotEmpty())
        adminHrefs.forEach { assertFalse(webPaths.contains(it)) }
    }

    @Test
    fun `Help and Settings open the bottom, before the app-only entries`() {
        val bottomPaths = moreMenu.bottom.map { it.path() }
        assertEquals(listOf("/help", "/settings"), bottomPaths.take(2))
        assertTrue(bottomPaths.indexOf("/settings") < bottomPaths.indexOf("/audit-log"))
    }

    @Test
    fun `strength is in the Training section`() {
        val training = moreMenu.sections.single { it.label == "Training" }
        assertTrue(training.items.any { it.path() == "/strength" })
    }

    @Test
    fun `feed is in the Sharing section`() {
        val sharing = moreMenu.sections.single { it.id == "sharing" }
        assertTrue(sharing.items.any { it.path() == "/feed" })
    }

    private fun visiblePaths(hiddenPages: List<String>) =
        visibleMoreMenu(moreMenu, hiddenPages).items().mapNotNull { it.path() }

    @Test
    fun `nothing hidden keeps the whole menu`() {
        assertEquals(moreMenu, visibleMoreMenu(moreMenu, emptyList()))
    }

    @Test
    fun `a hidden web page leaves the hub`() {
        val paths = visiblePaths(listOf("/meals", "/reminders", "/check-ins", "/people", "/audit-log"))
        assertFalse(paths.contains("/meals"))
        assertFalse(paths.contains("/reminders"))
        assertFalse(paths.contains("/check-ins"))
        assertFalse(paths.contains("/people"))
        assertFalse(paths.contains("/audit-log"))
        assertTrue(paths.contains("/reports"))
    }

    @Test
    fun `a section whose entries are all hidden disappears`() {
        val menu = visibleMoreMenu(moreMenu, listOf("/feed", "/dashboards", "/challenges"))
        assertFalse(menu.sections.any { it.id == "sharing" })
    }

    @Test
    fun `protected pages, native screens and unknown paths are never hidden`() {
        val menu = visibleMoreMenu(moreMenu, menuAlwaysShown + listOf("/no-such-page"))
        assertEquals(moreMenu, menu)
        val items = menu.items()
        assertTrue(items.any { it.destination == MoreDestination.Live })
        assertTrue(items.any { it.destination == MoreDestination.Account })
    }

    @Test
    fun `admin pages are never hidden`() {
        assertFalse(isPageHidden("/admin/users", listOf("/admin/users")))
        assertTrue(isPageHidden("/meals", listOf("/meals")))
    }
}
