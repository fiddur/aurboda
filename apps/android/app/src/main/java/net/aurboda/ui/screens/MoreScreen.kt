package net.aurboda.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Badge
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import net.aurboda.BuildConfig
import net.aurboda.CredentialsManager
import net.aurboda.MainTab
import net.aurboda.MoreDestination
import net.aurboda.api.menu.NavLink
import net.aurboda.api.menu.appOnlyLinks
import net.aurboda.api.menu.helpLink
import net.aurboda.api.menu.menuAlwaysShown
import net.aurboda.api.menu.navSections
import net.aurboda.api.menu.notificationsLink
import net.aurboda.api.menu.settingsLink
import net.aurboda.badgeText

data class MoreItem(val label: String, val destination: MoreDestination, val icon: String? = null)

data class MoreSection(val id: String, val label: String, val icon: String, val items: List<MoreItem>)

data class MoreMenu(val top: List<MoreItem>, val sections: List<MoreSection>, val bottom: List<MoreItem>)

/**
 * The URL an embedded page loads for a [MoreDestination.Web]: site paths are
 * resolved against [serverUrl], absolute URLs are taken as-is; both get the
 * `embed=1` flag that hides the web app's chrome. The Google Play build also adds
 * `store=play`, which hides prices and the Pay link (Play's payments policy).
 */
fun embeddedPageUrl(serverUrl: String, path: String, channel: String = BuildConfig.CHANNEL): String {
    val absolute = path.startsWith("http://") || path.startsWith("https://")
    val page = if (absolute) path else "${serverUrl.trimEnd('/')}$path"
    val hashAt = page.indexOf('#')
    val base = if (hashAt >= 0) page.substring(0, hashAt) else page
    val fragment = if (hashAt >= 0) page.substring(hashAt) else ""
    val separator = if (base.contains('?')) '&' else '?'
    val storeFlag = if (channel == "play") "&store=play" else ""
    return "$base${separator}embed=1$storeFlag$fragment"
}

private fun NavLink.toMoreItem(): MoreItem = MoreItem(label, MoreDestination.Web(href), icon)

private val NOTIFICATIONS_DESTINATION = MoreDestination.Web(notificationsLink.href)

/**
 * The "More" hub contents: everything not on the bottom bar. The sections are the
 * web menu's, from the shared definition (`packages/api-spec/src/menu.ts`, generated
 * as `net.aurboda.api.menu`), without admin-only pages; around them sit the
 * app's own entries. Web entries open the page embedded; Live and Account stay native.
 */
val moreMenu: MoreMenu = MoreMenu(
    top = listOf(notificationsLink.toMoreItem()) +
        appOnlyLinks.filter { it.href == "/reminders" }.map { it.toMoreItem() },
    sections = navSections.map { section ->
        MoreSection(
            id = section.id,
            label = section.label,
            icon = section.icon,
            items = section.links.filterNot { it.adminOnly }.map { it.toMoreItem() },
        )
    },
    bottom = listOf(helpLink.toMoreItem(), settingsLink.toMoreItem()) +
        appOnlyLinks.filter { it.href != "/reminders" }.map { it.toMoreItem() } +
        listOf(
            MoreItem("Live sensors", MoreDestination.Live, "📡"),
            MoreItem("Account & server", MoreDestination.Account, "👤"),
        ),
)

fun isPageHidden(path: String, hiddenPages: Collection<String>): Boolean =
    path !in menuAlwaysShown && !path.startsWith("/admin/") && path in hiddenPages

private fun List<MoreItem>.withoutHidden(hiddenPages: Collection<String>): List<MoreItem> =
    filterNot { item ->
        val destination = item.destination
        destination is MoreDestination.Web && isPageHidden(destination.path, hiddenPages)
    }

/** [menu] without the web pages in [hiddenPages] and without sections left empty; native screens always stay. */
fun visibleMoreMenu(menu: MoreMenu, hiddenPages: Collection<String>): MoreMenu =
    MoreMenu(
        top = menu.top.withoutHidden(hiddenPages),
        sections = menu.sections
            .map { it.copy(items = it.items.withoutHidden(hiddenPages)) }
            .filter { it.items.isNotEmpty() },
        bottom = menu.bottom.withoutHidden(hiddenPages),
    )

