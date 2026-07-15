package net.aurboda

import org.junit.Test
import org.junit.Assert.*

/**
 * Unit tests for AppState enums and related logic.
 * Note: Full AppState tests with Compose state and Context
 * require instrumented tests (androidTest) or Compose testing libraries.
 */
class AppStateTest {

    @Test
    fun `AppScreen has Login and Main values`() {
        val screens = AppScreen.entries
        assertEquals(2, screens.size)
        assertTrue(screens.contains(AppScreen.Login))
        assertTrue(screens.contains(AppScreen.Main))
    }

    @Test
    fun `MainTab has Home, Add, Feed, Sync and More values`() {
        val tabs = MainTab.entries
        assertEquals(5, tabs.size)
        assertTrue(tabs.contains(MainTab.Home))
        assertTrue(tabs.contains(MainTab.Add))
        assertTrue(tabs.contains(MainTab.Feed))
        assertTrue(tabs.contains(MainTab.Sync))
        assertTrue(tabs.contains(MainTab.More))
    }

    @Test
    fun `MainTab ordinal values are correct`() {
        assertEquals(0, MainTab.Home.ordinal)
        assertEquals(1, MainTab.Add.ordinal)
        assertEquals(2, MainTab.Feed.ordinal)
        assertEquals(3, MainTab.Sync.ordinal)
        assertEquals(4, MainTab.More.ordinal)
    }

    @Test
    fun `AppScreen ordinal values are correct`() {
        assertEquals(0, AppScreen.Login.ordinal)
        assertEquals(1, AppScreen.Main.ordinal)
    }

    @Test
    fun `MainTab names are descriptive`() {
        assertEquals("Home", MainTab.Home.name)
        assertEquals("Add", MainTab.Add.name)
        assertEquals("Feed", MainTab.Feed.name)
        assertEquals("Sync", MainTab.Sync.name)
        assertEquals("More", MainTab.More.name)
    }
}
