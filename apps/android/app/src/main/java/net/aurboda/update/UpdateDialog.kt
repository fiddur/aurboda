package net.aurboda.update

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun UpdateAvailableDialog(
    versionInfo: VersionInfo,
    onUpdate: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Update Available") },
        text = {
            Column {
                Text("A new version of Aurboda is available.")
                Spacer(modifier = Modifier.height(8.dp))
                Text("Version: ${versionInfo.versionName}")
                versionInfo.releaseNotes?.let { notes ->
                    if (notes.isNotBlank()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(notes)
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = onUpdate) {
                Text("Update")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Later")
            }
        }
    )
}

@Composable
fun UpdateReadyToInstallDialog(
    versionInfo: VersionInfo,
    onInstall: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Update Ready") },
        text = {
            Column {
                Text("Version ${versionInfo.versionName} has been downloaded and is ready to install.")
                versionInfo.releaseNotes?.let { notes ->
                    if (notes.isNotBlank()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(notes)
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = onInstall) {
                Text("Install")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Later")
            }
        }
    )
}

@Composable
fun UpdateDownloadingDialog(
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Downloading Update") },
        text = {
            Text("The update is being downloaded. You will be notified when it's ready to install.")
        },
        confirmButton = {
            Button(onClick = onDismiss) {
                Text("OK")
            }
        }
    )
}

@Composable
fun UpdateErrorDialog(
    errorMessage: String,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Update Error") },
        text = {
            Text(errorMessage)
        },
        confirmButton = {
            Button(onClick = onDismiss) {
                Text("OK")
            }
        }
    )
}
