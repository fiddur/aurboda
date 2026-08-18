package net.aurboda.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import net.aurboda.widget.ChallengePick
import net.aurboda.widget.challengeDateRange

/** What the challenge-widget configuration screen is showing. */
sealed interface ChallengeWidgetConfigState {
    data object Loading : ChallengeWidgetConfigState

    /** No credentials on the device: the widget can't list (or later show) anything. */
    data object SignedOut : ChallengeWidgetConfigState

    data class Error(val message: String) : ChallengeWidgetConfigState

    data class Ready(val picks: List<ChallengePick>) : ChallengeWidgetConfigState
}

/**
 * The widget configuration UI: pick which challenge — hosted or joined — a newly
 * placed (or reconfigured) widget should follow. Pure presentation; the activity
 * loads the picks and persists the choice.
 */
@Composable
fun ChallengeWidgetConfigScreen(
    state: ChallengeWidgetConfigState,
    onPick: (ChallengePick) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
        Text(
            "Choose a challenge",
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
        )
        Text(
            "The widget shows its race chart and leaderboard, and opens it when tapped.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        when (state) {
            ChallengeWidgetConfigState.Loading -> Centered { CircularProgressIndicator() }
            ChallengeWidgetConfigState.SignedOut ->
                Centered {
                    Text(
                        "Sign in to Aurboda first, then add the widget.",
                        textAlign = TextAlign.Center,
                    )
                }
            is ChallengeWidgetConfigState.Error ->
                Centered {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(state.message, textAlign = TextAlign.Center)
                        Button(onClick = onRetry) { Text("Retry") }
                    }
                }
            is ChallengeWidgetConfigState.Ready ->
                if (state.picks.isEmpty()) {
                    Centered {
                        Text(
                            "You don't host or take part in any challenge yet. Create or join one on the Challenges page, then add the widget.",
                            textAlign = TextAlign.Center,
                        )
                    }
                } else {
                    PickList(state.picks, onPick)
                }
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun PickList(picks: List<ChallengePick>, onPick: (ChallengePick) -> Unit) {
    val hosted = picks.filter { it.hosted }
    val joined = picks.filter { !it.hosted }
    LazyColumn(modifier = Modifier.fillMaxSize().padding(top = 8.dp)) {
        if (hosted.isNotEmpty()) {
            item { SectionHeader("Hosted by you") }
            items(hosted, key = { "h:" + it.url }) { PickRow(it, onPick) }
        }
        if (joined.isNotEmpty()) {
            item { SectionHeader("Joined") }
            items(joined, key = { "j:" + it.url }) { PickRow(it, onPick) }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 20.dp, top = 16.dp, end = 20.dp, bottom = 4.dp),
    )
}

@Composable
private fun PickRow(pick: ChallengePick, onPick: (ChallengePick) -> Unit) {
    Column {
        Row(
            modifier = Modifier.fillMaxWidth().clickable { onPick(pick) }.padding(horizontal = 20.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text(pick.name, style = MaterialTheme.typography.bodyLarge)
                Text(
                    "${pick.detail} · ${challengeDateRange(pick.startTs, pick.endTs, pick.timezone)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        HorizontalDivider(modifier = Modifier.padding(horizontal = 20.dp))
    }
}
