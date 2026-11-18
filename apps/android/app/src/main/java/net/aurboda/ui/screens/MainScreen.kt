package net.aurboda.ui.screens

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import net.aurboda.MainTab
import net.aurboda.badgeText

data class BottomNavItem(
    val tab: MainTab,
    val label: String,
    val icon: ImageVector
)

/** The web page a bottom-bar tab stands for; null for native tabs, which are never hidden. */
fun tabWebPath(tab: MainTab): String? =
    when (tab) {
        MainTab.Home -> "/"
        MainTab.Add -> "/add"
        MainTab.Feed -> "/feed"
        MainTab.Sync, MainTab.More -> null
    }

/** The bottom-bar tabs left after [hiddenPages]; Home, Sync and More always stay. */
fun visibleMainTabs(hiddenPages: Collection<String>): List<MainTab> =
    MainTab.entries.filter { tab -> tabWebPath(tab)?.let { !isPageHidden(it, hiddenPages) } ?: true }

@Composable
fun MainScreen(
    currentTab: MainTab,
    onTabSelected: (MainTab) -> Unit,
    homeContent: @Composable (Modifier) -> Unit,
    addContent: @Composable (Modifier) -> Unit,
    feedContent: @Composable (Modifier) -> Unit,
    syncContent: @Composable (Modifier) -> Unit,
    moreContent: @Composable (Modifier) -> Unit,
    unreadNotifications: Int = 0,
    hiddenPages: List<String> = emptyList()
) {
    val navItems = listOf(
        BottomNavItem(MainTab.Home, "Home", Icons.Default.Home),
        BottomNavItem(MainTab.Add, "Add", Icons.Default.Add),
        BottomNavItem(MainTab.Feed, "Feed", Icons.AutoMirrored.Filled.List),
        BottomNavItem(MainTab.Sync, "Sync", Icons.Default.Refresh),
        BottomNavItem(MainTab.More, "More", Icons.Default.Menu)
    ).filter { it.tab in visibleMainTabs(hiddenPages) }

    Scaffold(
        bottomBar = {
            NavigationBar {
                navItems.forEach { item ->
                    NavigationBarItem(
                        selected = currentTab == item.tab,
                        onClick = { onTabSelected(item.tab) },
                        icon = {
                            if (item.tab == MainTab.More && unreadNotifications > 0) {
                                BadgedBox(badge = { Badge { Text(badgeText(unreadNotifications)) } }) {
                                    Icon(item.icon, contentDescription = item.label)
                                }
                            } else {
                                Icon(item.icon, contentDescription = item.label)
                            }
                        },
                        label = { Text(item.label) }
                    )
                }
            }
        }
    ) { innerPadding ->
        when (currentTab) {
            MainTab.Home -> homeContent(Modifier.padding(innerPadding))
            MainTab.Add -> addContent(Modifier.padding(innerPadding))
            MainTab.Feed -> feedContent(Modifier.padding(innerPadding))
            MainTab.Sync -> syncContent(Modifier.padding(innerPadding))
            MainTab.More -> moreContent(Modifier.padding(innerPadding))
        }
    }
}
