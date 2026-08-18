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

    @Test
    fun `a deep link arriving while running navigates to its More page`() {
        val state = appState(initialTab = MainTab.Home)

        state.open(DeepLink(MainTab.More, "/u/fiddur/august-steppers"))

        assertEquals(MainTab.More, state.currentTab)
        assertEquals(MoreDestination.Web("/u/fiddur/august-steppers"), state.moreDestination)
    }

    @Test
    fun `a running deep link replaces the More sub-page already showing`() {
        val state = appState(initialTab = MainTab.More, initialMoreDestination = MoreDestination.Web("/goals"))

        state.open(DeepLink(MainTab.More, "https://other.example/u/anna/walk"))

        assertEquals(MoreDestination.Web("https://other.example/u/anna/walk"), state.moreDestination)
    }

    @Test
    fun `a running deep link to a plain tab just selects it`() {
        val state = appState(initialTab = MainTab.More, initialMoreDestination = MoreDestination.Live)

        state.open(DeepLink(MainTab.Feed))

        assertEquals(MainTab.Feed, state.currentTab)
        // The More sub-page is left as it was (tapping More clears it, as always).
        assertEquals(MoreDestination.Live, state.moreDestination)
    }

    @Test
    fun `deepLinkFrom decodes the launch extras`() {
        assertEquals(DeepLink(MainTab.More, "/goals"), deepLinkFrom(MainActivity.TAB_MORE, "/goals"))
        assertEquals(DeepLink(MainTab.Feed), deepLinkFrom(MainActivity.TAB_FEED, null))
        // A More path only means something with the More tab.
        assertEquals(DeepLink(MainTab.Add), deepLinkFrom(MainActivity.TAB_ADD, "/goals"))
        assertNull(deepLinkFrom(null, "/goals"))
        assertNull(deepLinkFrom("bogus", null))
    }
}
