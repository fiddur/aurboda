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
    fun `MainTab has Home, Sync, Add, Feed, Live and Account values`() {
        val tabs = MainTab.entries
        assertEquals(6, tabs.size)
        assertTrue(tabs.contains(MainTab.Home))
        assertTrue(tabs.contains(MainTab.Sync))
        assertTrue(tabs.contains(MainTab.Add))
        assertTrue(tabs.contains(MainTab.Feed))
        assertTrue(tabs.contains(MainTab.Live))
        assertTrue(tabs.contains(MainTab.Account))
    }

    @Test
    fun `MainTab ordinal values are correct`() {
        assertEquals(0, MainTab.Home.ordinal)
        assertEquals(1, MainTab.Sync.ordinal)
        assertEquals(2, MainTab.Add.ordinal)
        assertEquals(3, MainTab.Feed.ordinal)
        assertEquals(4, MainTab.Live.ordinal)
        assertEquals(5, MainTab.Account.ordinal)
    }

    @Test
    fun `AppScreen ordinal values are correct`() {
        assertEquals(0, AppScreen.Login.ordinal)
        assertEquals(1, AppScreen.Main.ordinal)
    }

    @Test
    fun `MainTab names are descriptive`() {
        assertEquals("Home", MainTab.Home.name)
        assertEquals("Sync", MainTab.Sync.name)
        assertEquals("Add", MainTab.Add.name)
        assertEquals("Feed", MainTab.Feed.name)
        assertEquals("Live", MainTab.Live.name)
        assertEquals("Account", MainTab.Account.name)
    }
}
