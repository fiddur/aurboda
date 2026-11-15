package net.aurboda.update

import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import io.ktor.client.HttpClient
import kotlinx.coroutines.launch
import net.aurboda.BuildConfig
import java.io.File

/** Update channel baked in at build time: stable (main) or beta (develop), see build.gradle.kts. */
private const val VERSION_JSON_URL = BuildConfig.VERSION_JSON_URL

/**
 * Checks the GitHub release channel for a newer APK and walks the user through downloading and
 * installing it. Only the `github` flavor has this; the store flavors' stand-in does nothing.
 */
@Suppress("ASSIGNED_VALUE_IS_NEVER_READ") // Compose state vars trigger false "assigned but never read" warnings
@Composable
fun SelfUpdate(httpClient: HttpClient) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()

  var updateAvailable by remember { mutableStateOf<VersionInfo?>(null) }
  var showUpdateDialog by remember { mutableStateOf(false) }
  var showDownloadingDialog by remember { mutableStateOf(false) }
  var showInstallDialog by remember { mutableStateOf(false) }
  var downloadedApkFile by remember { mutableStateOf<File?>(null) }
  var updateError by remember { mutableStateOf<String?>(null) }

  LaunchedEffect(Unit) {
    val currentVersionCode = BuildConfig.VERSION_CODE_INT
    Log.d("UpdateChecker", "Checking for updates. Current version code: $currentVersionCode")
    when (val result = checkForUpdate(httpClient, VERSION_JSON_URL, currentVersionCode)) {
      is UpdateCheckResult.UpdateAvailable -> {
        Log.d("UpdateChecker", "Update available: ${result.versionInfo.versionName}")
        updateAvailable = result.versionInfo

        when (val downloadState = getExistingDownloadState(context, result.versionInfo.versionName)) {
          is DownloadState.Downloaded -> {
            Log.d("UpdateChecker", "APK already downloaded: ${downloadState.apkFile.name}")
            downloadedApkFile = downloadState.apkFile
            showInstallDialog = true
          }
          is DownloadState.InProgress -> {
            Log.d("UpdateChecker", "Download already in progress")
            showDownloadingDialog = true
          }
          is DownloadState.None -> {
            showUpdateDialog = true
          }
        }
      }
      is UpdateCheckResult.NoUpdate -> {
        Log.d("UpdateChecker", "No update available")
      }
      is UpdateCheckResult.Error -> {
        Log.w("UpdateChecker", "Error checking for updates: ${result.message}")
      }
    }
  }

  if (showUpdateDialog && updateAvailable != null) {
    UpdateAvailableDialog(
      versionInfo = updateAvailable!!,
      onUpdate = {
        showUpdateDialog = false
        showDownloadingDialog = true
        downloadUpdate(
          context = context,
          downloadUrl = updateAvailable!!.downloadUrl,
          versionName = updateAvailable!!.versionName,
          onDownloadComplete = { apkFile ->
            scope.launch {
              showDownloadingDialog = false
              downloadedApkFile = apkFile
              showInstallDialog = true
            }
          },
          onDownloadFailed = { error ->
            scope.launch {
              showDownloadingDialog = false
              updateError = error
            }
          },
        )
      },
      onDismiss = { showUpdateDialog = false },
    )
  }

  if (showInstallDialog && updateAvailable != null && downloadedApkFile != null) {
    UpdateReadyToInstallDialog(
      versionInfo = updateAvailable!!,
      onInstall = {
        showInstallDialog = false
        installApk(context, downloadedApkFile!!)
      },
      onDismiss = { showInstallDialog = false },
    )
  }

  if (showDownloadingDialog) {
    UpdateDownloadingDialog(
      onDismiss = { showDownloadingDialog = false },
    )
  }

  updateError?.let { error ->
    UpdateErrorDialog(
      errorMessage = error,
      onDismiss = { updateError = null },
    )
  }
}
