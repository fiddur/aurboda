package net.aurboda

import androidx.test.core.app.ApplicationProvider
import net.aurboda.ui.screens.MoreDestination
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Tab/More navigation rules. These exercise [AppState] directly; none of them
 * touch the credential store, so no encrypted prefs are involved.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AppStateNavigationTest {
    private fun appState(
        initialTab: MainTab = MainTab.Home,
        initialMoreDestination: MoreDestination? = null,
    ) = AppState(
        context = ApplicationProvider.getApplicationContext(),
        initialScreen = AppScreen.Main,
        initialTab = initialTab,
        initialMoreDestination = initialMoreDestination,
    )

    @Test
    fun `selecting a tab makes it current`() {
        val state = appState()
        state.selectTab(MainTab.Feed)
        assertEquals(MainTab.Feed, state.currentTab)
    }

    @Test
    fun `More starts on the hub`() {
        assertNull(appState(initialTab = MainTab.More).moreDestination)
    }

    @Test
    fun `opening a More destination leaves the hub`() {
        val state = appState(initialTab = MainTab.More)
        state.openMoreDestination(MoreDestination.Web("/goals"))
        assertEquals(MoreDestination.Web("/goals"), state.moreDestination)
    }

    @Test
    fun `tapping More while already on a More sub-page returns to the hub`() {
        val state = appState(initialTab = MainTab.More)
        state.openMoreDestination(MoreDestination.Web("/goals"))

        state.selectTab(MainTab.More)

        assertEquals(MainTab.More, state.currentTab)
        assertNull(state.moreDestination)
    }

    @Test
    fun `coming back to More from another tab shows the hub`() {
        val state = appState(initialTab = MainTab.More)
        state.openMoreDestination(MoreDestination.Live)

        state.selectTab(MainTab.Home)
        state.selectTab(MainTab.More)

        assertNull(state.moreDestination)
    }

    @Test
    fun `closing a More destination returns to the hub`() {
        val state = appState(initialTab = MainTab.More)
        state.openMoreDestination(MoreDestination.Account)

        state.closeMoreDestination()

        assertNull(state.moreDestination)
    }

    @Test
    fun `a deep link opens More on its destination`() {
        val state = appState(initialTab = MainTab.More, initialMoreDestination = MoreDestination.Web("/goals"))

        assertEquals(MainTab.More, state.currentTab)
        assertEquals(MoreDestination.Web("/goals"), state.moreDestination)
    }

    @Test
    fun `selecting another tab keeps the deep-linked More destination untouched until More is tapped`() {
        val state = appState(initialTab = MainTab.More, initialMoreDestination = MoreDestination.Web("/goals"))

        state.selectTab(MainTab.Home)
        assertEquals(MoreDestination.Web("/goals"), state.moreDestination)

        state.selectTab(MainTab.More)
        assertNull(state.moreDestination)
    }
}
