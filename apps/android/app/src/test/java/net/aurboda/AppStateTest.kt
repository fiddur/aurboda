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
    fun `MainTab has Sync and Account values`() {
        val tabs = MainTab.entries
        assertEquals(2, tabs.size)
        assertTrue(tabs.contains(MainTab.Sync))
        assertTrue(tabs.contains(MainTab.Account))
    }

    @Test
    fun `MainTab ordinal values are correct`() {
        assertEquals(0, MainTab.Sync.ordinal)
        assertEquals(1, MainTab.Account.ordinal)
    }

    @Test
    fun `AppScreen ordinal values are correct`() {
        assertEquals(0, AppScreen.Login.ordinal)
        assertEquals(1, AppScreen.Main.ordinal)
    }

    @Test
    fun `MainTab names are descriptive`() {
        assertEquals("Sync", MainTab.Sync.name)
        assertEquals("Account", MainTab.Account.name)
    }
}
