package net.aurboda

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.aurboda.ui.theme.AurbodaAppTheme
import net.aurboda.update.DownloadState
import net.aurboda.update.UpdateAvailableDialog
import net.aurboda.update.UpdateCheckResult
import net.aurboda.update.UpdateDownloadingDialog
import net.aurboda.update.UpdateErrorDialog
import net.aurboda.update.UpdateReadyToInstallDialog
import net.aurboda.update.VersionInfo
import net.aurboda.update.checkForUpdate
import net.aurboda.update.downloadUpdate
import net.aurboda.update.getExistingDownloadState
import net.aurboda.update.installApk
// Import record type lists from HealthDataModels
import net.aurboda.allRecordTypes
import net.aurboda.writableRecordTypes
import java.io.File
import java.time.Instant
import java.time.ZonedDateTime
import kotlin.reflect.KClass

private const val PREFS_NAME = "AurbodaAppPrefs"
private const val CHANGES_TOKEN_KEY = "healthConnectChangesToken"
private const val BACKGROUND_SYNC_ENABLED_KEY = "backgroundSyncEnabled"
private const val GRANTED_TYPES_KEY = "grantedRecordTypeNames"

private fun isBackgroundSyncEnabled(context: Context): Boolean {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  return prefs.getBoolean(BACKGROUND_SYNC_ENABLED_KEY, false)
}

private fun setBackgroundSyncEnabled(
  context: Context,
  enabled: Boolean,
) {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  prefs.edit().putBoolean(BACKGROUND_SYNC_ENABLED_KEY, enabled).apply()
  if (enabled) {
    SyncWorker.schedule(context)
  } else {
    SyncWorker.cancel(context)
  }
}

private fun saveChangesToken(
  context: Context,
  token: String?,
) {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  Log.d("TokenManager", "Saving token: ${token?.take(10)}...")
  prefs.edit().putString(CHANGES_TOKEN_KEY, token).apply()
}

private fun loadChangesToken(context: Context): String? {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  val token = prefs.getString(CHANGES_TOKEN_KEY, null)
  Log.d("TokenManager", "Loaded token: ${token?.take(10)}...")
  return token
}

/**
 * Check if the set of granted record types has changed since last fetch.
 * If changed, invalidate the changes token to force a full re-fetch.
 */
private fun invalidateTokenIfGrantedTypesChanged(
  context: Context,
  currentGrantedTypes: List<KClass<out Record>>,
) {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  val currentNames = currentGrantedTypes.map { it.simpleName ?: "" }.sorted().joinToString(",")
  val savedNames = prefs.getString(GRANTED_TYPES_KEY, null)

  if (savedNames != null && savedNames != currentNames) {
    Log.d("TokenManager", "Granted types changed, invalidating changes token")
    prefs
      .edit()
      .remove(CHANGES_TOKEN_KEY)
      .putString(GRANTED_TYPES_KEY, currentNames)
      .apply()
  } else {
    prefs.edit().putString(GRANTED_TYPES_KEY, currentNames).apply()
  }
}

class MainActivity : ComponentActivity() {
  companion object {
    const val EXTRA_OPEN_TAB = "open_tab"
    const val TAB_DATA = "data"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val initialTab =
      when (intent?.getStringExtra(EXTRA_OPEN_TAB)) {
        TAB_DATA -> MainTab.Data
        else -> null
      }
    setContent {
      AurbodaAppTheme {
        Surface(
          modifier = Modifier.fillMaxSize(),
          color = MaterialTheme.colorScheme.background,
        ) {
          AurbodaApp(initialTab = initialTab)
        }
      }
    }
  }
}

private const val VERSION_JSON_URL = "https://github.com/fiddur/aurboda/releases/latest/download/version.json"

