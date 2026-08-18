package net.aurboda.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import net.aurboda.CredentialsManager
import net.aurboda.DataResult
import net.aurboda.fetchChallengeParticipations
import net.aurboda.fetchChallenges
import net.aurboda.syncHttpClient
import net.aurboda.ui.screens.ChallengeWidgetConfigScreen
import net.aurboda.ui.screens.ChallengeWidgetConfigState
import net.aurboda.ui.theme.AurbodaAppTheme

/**
 * Launched by the launcher when a challenge widget is placed (and from the
 * widget's reconfigure affordance): lists the user's hosted and joined
 * challenges, stores the pick for this widget id and kicks off its first render.
 * Cancelling (back) leaves the result as RESULT_CANCELED so the launcher
 * discards the half-added widget.
 */
class ChallengeWidgetConfigActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        val appWidgetId =
            intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
                ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        setContent {
            AurbodaAppTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    var state by remember { mutableStateOf<ChallengeWidgetConfigState>(ChallengeWidgetConfigState.Loading) }
                    val scope = rememberCoroutineScope()
                    LaunchedEffect(Unit) { state = loadChallengePicks(applicationContext) }
                    ChallengeWidgetConfigScreen(
                        state = state,
                        onPick = { pick ->
                            saveChallengeWidgetConfig(this, appWidgetId, ChallengeWidgetConfig(url = pick.url, name = pick.name))
                            ChallengeWidgetWorker.enqueue(this)
                            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
                            finish()
                        },
                        onRetry = {
                            state = ChallengeWidgetConfigState.Loading
                            scope.launch { state = loadChallengePicks(applicationContext) }
                        },
                    )
                }
            }
        }
    }
}

/** The pickable challenges for the signed-in user, or why there are none. */
suspend fun loadChallengePicks(context: Context): ChallengeWidgetConfigState {
    val credentials = CredentialsManager.getCredentials(context) ?: return ChallengeWidgetConfigState.SignedOut
    val httpClient = syncHttpClient()
    try {
        val hosted = fetchChallenges(httpClient, credentials.apiUrl, credentials.authToken)
        val joined = fetchChallengeParticipations(httpClient, credentials.apiUrl, credentials.authToken)
        if (hosted !is DataResult.Success || joined !is DataResult.Success) {
            return ChallengeWidgetConfigState.Error("Couldn't load your challenges. Check your connection and try again.")
        }
        return ChallengeWidgetConfigState.Ready(challengePicks(hosted.data, joined.data))
    } finally {
        httpClient.close()
    }
}
