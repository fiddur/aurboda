package net.aurboda

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import net.aurboda.ui.screens.MoreDestination

enum class AppScreen {
    Login,
    Main
}

enum class MainTab {
    Home,
    Add,
    Feed,
    Sync,
    More
}

/**
 * Where a widget or notification tap asks the app to go: a tab, and for the More
 * tab optionally the web page to push (a site path like "/goals", or an absolute
 * URL for a page on another instance).
 */
data class DeepLink(val tab: MainTab, val morePath: String? = null)

/** Decode the [MainActivity.EXTRA_OPEN_TAB] / [MainActivity.EXTRA_MORE_PATH] extras; null when there is no link. */
fun deepLinkFrom(openTab: String?, morePath: String?): DeepLink? {
    val tab =
        when (openTab) {
            MainActivity.TAB_ADD -> MainTab.Add
            MainActivity.TAB_FEED -> MainTab.Feed
            MainActivity.TAB_MORE -> MainTab.More
            else -> return null
        }
    return DeepLink(tab, if (tab == MainTab.More) morePath else null)
}

class AppState(
    private val context: Context,
    initialScreen: AppScreen,
    initialTab: MainTab = MainTab.Home,
    initialMoreDestination: MoreDestination? = null
) {
    var currentScreen by mutableStateOf(initialScreen)
        private set

    var currentTab by mutableStateOf(initialTab)
        private set

    /** The sub-page pushed inside the More tab, or null while its hub is showing. */
    var moreDestination by mutableStateOf(initialMoreDestination)
        private set

    var pendingServerUrl by mutableStateOf<String?>(null)
        private set

    val credentials: CredentialsManager.Credentials?
        get() = CredentialsManager.getCredentials(context)

    fun onLoginSuccess() {
        pendingServerUrl = null
        currentScreen = AppScreen.Main
    }

    fun logout() {
        CredentialsManager.clearCredentials(context)
        currentTab = MainTab.Home
        moreDestination = null
        currentScreen = AppScreen.Login
    }

    fun changeServerUrl(newUrl: String) {
        pendingServerUrl = newUrl
        logout()
    }

    fun selectTab(tab: MainTab) {
        // Tapping More always shows its hub -- also when More is already the
        // current tab on one of its sub-pages, which would otherwise leave the
        // menu unreachable except by the back gesture.
        if (tab == MainTab.More) moreDestination = null
        currentTab = tab
    }

    fun openMoreDestination(destination: MoreDestination) {
        moreDestination = destination
    }

    /** Follow a deep link that arrived while the app was already running. */
    fun open(link: DeepLink) {
        selectTab(link.tab)
        link.morePath?.let { moreDestination = MoreDestination.Web(it) }
    }

    fun closeMoreDestination() {
        moreDestination = null
    }
}

@Composable
fun rememberAppState(initialTab: MainTab? = null, initialMorePath: String? = null): AppState {
    val context = LocalContext.current
    return remember {
        val hasCredentials = CredentialsManager.hasCredentials(context)
        AppState(
            context = context,
            initialScreen = if (hasCredentials) AppScreen.Main else AppScreen.Login,
            initialTab = initialTab ?: MainTab.Home,
            initialMoreDestination = initialMorePath?.let { MoreDestination.Web(it) }
        )
    }
}