@Suppress("ASSIGNED_VALUE_IS_NEVER_READ") // Compose state vars trigger false "assigned but never read" warnings
@Composable
fun AurbodaApp(initialTab: MainTab? = null) {
  val appState = rememberAppState(initialTab = initialTab)
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val ktorHttpClient = remember { HttpClient(Android) { install(ContentNegotiation) { json(appJson) } } }

  // Update check state
  var updateAvailable by remember { mutableStateOf<VersionInfo?>(null) }
  var showUpdateDialog by remember { mutableStateOf(false) }
  var showDownloadingDialog by remember { mutableStateOf(false) }
  var showInstallDialog by remember { mutableStateOf(false) }
  var downloadedApkFile by remember { mutableStateOf<File?>(null) }
  var updateError by remember { mutableStateOf<String?>(null) }

  // Check for updates on app launch
  LaunchedEffect(Unit) {
    val currentVersionCode = BuildConfig.VERSION_CODE_INT
    Log.d("UpdateChecker", "Checking for updates. Current version code: $currentVersionCode")
    when (val result = checkForUpdate(ktorHttpClient, VERSION_JSON_URL, currentVersionCode)) {
      is UpdateCheckResult.UpdateAvailable -> {
        Log.d("UpdateChecker", "Update available: ${result.versionInfo.versionName}")
        updateAvailable = result.versionInfo

        // Check if we already have this download in progress or finished
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

  // Update dialogs
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

  when (appState.currentScreen) {
    AppScreen.Login -> {
      val context = LocalContext.current
      net.aurboda.ui.screens.LoginScreen(
        initialServerUrl = appState.pendingServerUrl,
        onSaveCredentials = { serverUrl, username, token ->
          CredentialsManager.saveCredentials(context, serverUrl, username, token)
        },
        onLoginSuccess = { appState.onLoginSuccess() },
      )
    }
    AppScreen.Main -> {
      val credentials = appState.credentials
      if (credentials != null) {
        net.aurboda.ui.screens.MainScreen(
          currentTab = appState.currentTab,
          onTabSelected = { appState.selectTab(it) },
          syncContent = { modifier ->
            HealthConnectScreen(
              apiUrl = credentials.apiUrl,
              authToken = credentials.authToken,
              modifier = modifier,
            )
          },
          dataContent = { modifier ->
            net.aurboda.ui.screens.DataScreen(
              apiUrl = credentials.apiUrl,
              authToken = credentials.authToken,
              modifier = modifier,
            )
          },
          liveContent = { modifier ->
            net.aurboda.ui.screens.LiveScreen(
              modifier = modifier,
            )
          },
          accountContent = { modifier ->
            net.aurboda.ui.screens.AccountScreen(
              username = credentials.username,
              serverUrl = credentials.serverUrl,
              onServerUrlChange = { newUrl -> appState.changeServerUrl(newUrl) },
              onLogout = { appState.logout() },
              modifier = modifier,
            )
          },
        )
      } else {
        // Should not happen, but handle gracefully
        appState.logout()
      }
    }
  }
}

@Suppress("ASSIGNED_VALUE_IS_NEVER_READ") // Compose state vars trigger false "assigned but never read" warnings
@Composable
fun HealthConnectScreen(
  apiUrl: String,
  authToken: String,
  modifier: Modifier = Modifier,
) {
  val context = LocalContext.current
  val lifecycleOwner = LocalLifecycleOwner.current
  val healthConnectClient = remember { HealthConnectClient.getOrCreate(context) }

  // -- Permission state (partial permissions support) --
  var grantedPermissions by remember { mutableStateOf<Set<String>>(emptySet()) }
  val grantedRecordTypes by remember(grantedPermissions) {
    derivedStateOf { getGrantedRecordTypes(grantedPermissions) }
  }
  val hasAnyPermissions by remember(grantedRecordTypes) {
    derivedStateOf { grantedRecordTypes.isNotEmpty() }
  }
  val hasAllReadPermissions by remember(grantedPermissions) {
    derivedStateOf {
      val readPerms = allRecordTypes.map { HealthPermission.getReadPermission(it) }.toSet()
      grantedPermissions.containsAll(readPerms)
    }
  }
  val hasAllWritePermissions by remember(grantedPermissions) {
    derivedStateOf {
      val writePerms = writableRecordTypes.map { HealthPermission.getWritePermission(it) }.toSet()
      grantedPermissions.containsAll(writePerms)
    }
  }
  val hasAllPermissions by remember(hasAllReadPermissions, hasAllWritePermissions) {
    derivedStateOf { hasAllReadPermissions && hasAllWritePermissions }
  }
  val categoryStatuses by remember(grantedPermissions) {
    derivedStateOf { getCategoryStatuses(grantedPermissions) }
  }

  var isProcessing by remember { mutableStateOf(false) }
  var statusMessage by remember { mutableStateOf("Checking permissions...") }
  var backgroundSyncEnabled by remember { mutableStateOf(isBackgroundSyncEnabled(context)) }
  var showBatteryOptimizationDialog by remember { mutableStateOf(false) }

  // -- ActivityWatch state --
  var awSyncEnabled by remember { mutableStateOf(isActivityWatchSyncEnabled(context)) }
  var awSyncResult by remember { mutableStateOf<ActivityWatchSyncResult?>(null) }

  val batteryOptimizationLauncher =
    rememberLauncherForActivityResult(
      contract = ActivityResultContracts.StartActivityForResult(),
    ) {
      if (isIgnoringBatteryOptimizations(context)) {
        Log.d("BatteryOptimization", "Battery optimization exemption granted")
      } else {
        Log.d("BatteryOptimization", "Battery optimization exemption was not granted")
      }
    }

  val scope = rememberCoroutineScope()
  val allPermissions =
    remember(allRecordTypes) {
      val readPerms = allRecordTypes.map { HealthPermission.getReadPermission(it) }
      val writePerms = writableRecordTypes.map { HealthPermission.getWritePermission(it) }
      (readPerms + writePerms).toSet()
    }
  val ktorHttpClient = remember { HttpClient(Android) { install(ContentNegotiation) { json(appJson) } } }

  /**
   * Sync Health Connect data incrementally: fetch and send page by page.
   *
   * For initial sync (no token): reads last 7 days per record type and sends each type immediately.
   * For incremental sync (has token): processes each getChanges() page and sends immediately.
   * Saves the changes token after each successful send so progress is never lost.
   */
  suspend fun syncHealthData(currentActiveContext: Context) {
    if (grantedRecordTypes.isEmpty()) {
      statusMessage = "No permissions granted. Cannot sync."
      Log.d("SyncData", "syncHealthData called but no granted types.")
      return
    }
    if (isProcessing) {
      Log.d("SyncData", "syncHealthData called while already processing. Bailing.")
      return
    }
    isProcessing = true
    statusMessage = "Syncing..."
    val typesToFetch = grantedRecordTypes
    Log.d("SyncData", "Starting sync for ${typesToFetch.size} granted types...")

    // Invalidate token if the set of granted types has changed
    invalidateTokenIfGrantedTypesChanged(currentActiveContext, typesToFetch)

    val lastTokenFromPrefs = loadChangesToken(currentActiveContext)

    if (lastTokenFromPrefs == null) {
      // Initial sync: read last 7 days per record type and send each immediately
      Log.d("SyncData", "No token found. Performing initial sync.")
      try {
        val sevenDaysAgo = ZonedDateTime.now().minusDays(7).toInstant()
        val now = Instant.now()
        var totalSent = 0

        for (recordType: KClass<out Record> in typesToFetch) {
          try {
            @Suppress("UNCHECKED_CAST")
            val specificRecordType = recordType as KClass<Record>
            val request =
              ReadRecordsRequest(
                recordType = specificRecordType,
                timeRangeFilter = TimeRangeFilter.between(sevenDaysAgo, now),
                ascendingOrder = false,
              )
            val recordsOfType =
              healthConnectClient
                .readRecords(request)
                .records
                .filterNotOwnOrigin()

            if (recordsOfType.isNotEmpty()) {
              Log.d("SyncData", "Fetched ${recordsOfType.size} ${recordType.simpleName} records, sending...")
              statusMessage = "Syncing ${recordType.simpleName}... ($totalSent records sent so far)"
              val result = sendRecords(recordsOfType, apiUrl, authToken, ktorHttpClient, "SyncData")
              if (!result.isSuccess) {
                statusMessage = "Sync failed on ${recordType.simpleName}: ${result.errorMessage()}"
                Log.w("SyncData", "Failed to send ${recordType.simpleName}: ${result.errorMessage()}")
                isProcessing = false
                return
              }
              totalSent += recordsOfType.size
            }
          } catch (e: Exception) {
            Log.w("SyncData", "Error fetching ${recordType.simpleName}: ${e.message}")
          }
        }

        // All types sent successfully -- get and save the initial changes token
        try {
          val initialToken = healthConnectClient.getChangesToken(ChangesTokenRequest(typesToFetch.toSet()))
          saveChangesToken(currentActiveContext, initialToken)
          Log.d("SyncData", "Initial sync complete. Sent $totalSent records. Token saved.")
          statusMessage = if (totalSent > 0) "Synced $totalSent records." else "No records found."
        } catch (e: Exception) {
          Log.e("SyncData", "Failed to get/save initial changes token.", e)
          statusMessage = "Sync completed but token error: ${e.message}"
        }
      } catch (e: Exception) {
        Log.e("SyncData", "Error during initial sync.", e)
        statusMessage = "Sync error: ${e.message}"
      }
    } else {
      // Incremental sync: process each getChanges() page and send immediately
      Log.d("SyncData", "Token found: ${lastTokenFromPrefs.take(10)}... Fetching changes.")
      try {
        var currentToken: String = lastTokenFromPrefs
        var hasMore = true
        var pageNum = 0
        var totalRecords = 0
        var totalDeletions = 0

        while (hasMore) {
          pageNum++
          val changesResponse = healthConnectClient.getChanges(currentToken)

          val upsertions =
            changesResponse.changes
              .mapNotNull { if (it is UpsertionChange) it.record else null }
              .filterNotOwnOrigin()

          val deletionIds =
            changesResponse.changes
              .filterIsInstance<DeletionChange>()
              .map { it.recordId }

          if (upsertions.isNotEmpty() || deletionIds.isNotEmpty()) {
            Log.d("SyncData", "Page $pageNum: ${upsertions.size} records, ${deletionIds.size} deletions")
            statusMessage = "Syncing... ($totalRecords records, $totalDeletions deletions sent)"
            val result = sendPage(upsertions, deletionIds, apiUrl, authToken, ktorHttpClient, "SyncData")
            if (!result.isSuccess) {
              statusMessage = "Sync failed on page $pageNum: ${result.errorMessage()}"
              Log.w("SyncData", "Page $pageNum failed: ${result.errorMessage()}")
              isProcessing = false
              return
            }
            totalRecords += upsertions.size
            totalDeletions += deletionIds.size
          }

          // Save intermediate token -- this page is permanently done
          currentToken = changesResponse.nextChangesToken
          saveChangesToken(currentActiveContext, currentToken)
          hasMore = changesResponse.hasMore
        }

        if (totalRecords > 0 || totalDeletions > 0) {
          val parts = mutableListOf<String>()
          if (totalRecords > 0) parts.add("$totalRecords records")
          if (totalDeletions > 0) parts.add("$totalDeletions deletions")
          statusMessage = "Synced ${parts.joinToString(", ")}."
          Log.d("SyncData", "Incremental sync complete: ${parts.joinToString(", ")} across $pageNum pages")
        } else {
          statusMessage = "Up to date."
          Log.d("SyncData", "No new changes found")
        }
      } catch (e: Exception) {
        Log.e("SyncData", "Error during incremental sync.", e)
        statusMessage = "Sync error: ${e.message}"
      }
    }

    isProcessing = false
  }

  /** Re-query actual granted permissions from system after launcher returns. */
  suspend fun refreshPermissions() {
    grantedPermissions = healthConnectClient.permissionController.getGrantedPermissions()
    val count = grantedRecordTypes.size
    Log.d("HealthConnect", "Permissions refreshed: $count/${allRecordTypes.size} types granted")
    if (count > 0) {
      statusMessage = "$count of ${allRecordTypes.size} data types authorized."
    } else {
      statusMessage = "No permissions granted."
    }
  }

  val requestPermissionLauncher =
    rememberLauncherForActivityResult(
      contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) { _ ->
      // Don't trust the launcher result -- re-query actual permissions from system
      scope.launch {
        refreshPermissions()
        if (grantedRecordTypes.isNotEmpty()) {
          syncHealthData(context)
        } else {
          isProcessing = false
        }
      }
    }

  suspend fun checkPermissionsAndSync(
    coroutineScope: CoroutineScope,
    currentContext: Context,
  ) {
    grantedPermissions = healthConnectClient.permissionController.getGrantedPermissions()
    val grantedCount = grantedRecordTypes.size
    Log.d("HealthConnect", "Permission check: $grantedCount/${allRecordTypes.size} types granted")

    if (grantedCount > 0) {
      statusMessage = "$grantedCount of ${allRecordTypes.size} data types authorized."
      coroutineScope.launch { syncHealthData(currentContext) }
    } else {
      // No permissions at all -- request everything
      statusMessage = "No permissions granted. Requesting access..."
      isProcessing = false
      requestPermissionLauncher.launch(allPermissions.toTypedArray())
    }
  }

  /** Perform full sync: aggregates + Health Connect data + outbound + ActivityWatch. */
  suspend fun syncNow(currentContext: Context) {
    // Fetch and send daily aggregates for cumulative metrics (steps, distance, etc.)
    try {
      val aggregates = fetchDailyAggregates(healthConnectClient, grantedRecordTypes.toSet(), days = 7)
      if (aggregates.isNotEmpty()) {
        val success = sendDailyAggregates(aggregates, apiUrl, authToken, ktorHttpClient)
        if (success) {
          Log.d("SyncNow", "Sent ${aggregates.size} daily aggregates")
        } else {
          Log.w("SyncNow", "Failed to send daily aggregates")
          statusMessage = "Failed to send daily aggregates."
        }
      }
    } catch (e: Exception) {
      Log.w("SyncNow", "Daily aggregate sync failed: ${e.message}", e)
      statusMessage = "Daily aggregate sync error: ${e.message}"
    }

    // Incremental Health Connect sync (fetch and send page by page)
    syncHealthData(currentContext)

    // Process outbound sync: write backend changes to Health Connect
    try {
      val result =
        processOutboundSync(
          apiUrl = apiUrl,
          authToken = authToken,
          httpClient = ktorHttpClient,
          healthConnectClient = healthConnectClient,
          grantedPermissions = grantedPermissions,
        )
      if (result.fetched > 0) {
        val parts = mutableListOf<String>()
        if (result.written > 0) parts.add("${result.written} written to HC")
        if (result.skipped > 0) parts.add("${result.skipped} skipped")
        if (result.transientFailures > 0) parts.add("${result.transientFailures} transient failures")
        if (!result.acknowledged) parts.add("ack failed")
        val msg = "Outbound: ${parts.joinToString(", ")} (of ${result.fetched} pending)"
        val details = result.skipReasons + result.failReasons
        statusMessage =
          if (details.isNotEmpty()) {
            "$msg\n${details.joinToString("\n")}"
          } else {
            msg
          }
      }
    } catch (e: Exception) {
      Log.w("OutboundSync", "Outbound sync failed in syncNow: ${e.message}", e)
      statusMessage = "Outbound sync error: ${e.message}"
    }
    // ActivityWatch sync (if enabled)
    if (awSyncEnabled) {
      try {
        awSyncResult =
          processActivityWatchSync(
            apiUrl = apiUrl,
            authToken = authToken,
            httpClient = ktorHttpClient,
            context = currentContext,
          )
      } catch (e: Exception) {
        Log.w("ActivityWatch", "AW sync failed in syncNow: ${e.message}", e)
        awSyncResult = ActivityWatchSyncResult(error = e.message)
      }
    }
  }

  LaunchedEffect(Unit) {
    Log.d("HealthConnectScreen", "LaunchedEffect: Initial check")
    checkPermissionsAndSync(this, context)
    if (backgroundSyncEnabled) {
      SyncWorker.schedule(context)
    }
  }

  DisposableEffect(lifecycleOwner) {
    val observer =
      LifecycleEventObserver { _, event ->
        if (event == Lifecycle.Event.ON_RESUME) {
          Log.d("HealthConnectScreen", "App resumed. HasAny: $hasAnyPermissions, IsProcessing: $isProcessing")
          if (hasAnyPermissions && !isProcessing) {
            scope.launch {
              // Re-check permissions in case user changed them in system settings
              refreshPermissions()
              // Incremental sync: fetch and send page by page
              syncHealthData(context)
              // Process outbound sync: write backend changes to Health Connect
              try {
                processOutboundSync(
                  apiUrl = apiUrl,
                  authToken = authToken,
                  httpClient = ktorHttpClient,
                  healthConnectClient = healthConnectClient,
                  grantedPermissions = grantedPermissions,
                )
              } catch (e: Exception) {
                Log.w("OutboundSync", "Outbound sync failed on resume: ${e.message}")
              }
              // Refresh widget with latest data
              net.aurboda.widget.HrZoneWidgetProvider
                .triggerUpdate(context)
            }
          }
        }
      }
    lifecycleOwner.lifecycle.addObserver(observer)
    onDispose {
      lifecycleOwner.lifecycle.removeObserver(observer)
    }
  }

  // Periodic sync while app is open (when background sync is enabled)
  LaunchedEffect(backgroundSyncEnabled, hasAnyPermissions) {
    if (backgroundSyncEnabled && hasAnyPermissions) {
      Log.d("HealthConnectScreen", "Starting periodic sync loop (60s interval)")
      while (true) {
        delay(60_000L)
        if (!isProcessing) {
          Log.d("HealthConnectScreen", "Periodic sync: fetching and sending data")
          syncNow(context)
        }
      }
    }
  }

  // --- UI ---

  LazyColumn(
    modifier = modifier.fillMaxSize().padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    // -- Sync Status Card --
    item {
      androidx.compose.material3.Card(
        modifier = Modifier.fillMaxWidth(),
      ) {
        Column(
          modifier = Modifier.padding(16.dp),
          verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            Text(
              "Health Connect Sync",
              style = MaterialTheme.typography.titleMedium,
              fontWeight = FontWeight.Bold,
            )
            if (isProcessing) {
              androidx.compose.material3.CircularProgressIndicator(
                modifier = Modifier.height(16.dp).width(16.dp),
                strokeWidth = 2.dp,
              )
            }
          }

          Text(
            statusMessage,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )

          Text(
            "${grantedRecordTypes.size} of ${allRecordTypes.size} data types authorized",
            style = MaterialTheme.typography.bodyMedium,
          )

          Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            Text("Background Sync", style = MaterialTheme.typography.bodyMedium)
            Switch(
              checked = backgroundSyncEnabled,
              onCheckedChange = { enabled ->
                backgroundSyncEnabled = enabled
                setBackgroundSyncEnabled(context, enabled)
                if (enabled && !isIgnoringBatteryOptimizations(context)) {
                  showBatteryOptimizationDialog = true
                }
              },
            )
          }

          Button(
            onClick = { scope.launch { syncNow(context) } },
            enabled = hasAnyPermissions && !isProcessing,
            modifier = Modifier.fillMaxWidth(),
          ) {
            Text("Sync Now")
          }

          if (!hasAllPermissions) {
            var permissionsExpanded by remember { mutableStateOf(false) }
            val missingLabel =
              if (!hasAllReadPermissions && !hasAllWritePermissions) {
                "Read & write permissions pending"
              } else if (!hasAllReadPermissions) {
                "Read permissions pending"
              } else {
                "Write permissions pending"
              }

            androidx.compose.material3.Surface(
              onClick = { permissionsExpanded = !permissionsExpanded },
              shape = MaterialTheme.shapes.small,
              color = MaterialTheme.colorScheme.surfaceVariant,
              modifier = Modifier.fillMaxWidth(),
            ) {
              Column(modifier = Modifier.padding(12.dp)) {
                Row(
                  verticalAlignment = Alignment.CenterVertically,
                  horizontalArrangement = Arrangement.SpaceBetween,
                  modifier = Modifier.fillMaxWidth(),
                ) {
                  Text(
                    missingLabel,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                  )
                  Text(
                    if (permissionsExpanded) "\u25B2" else "\u25BC",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                  )
                }

                if (permissionsExpanded) {
                  androidx.compose.foundation.layout
                    .Spacer(modifier = Modifier.height(8.dp))
                  if (hasAllReadPermissions && !hasAllWritePermissions) {
                    Text(
                      "Write access allows outbound sync (pushing data to Health Connect). " +
                        "If the button has no effect, use Health Connect Settings.",
                      style = MaterialTheme.typography.bodySmall,
                      color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    androidx.compose.foundation.layout
                      .Spacer(modifier = Modifier.height(8.dp))
                  }
                  androidx.compose.material3.OutlinedButton(
                    onClick = {
                      requestPermissionLauncher.launch(allPermissions.toTypedArray())
                    },
                    modifier = Modifier.fillMaxWidth(),
                  ) {
                    Text(if (hasAllReadPermissions) "Grant Write Permissions" else "Grant All Permissions")
                  }
                  androidx.compose.material3.TextButton(
                    onClick = {
                      val intent =
                        Intent("androidx.health.ACTION_MANAGE_HEALTH_PERMISSIONS")
                          .putExtra(Intent.EXTRA_PACKAGE_NAME, context.packageName)
                      try {
                        context.startActivity(intent)
                      } catch (e: Exception) {
                        Log.w("HealthConnect", "Could not open HC settings: ${e.message}")
                      }
                    },
                  ) {
                    Text(
                      "Open Health Connect Settings",
                      style = MaterialTheme.typography.bodySmall,
                    )
                  }
                }
              }
            }
          }

          Text(
            "Build ${BuildConfig.BUILD_TIMESTAMP}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
            modifier = Modifier.align(Alignment.End),
          )
        }
      }
    }

    // -- ActivityWatch Sync Card --
    item {
      androidx.compose.material3.Card(
        modifier = Modifier.fillMaxWidth(),
      ) {
        Column(
          modifier = Modifier.padding(16.dp),
          verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          Text(
            "ActivityWatch",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
          )
          Text(
            "Sync app usage data from ActivityWatch for Android.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )

          Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            Text("ActivityWatch Sync", style = MaterialTheme.typography.bodyMedium)
            Switch(
              checked = awSyncEnabled,
              onCheckedChange = { enabled ->
                awSyncEnabled = enabled
                setActivityWatchSyncEnabled(context, enabled)
              },
            )
          }

          if (awSyncEnabled) {
            val result = awSyncResult
            val awStatusText =
              when {
                result == null -> "Sync on next run"
                result.error != null -> "Error: ${result.error}"
                !result.available -> "ActivityWatch not detected"
                result.eventsPushed > 0 -> "${result.eventsPushed} events synced"
                result.bucketsFound == 0 -> "No app-usage buckets found"
                else -> "Up to date"
              }
            val awStatusColor =
              when {
                result == null -> MaterialTheme.colorScheme.onSurfaceVariant
                result.error != null -> MaterialTheme.colorScheme.error
                !result.available -> MaterialTheme.colorScheme.onSurfaceVariant
                result.eventsPushed > 0 -> MaterialTheme.colorScheme.primary
                else -> MaterialTheme.colorScheme.onSurfaceVariant
              }
            Text(
              awStatusText,
              style = MaterialTheme.typography.bodySmall,
              color = awStatusColor,
            )

            if (result != null && !result.available) {
              Text(
                "Install ActivityWatch for Android to sync app usage data.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }
          }
        }
      }
    }

    // -- Data Source Category Cards --
    items(categoryStatuses.size) { index ->
      val status = categoryStatuses[index]
      val iconText =
        when {
          status.allGranted -> "\u2705" // green check
          status.partiallyGranted -> "\u26A0\uFE0F" // amber warning
          else -> "\u274C" // red X
        }
      val iconColor =
        when {
          status.allGranted -> MaterialTheme.colorScheme.primary
          status.partiallyGranted -> MaterialTheme.colorScheme.tertiary
          else -> MaterialTheme.colorScheme.error
        }

      androidx.compose.material3.Card(
        modifier = Modifier.fillMaxWidth(),
      ) {
        Row(
          modifier = Modifier.padding(12.dp).fillMaxWidth(),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
          Text(iconText, style = MaterialTheme.typography.titleLarge)

          Column(modifier = Modifier.weight(1f)) {
            Text(
              status.category.name,
              style = MaterialTheme.typography.titleSmall,
              fontWeight = FontWeight.Bold,
            )
            Text(
              status.category.description,
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (!status.allGranted) {
              Text(
                "${status.grantedCount}/${status.totalCount} types",
                style = MaterialTheme.typography.bodySmall,
                color = iconColor,
              )
            }
          }

          if (!status.allGranted) {
            androidx.compose.material3.OutlinedButton(
              onClick = {
                val categoryPermissions =
                  status.category.recordTypes
                    .flatMap { type ->
                      buildList {
                        add(HealthPermission.getReadPermission(type))
                        if (type in writableRecordTypes) add(HealthPermission.getWritePermission(type))
                      }
                    }.toTypedArray()
                requestPermissionLauncher.launch(categoryPermissions)
              },
            ) {
              Text("Grant")
            }
          }
        }
      }
    }

    // -- Empty state --
    if (!hasAnyPermissions && !isProcessing) {
      item {
        Text(
          "Grant at least one data category to start syncing your health data.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          textAlign = TextAlign.Center,
          modifier = Modifier.padding(vertical = 16.dp),
        )
      }
    }
  }

  // Battery optimization dialog
  if (showBatteryOptimizationDialog) {
    AlertDialog(
      onDismissRequest = { showBatteryOptimizationDialog = false },
      title = { Text("Battery Optimization") },
      text = {
        Text(
          "For reliable background sync, allow Aurboda to run " +
            "without battery restrictions. This helps ensure your " +
            "health data syncs even when the app is closed.",
        )
      },
      confirmButton = {
        Button(
          onClick = {
            showBatteryOptimizationDialog = false
            batteryOptimizationLauncher.launch(
              createBatteryOptimizationIntent(context),
            )
          },
        ) {
          Text("Allow")
        }
      },
      dismissButton = {
        Button(
          onClick = { showBatteryOptimizationDialog = false },
        ) {
          Text("Not Now")
        }
      },
    )
  }
}

@Preview(showBackground = true)
@Composable
fun HealthConnectScreenPreview() {
  AurbodaAppTheme {
    HealthConnectScreen(
      apiUrl = "https://example.com/api",
      authToken = "preview-token",
    )
  }
}
