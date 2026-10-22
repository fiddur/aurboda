package net.aurboda.ui.screens

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import net.aurboda.MainTab

data class BottomNavItem(
    val tab: MainTab,
    val label: String,
    val icon: ImageVector
)

@Composable
fun MainScreen(
    currentTab: MainTab,
    onTabSelected: (MainTab) -> Unit,
    homeContent: @Composable (Modifier) -> Unit,
    addContent: @Composable (Modifier) -> Unit,
    feedContent: @Composable (Modifier) -> Unit,
    syncContent: @Composable (Modifier) -> Unit,
    moreContent: @Composable (Modifier) -> Unit
) {
    val navItems = listOf(
        BottomNavItem(MainTab.Home, "Home", Icons.Default.Home),
        BottomNavItem(MainTab.Add, "Add", Icons.Default.Add),
        BottomNavItem(MainTab.Feed, "Feed", Icons.AutoMirrored.Filled.List),
        BottomNavItem(MainTab.Sync, "Sync", Icons.Default.Refresh),
        BottomNavItem(MainTab.More, "More", Icons.Default.Menu)
    )

    Scaffold(
        bottomBar = {
            NavigationBar {
                navItems.forEach { item ->
                    NavigationBarItem(
                        selected = currentTab == item.tab,
                        onClick = { onTabSelected(item.tab) },
                        icon = { Icon(item.icon, contentDescription = item.label) },
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
