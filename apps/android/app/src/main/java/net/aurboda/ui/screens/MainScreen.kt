package net.aurboda.ui.screens

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
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
    syncContent: @Composable (Modifier) -> Unit,
    dataContent: @Composable (Modifier) -> Unit,
    liveContent: @Composable (Modifier) -> Unit,
    accountContent: @Composable (Modifier) -> Unit
) {
    val navItems = listOf(
        BottomNavItem(MainTab.Sync, "Sync", Icons.Default.Refresh),
        BottomNavItem(MainTab.Data, "Data", Icons.Default.Favorite),
        BottomNavItem(MainTab.Live, "Live", Icons.Default.PlayArrow),
        BottomNavItem(MainTab.Account, "Account", Icons.Default.Person)
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
            MainTab.Sync -> syncContent(Modifier.padding(innerPadding))
            MainTab.Data -> dataContent(Modifier.padding(innerPadding))
            MainTab.Live -> liveContent(Modifier.padding(innerPadding))
            MainTab.Account -> accountContent(Modifier.padding(innerPadding))
        }
    }
}
