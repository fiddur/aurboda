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
    HealthConnect
}

class AppState(
    private val context: Context,
    initialScreen: AppScreen
) {
    var currentScreen by mutableStateOf(initialScreen)
        private set

    val credentials: CredentialsManager.Credentials?
        get() = CredentialsManager.getCredentials(context)

    fun onLoginSuccess() {
        currentScreen = AppScreen.HealthConnect
    }

    fun logout() {
        CredentialsManager.clearCredentials(context)
        currentScreen = AppScreen.Login
    }
}

@Composable
fun rememberAppState(): AppState {
    val context = LocalContext.current
    return remember {
        val hasCredentials = CredentialsManager.hasCredentials(context)
        AppState(
            context = context,
            initialScreen = if (hasCredentials) AppScreen.HealthConnect else AppScreen.Login
        )
    }
}
