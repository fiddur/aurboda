package net.aurboda.ui.screens

import net.aurboda.MainTab
import org.junit.Assert.assertEquals
import org.junit.Test

class MainScreenTest {

    @Test
    fun `every tab shows when nothing is hidden`() {
        assertEquals(MainTab.entries.toList(), visibleMainTabs(emptyList()))
    }

    @Test
    fun `hiding a tab's web page leaves it off the bar`() {
        assertEquals(
            listOf(MainTab.Home, MainTab.Sync, MainTab.More),
            visibleMainTabs(listOf("/add", "/feed")),
        )
    }

    @Test
    fun `Home and the native tabs always stay`() {
        assertEquals(MainTab.entries.toList(), visibleMainTabs(listOf("/", "/settings", "/data-sources")))
    }

    @Test
    fun `each embedded tab maps to its web page`() {
        assertEquals("/", tabWebPath(MainTab.Home))
        assertEquals("/add", tabWebPath(MainTab.Add))
        assertEquals("/feed", tabWebPath(MainTab.Feed))
        assertEquals(null, tabWebPath(MainTab.Sync))
        assertEquals(null, tabWebPath(MainTab.More))
    }

    @Test
    fun `a menu path that is a bottom tab maps to that tab`() {
        assertEquals(MainTab.Feed, mainTabForPath("/feed"))
        assertEquals(null, mainTabForPath("/journal"))
    }
}
