package net.aurboda.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import net.aurboda.NotificationWorker
import net.aurboda.isPostNotificationsEnabled
import net.aurboda.setPostNotificationsEnabled

@Composable
fun AccountScreen(
    username: String,
    serverUrl: String,
    onServerUrlChange: (String) -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier
) {
    var editedServerUrl by remember(serverUrl) { mutableStateOf(serverUrl) }
    val hasChanges = editedServerUrl != serverUrl

    val context = LocalContext.current
    var notifyEnabled by remember { mutableStateOf(isPostNotificationsEnabled(context)) }

    val turnOn = {
        setPostNotificationsEnabled(context, true)
        NotificationWorker.schedule(context)
        notifyEnabled = true
    }
    // On Android 13+ raising a notification needs the runtime POST_NOTIFICATIONS
    // grant; request it when the user turns the feature on.
    val notifyPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) turnOn() else notifyEnabled = false }

    val onNotifyToggle = { want: Boolean ->
        if (want) {
            val needsPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
            if (needsPermission) {
                notifyPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                turnOn()
            }
        } else {
            setPostNotificationsEnabled(context, false)
            NotificationWorker.cancel(context)
            notifyEnabled = false
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Top
    ) {
        Spacer(modifier = Modifier.height(32.dp))

        Text(
            text = "Account",
            style = MaterialTheme.typography.headlineMedium
        )

        Spacer(modifier = Modifier.height(32.dp))

        OutlinedTextField(
            value = username,
            onValueChange = {},
            label = { Text("Username") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            readOnly = true
        )

        Spacer(modifier = Modifier.height(16.dp))

        OutlinedTextField(
            value = editedServerUrl,
            onValueChange = { editedServerUrl = it },
            label = { Text("Server URL") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri)
        )

        if (hasChanges) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Changing the server URL will require you to log in again.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        if (hasChanges) {
            Button(
                onClick = { onServerUrlChange(editedServerUrl.trimEnd('/')) },
                modifier = Modifier.fillMaxWidth(),
                enabled = editedServerUrl.isNotBlank()
            ) {
                Text("Save & Log Out")
            }

            Spacer(modifier = Modifier.height(12.dp))
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Notify me about new posts",
                    style = MaterialTheme.typography.bodyLarge
                )
                Text(
                    text = "A notification when accounts you follow post. Mute individual accounts on the Feed page.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Switch(checked = notifyEnabled, onCheckedChange = onNotifyToggle)
        }

        Spacer(modifier = Modifier.height(24.dp))

        OutlinedButton(
            onClick = onLogout,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = MaterialTheme.colorScheme.error
            )
        ) {
            Text("Log Out")
        }
    }
}
