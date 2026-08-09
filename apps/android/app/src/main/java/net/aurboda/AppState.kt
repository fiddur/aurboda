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
