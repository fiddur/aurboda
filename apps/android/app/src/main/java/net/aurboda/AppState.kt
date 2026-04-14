package net.aurboda

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

enum class AppScreen {
    Login,
    Main
}

enum class MainTab {
    Sync,
    Add,
    Live,
    Account
}

class AppState(
    private val context: Context,
    initialScreen: AppScreen,
    initialTab: MainTab = MainTab.Sync
) {
    var currentScreen by mutableStateOf(initialScreen)
        private set

    var currentTab by mutableStateOf(initialTab)
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
        currentTab = MainTab.Sync
        currentScreen = AppScreen.Login
    }

    fun changeServerUrl(newUrl: String) {
        pendingServerUrl = newUrl
        logout()
    }

    fun selectTab(tab: MainTab) {
        currentTab = tab
    }
}

@Composable
fun rememberAppState(initialTab: MainTab? = null): AppState {
    val context = LocalContext.current
    return remember {
        val hasCredentials = CredentialsManager.hasCredentials(context)
        AppState(
            context = context,
            initialScreen = if (hasCredentials) AppScreen.Main else AppScreen.Login,
            initialTab = initialTab ?: MainTab.Sync
        )
    }
}