/**
 * The "More" tab: a hub listing every screen not on the bottom bar. Selecting an
 * entry pushes it in place (embedded web page, or the native Live / Account
 * screens); the system back gesture returns to the hub — after any embedded page
 * has exhausted its own WebView history (EmbeddedWebScreen owns that inner
 * BackHandler, which is composed after this one so it takes precedence).
 *
 * [destination] is hoisted into `AppState` so the bottom bar can pop back to the
 * hub when More is tapped while a sub-page is showing. [webPageLinks] is
 * `AppState.morePageLinks`: the [webPage] is keyed on it and the path, since it
 * loads its URL only when built, so a deep link rebuilds it (also for the page
 * already showing).
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
    onOpenTab: (MainTab) -> Unit = {},
    openSections: Set<String> = emptySet(),
    onToggleSection: (String) -> Unit = {},
    unreadNotifications: Int = 0,
    hiddenPages: List<String> = emptyList(),
    webPageLinks: Int = 0,
    webPage: @Composable (url: String, modifier: Modifier) -> Unit = { url, pageModifier ->
        EmbeddedWebScreen(
            url = url,
            baseUrl = credentials.serverUrl,
            username = credentials.username,
            authToken = credentials.authToken,
            modifier = pageModifier,
        )
    },
) {
    when (val dest = destination) {
        null ->
            MoreHub(
                onSelect = onSelect,
                onOpenTab = onOpenTab,
                openSections = openSections,
                onToggleSection = onToggleSection,
                unreadNotifications = unreadNotifications,
                hiddenPages = hiddenPages,
                modifier = modifier,
            )
        else -> {
            BackHandler { onBack() }
            when (dest) {
                is MoreDestination.Web ->
                    key(dest.path, webPageLinks) {
                        webPage(embeddedPageUrl(credentials.serverUrl, dest.path), modifier)
                    }

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
    onOpenTab: (MainTab) -> Unit,
    openSections: Set<String>,
    onToggleSection: (String) -> Unit,
    unreadNotifications: Int,
    hiddenPages: List<String>,
    modifier: Modifier = Modifier,
) {
    val menu = visibleMoreMenu(moreMenu, hiddenPages)
    val openItem: (MoreItem) -> Unit = { item ->
        val destination = item.destination
        val tab = (destination as? MoreDestination.Web)?.let { mainTabForPath(it.path) }
        if (tab != null) onOpenTab(tab) else onSelect(destination)
    }
    val badge = { item: MoreItem ->
        if (item.destination == NOTIFICATIONS_DESTINATION && unreadNotifications > 0) unreadNotifications else 0
    }
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState()),
    ) {
        menu.top.forEach { item -> MoreRow(item.icon, item.label, badge(item)) { openItem(item) } }
        HorizontalDivider()
        menu.sections.forEach { section ->
            val isOpen = section.id in openSections
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onToggleSection(section.id) }
                    .semantics { stateDescription = if (isOpen) "Expanded" else "Collapsed" }
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconSlot(section.icon)
                Text(
                    text = section.label,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    if (isOpen) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                    contentDescription = null,
                )
            }
            if (isOpen) {
                section.items.forEach { item -> MoreRow(null, item.label, badge(item)) { openItem(item) } }
            }
        }
        HorizontalDivider()
        menu.bottom.forEach { item -> MoreRow(item.icon, item.label, badge(item)) { openItem(item) } }
    }
}

@Composable
private fun IconSlot(icon: String?) {
    Text(
        text = icon ?: "",
        style = MaterialTheme.typography.bodyLarge,
        modifier = Modifier.width(40.dp).clearAndSetSemantics {},
    )
}

@Composable
private fun MoreRow(icon: String?, label: String, badgeCount: Int, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconSlot(icon)
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
        )
        if (badgeCount > 0) {
            Badge(modifier = Modifier.padding(end = 8.dp)) { Text(badgeText(badgeCount)) }
        }
    }
}
