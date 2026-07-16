package net.aurboda.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.aurboda.CredentialsManager

/** A destination reachable from the "More" hub. */
sealed interface MoreDestination {
    /** A web page rendered in an embedded WebView at [path] (e.g. "/timeline"). */
    data class Web(val path: String) : MoreDestination

    /** The native live-sensor (BLE) screen. */
    data object Live : MoreDestination

    /** The native account / server-URL screen. */
    data object Account : MoreDestination
}

data class MoreItem(val label: String, val destination: MoreDestination)

data class MoreGroup(val header: String, val items: List<MoreItem>)

/**
 * The "More" hub contents: everything not on the bottom bar. Most entries open
 * the corresponding web page embedded; Live and Account stay native. Keep in
 * sync with the web navigation (see apps/web/src/components/nav-links.ts).
 */
val moreGroups: List<MoreGroup> = listOf(
    MoreGroup(
        "Explore",
        listOf(
            MoreItem("Timeline", MoreDestination.Web("/timeline")),
            MoreItem("Data", MoreDestination.Web("/data")),
            MoreItem("Chart", MoreDestination.Web("/chart")),
            MoreItem("Goals", MoreDestination.Web("/goals")),
            MoreItem("Places", MoreDestination.Web("/places")),
        ),
    ),
    MoreGroup(
        "Log",
        listOf(
            MoreItem("Meals", MoreDestination.Web("/meals")),
            MoreItem("Reports", MoreDestination.Web("/reports")),
        ),
    ),
    MoreGroup(
        "Sharing",
        listOf(
            MoreItem("Shared dashboards", MoreDestination.Web("/shared-dashboards")),
            MoreItem("Challenges", MoreDestination.Web("/challenges")),
        ),
    ),
    MoreGroup(
        "Analyze & manage",
        listOf(
            MoreItem("Analyze", MoreDestination.Web("/correlations")),
            MoreItem("Activity types", MoreDestination.Web("/activity-types")),
            MoreItem("Deduction rules", MoreDestination.Web("/deduction-rules")),
            MoreItem("Data sources", MoreDestination.Web("/data-sources")),
            MoreItem("Settings", MoreDestination.Web("/settings")),
            MoreItem("Audit log", MoreDestination.Web("/audit-log")),
        ),
    ),
    MoreGroup(
        "Device & account",
        listOf(
            MoreItem("Live sensors", MoreDestination.Live),
            MoreItem("Account & server", MoreDestination.Account),
        ),
    ),
)

/**
 * The "More" tab: a hub listing every screen not on the bottom bar. Selecting an
 * entry pushes it in place (embedded web page, or the native Live / Account
 * screens); the system back gesture returns to the hub — after any embedded page
 * has exhausted its own WebView history (EmbeddedWebScreen owns that inner
 * BackHandler, which is composed after this one so it takes precedence).
 */
@Suppress("ASSIGNED_VALUE_IS_NEVER_READ") // Compose state vars trigger false "assigned but never read" warnings
@Composable
fun MoreScreen(
    credentials: CredentialsManager.Credentials,
    onServerUrlChange: (String) -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier,
    initialPath: String? = null,
    onInitialPathConsumed: () -> Unit = {},
) {
    // A deep link (e.g. the goals widget) can open this hub directly on a web
    // page; consumed once so a later manual visit to More shows the hub.
    var destination by remember { mutableStateOf<MoreDestination?>(initialPath?.let { MoreDestination.Web(it) }) }
    LaunchedEffect(Unit) { if (initialPath != null) onInitialPathConsumed() }

    when (val dest = destination) {
        null -> MoreHub(onSelect = { destination = it }, modifier = modifier)
        else -> {
            BackHandler { destination = null }
            when (dest) {
                is MoreDestination.Web ->
                    EmbeddedWebScreen(
                        url = "${credentials.serverUrl.trimEnd('/')}${dest.path}?embed=1",
                        baseUrl = credentials.serverUrl,
                        username = credentials.username,
                        authToken = credentials.authToken,
                        modifier = modifier,
                    )

                MoreDestination.Live -> LiveScreen(modifier = modifier)

                MoreDestination.Account ->
                    AccountScreen(
                        username = credentials.username,
                        serverUrl = credentials.serverUrl,
                        onServerUrlChange = onServerUrlChange,
                        onLogout = onLogout,
                        modifier = modifier,
                    )
            }
        }
    }
}

@Composable
private fun MoreHub(onSelect: (MoreDestination) -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        moreGroups.forEach { group ->
            Text(
                text = group.header,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
            )
            group.items.forEach { item ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelect(item.destination) }
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = item.label,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
                }
                HorizontalDivider()
            }
        }
    }
}
