package net.aurboda.ui.screens

import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import net.aurboda.AppScreen
import net.aurboda.AppState
import net.aurboda.CredentialsManager
import net.aurboda.MainTab
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The More tab wired to a real [AppState], as [net.aurboda.AurbodaApp] wires it:
 * the bottom-bar More button has to reach the hub from a sub-page, not just from
 * another tab.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class MoreNavigationUiTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    private val credentials =
        CredentialsManager.Credentials(
            serverUrl = "https://example.com",
            username = "tester",
            authToken = "token",
        )

    private fun setContent() {
        composeTestRule.setContent {
            val context = LocalContext.current
            val appState =
                remember {
                    AppState(
                        context = context,
                        initialScreen = AppScreen.Main,
                        initialTab = MainTab.More,
                    )
                }
            MainScreen(
                currentTab = appState.currentTab,
                onTabSelected = { appState.selectTab(it) },
                homeContent = {},
                addContent = {},
                feedContent = {},
                syncContent = {},
                moreContent = { modifier ->
                    MoreScreen(
                        credentials = credentials,
                        destination = appState.moreDestination,
                        onSelect = { appState.openMoreDestination(it) },
                        onBack = { appState.closeMoreDestination() },
                        onServerUrlChange = {},
                        onLogout = {},
                        modifier = modifier,
                    )
                },
            )
        }
    }

    @Test
    fun `tapping More from a More sub-page brings the hub back`() {
        setContent()

        composeTestRule.onNodeWithText("Account & server").performScrollTo().performClick()
        composeTestRule.onNodeWithText("Account").assertIsDisplayed()

        composeTestRule.onNodeWithText("More").performClick()

        composeTestRule.onNodeWithText("Timeline").assertIsDisplayed()
    }
}
