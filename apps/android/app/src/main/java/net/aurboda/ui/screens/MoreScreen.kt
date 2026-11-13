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
import androidx.compose.material3.Badge
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.aurboda.CredentialsManager
import net.aurboda.MoreDestination
import net.aurboda.badgeText

data class MoreItem(val label: String, val destination: MoreDestination)

/**
 * The URL an embedded page loads for a [MoreDestination.Web]: site paths are
 * resolved against [serverUrl], absolute URLs are taken as-is; both get the
 * `embed=1` flag that hides the web app's chrome.
 */
fun embeddedPageUrl(serverUrl: String, path: String): String {
    val absolute = path.startsWith("http://") || path.startsWith("https://")
    val page = if (absolute) path else "${serverUrl.trimEnd('/')}$path"
    val hashAt = page.indexOf('#')
    val base = if (hashAt >= 0) page.substring(0, hashAt) else page
    val fragment = if (hashAt >= 0) page.substring(hashAt) else ""
    val separator = if (base.contains('?')) '&' else '?'
    return "$base${separator}embed=1$fragment"
}

data class MoreGroup(val header: String, val items: List<MoreItem>)

private val NOTIFICATIONS_DESTINATION = MoreDestination.Web("/notifications")

/**
 * The "More" hub contents: everything not on the bottom bar. Most entries open
 * the corresponding web page embedded; Live and Account stay native. Keep in
 * sync with the web navigation (see apps/web/src/components/nav-links.ts).
 */
val moreGroups: List<MoreGroup> = listOf(
    MoreGroup("Inbox", listOf(MoreItem("Notifications", NOTIFICATIONS_DESTINATION))),
    MoreGroup(
        "Explore",
        listOf(
            MoreItem("Timeline", MoreDestination.Web("/timeline")),
            MoreItem("Data", MoreDestination.Web("/data")),
            MoreItem("Chart", MoreDestination.Web("/chart")),
            MoreItem("Goals", MoreDestination.Web("/goals")),
            MoreItem("Places", MoreDestination.Web("/places")),
            MoreItem("Routes", MoreDestination.Web("/routes")),
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
            MoreItem("Dashboards", MoreDestination.Web("/dashboards")),
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
            MoreItem("Help & support", MoreDestination.Web("/help")),
        ),
    ),
)

/**
 * The "More" tab: a hub listing every screen not on the bottom bar. Selecting an
 * entry pushes it in place (embedded web page, or the native Live / Account
 * screens); the system back gesture returns to the hub — after any embedded page
 * has exhausted its own WebView history (EmbeddedWebScreen owns that inner
 * BackHandler, which is composed after this one so it takes precedence).
 *
 * [destination] is hoisted into `AppState` so the bottom bar can pop back to the
 * hub when More is tapped while a sub-page is showing.
 */
@Composable
fun MoreScreen(
    credentials: CredentialsManager.Credentials,
    destination: MoreDestination?,
    onSelect: (MoreDestination) -> Unit,
    onBack: () -> Unit,
    onServerUrlChange: (String) -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenWebPage: (String) -> Unit = {},
    unreadNotifications: Int = 0,
) {
    when (val dest = destination) {
        null -> MoreHub(onSelect = onSelect, unreadNotifications = unreadNotifications, modifier = modifier)
        else -> {
            BackHandler { onBack() }
            when (dest) {
                is MoreDestination.Web ->
                    EmbeddedWebScreen(
                        url = embeddedPageUrl(credentials.serverUrl, dest.path),
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
                        onChooseNotificationKinds = { onOpenWebPage("/settings#notifications") },
                        modifier = modifier,
                    )
            }
        }
    }
}

@Composable
private fun MoreHub(
    onSelect: (MoreDestination) -> Unit,
    unreadNotifications: Int,
    modifier: Modifier = Modifier,
) {
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
                    if (item.destination == NOTIFICATIONS_DESTINATION && unreadNotifications > 0) {
                        Badge(modifier = Modifier.padding(end = 8.dp)) { Text(badgeText(unreadNotifications)) }
                    }
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
                }
                HorizontalDivider()
            }
        }
    }
}
