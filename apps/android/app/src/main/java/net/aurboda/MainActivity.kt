package net.aurboda

import android.content.Context
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
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer
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
// Import allRecordTypes from HealthDataModels
import net.aurboda.allRecordTypes
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
    HealthConnectSyncWorker.schedule(context)
  } else {
    HealthConnectSyncWorker.cancel(context)
  }
}

fun Record.getPrimaryInstant(): Instant =
  when (this) {
    is StepsRecord -> this.endTime
    is DistanceRecord -> this.endTime
    is SpeedRecord -> this.endTime
    is ActiveCaloriesBurnedRecord -> this.endTime
    is TotalCaloriesBurnedRecord -> this.endTime
    is PowerRecord -> this.endTime
    is NutritionRecord -> this.endTime
    is SleepSessionRecord -> this.startTime
    is HeartRateVariabilityRmssdRecord -> this.time
    is WeightRecord -> this.time
    is LeanBodyMassRecord -> this.time
    is BodyFatRecord -> this.time
    is BoneMassRecord -> this.time
    is ExerciseSessionRecord -> this.startTime
    is HeartRateRecord -> this.startTime
    is HeightRecord -> this.time
    is BodyWaterMassRecord -> this.time
    is BasalMetabolicRateRecord -> this.time
    is CervicalMucusRecord -> this.time
    is IntermenstrualBleedingRecord -> this.time
    is MenstruationFlowRecord -> this.time
    is MenstruationPeriodRecord -> this.startTime
    is OvulationTestRecord -> this.time
    is SexualActivityRecord -> this.time
    is BasalBodyTemperatureRecord -> this.time
    is HydrationRecord -> this.startTime
    is RestingHeartRateRecord -> this.time
    is BloodPressureRecord -> this.time
    is BloodGlucoseRecord -> this.time
    is OxygenSaturationRecord -> this.time
    is BodyTemperatureRecord -> this.time
    is RespiratoryRateRecord -> this.time
    is FloorsClimbedRecord -> this.endTime
    is CyclingPedalingCadenceRecord -> this.endTime
    is ElevationGainedRecord -> this.endTime
    is Vo2MaxRecord -> this.time
    is WheelchairPushesRecord -> this.endTime
    else -> this.metadata.lastModifiedTime
  }

fun getRecordSummary(record: Record): String =
  when (record) {
    is HeartRateVariabilityRmssdRecord -> "HRV: ${record.heartRateVariabilityMillis} ms"
    is WeightRecord -> "Weight: ${record.weight.inKilograms} kg"
    is StepsRecord -> "Steps: ${record.count}"
    is ExerciseSessionRecord ->
      "Exercise: ${record.title ?: record.exerciseType
        .toString()
        .lowercase()
        .replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }}"
    is DistanceRecord -> "Distance: ${String.format("%.2f", record.distance.inMeters)}m"
    is SpeedRecord -> "Speed: First sample ${String.format(
      "%.2f",
      record.samples
        .firstOrNull()
        ?.speed
        ?.inMetersPerSecond ?: 0.0,
    )} m/s"
    is HeartRateRecord -> "HeartRate: ${record.samples.size} samples, first ${record.samples.firstOrNull()?.beatsPerMinute ?: "N/A"}bpm"
    is ActiveCaloriesBurnedRecord -> "Active Cals: ${String.format("%.2f", record.energy.inKilocalories)} kcal"
    is TotalCaloriesBurnedRecord -> "Total Cals: ${String.format("%.2f", record.energy.inKilocalories)} kcal"
    is PowerRecord -> "Power: ${record.samples.size} samples, first ${String.format(
      "%.2f",
      record.samples
        .firstOrNull()
        ?.power
        ?.inWatts ?: 0.0,
    )}W"
    is NutritionRecord -> "Nutrition: ${record.name ?: "Unnamed food"} (mealType=${record.mealType}, ${String.format(
      "%.0f",
      record.energy?.inKilocalories ?: 0.0,
    )} kcal)"
    is LeanBodyMassRecord -> "Lean Body Mass: ${String.format("%.2f", record.mass.inKilograms)} kg"
    is BodyFatRecord -> "Body Fat: ${String.format("%.1f", record.percentage.value)}%%"
    is SleepSessionRecord -> "Sleep: ${record.title ?: "Session"} (Stages: ${record.stages.size})"
    is BoneMassRecord -> "Bone Mass: ${String.format("%.2f", record.mass.inKilograms)} kg"
    is BodyWaterMassRecord -> "Body Water: ${String.format("%.2f", record.mass.inKilograms)} kg"
    is HeightRecord -> "Height: ${String.format("%.2f", record.height.inMeters)} m"
    is RestingHeartRateRecord -> "Resting HR: ${record.beatsPerMinute} bpm"
    else -> record::class.simpleName ?: "Record"
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

private const val SEND_DATA_TAG = "SendData"

private suspend inline fun <reified T : Any> handlePostData(
  dataList: List<T>,
  itemSerializer: KSerializer<T>,
  apiUrl: String,
  recordTypeSimpleName: String,
  httpClient: HttpClient,
  authToken: String,
): PostResult {
  if (dataList.isEmpty()) {
    Log.d(SEND_DATA_TAG, "No data to send for $recordTypeSimpleName")
    return PostResult.Success
  }
  val postData = PostWrapper(dataList)
  Log.d(SEND_DATA_TAG, "Posting $recordTypeSimpleName: ${dataList.size} records")
  return postChunk(postData, apiUrl, authToken, httpClient, SEND_DATA_TAG)
}

/**
 * Post data in chunks to avoid 413 Request Entity Too Large errors.
 * HeartRateRecord can be very large (thousands of samples per record).
 */
private suspend inline fun <reified T : Any> handlePostDataChunked(
  dataList: List<T>,
  itemSerializer: KSerializer<T>,
  apiUrl: String,
  recordTypeSimpleName: String,
  httpClient: HttpClient,
  authToken: String,
  chunkSize: Int = 10,
): PostResult =
  postDataChunked(
    dataList = dataList,
    apiUrl = apiUrl,
    authToken = authToken,
    httpClient = httpClient,
    chunkSize = chunkSize,
    recordTypeName = recordTypeSimpleName,
    logTag = SEND_DATA_TAG,
  )

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
  val hasAllPermissions by remember(grantedPermissions) {
    derivedStateOf {
      val allPermissions = allRecordTypes.map { HealthPermission.getReadPermission(it) }.toSet()
      grantedPermissions.containsAll(allPermissions)
    }
  }
  val categoryStatuses by remember(grantedPermissions) {
    derivedStateOf { getCategoryStatuses(grantedPermissions) }
  }

  var healthRecords by remember { mutableStateOf<List<Record>>(emptyList()) }
  var pendingDeletionIds by remember { mutableStateOf<List<String>>(emptyList()) }
  var isProcessing by remember { mutableStateOf(false) }
  var pendingTokenToPersist by remember { mutableStateOf<String?>(null) }
  var statusMessage by remember { mutableStateOf("Checking permissions...") }
  var backgroundSyncEnabled by remember { mutableStateOf(isBackgroundSyncEnabled(context)) }
  var showBatteryOptimizationDialog by remember { mutableStateOf(false) }

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
  val allPermissions = remember(allRecordTypes) { allRecordTypes.map { HealthPermission.getReadPermission(it) }.toSet() }
  val ktorHttpClient = remember { HttpClient(Android) { install(ContentNegotiation) { json(appJson) } } }

  suspend fun fetchHealthData(currentActiveContext: Context) {
    if (grantedRecordTypes.isEmpty()) {
      statusMessage = "No permissions granted. Cannot fetch data."
      Log.d("HealthConnectScreen", "fetchHealthData called but no granted types.")
      return
    }
    if (isProcessing) {
      Log.d("HealthConnectScreen", "fetchHealthData called while already processing. Bailing.")
      return
    }
    isProcessing = true
    statusMessage = "Fetching data from Health Connect..."
    val typesToFetch = grantedRecordTypes
    Log.d("HealthConnectScreen", "Starting data fetch for ${typesToFetch.size} granted types...")

    // Invalidate token if the set of granted types has changed
    invalidateTokenIfGrantedTypesChanged(currentActiveContext, typesToFetch)

    val localHealthRecords = mutableListOf<Record>()
    val localDeletionIds = mutableListOf<String>()
    var localPendingTokenToPersist: String? = null
    var fetchSuccessful = true

    val lastTokenFromPrefs = loadChangesToken(currentActiveContext)

    if (lastTokenFromPrefs == null) {
      Log.d("FetchData", "No token found. Performing initial fetch.")
      try {
        val sevenDaysAgo = ZonedDateTime.now().minusDays(7).toInstant()
        val now = Instant.now()
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
                .filter { record ->
                  // Skip records written by Aurboda (outbound sync + BLE sensors)
                  val isOwnOrigin = record.metadata.dataOrigin.packageName == "net.aurboda"
                  val isOutboundSync =
                    record.metadata.clientRecordId
                      ?.startsWith(OUTBOUND_SYNC_CLIENT_ID_PREFIX) == true
                  !(isOwnOrigin || isOutboundSync)
                }
            if (recordsOfType.isNotEmpty()) {
              Log.d("FetchData", "Fetched ${recordsOfType.size} records of type ${recordType.simpleName} (after filtering)")
              localHealthRecords.addAll(recordsOfType)
            }
          } catch (e: Exception) {
            Log.w("FetchData", "Error fetching ${recordType.simpleName}: ${e.message}")
          }
        }
        Log.d("FetchData", "Initial fetch complete. Total ${localHealthRecords.size} records.")
        if (localHealthRecords.isNotEmpty()) {
          val initialToken = healthConnectClient.getChangesToken(ChangesTokenRequest(typesToFetch.toSet()))
          localPendingTokenToPersist = initialToken
          statusMessage = "Fetched ${localHealthRecords.size} initial records. Ready to send."
        } else {
          statusMessage = "No records found during initial fetch."
          try {
            val initialToken = healthConnectClient.getChangesToken(ChangesTokenRequest(typesToFetch.toSet()))
            saveChangesToken(currentActiveContext, initialToken)
            Log.d("FetchData", "Saved initial token (no data): ${initialToken.take(10)}...")
          } catch (e: Exception) {
            Log.e("FetchData", "Failed to get/save initial changes token.", e)
            statusMessage = "Error initializing token."
          }
        }
      } catch (e: Exception) {
        Log.e("FetchData", "Error during initial data fetch.", e)
        statusMessage = "Error fetching initial data: ${e.message}"
        fetchSuccessful = false
      }
    } else {
      Log.d("FetchData", "Token found: ${lastTokenFromPrefs.take(10)}... Fetching changes.")
      try {
        var currentToken: String = lastTokenFromPrefs
        var totalUpsertions = 0
        var hasMore = true

        while (hasMore) {
          val changesResponse = healthConnectClient.getChanges(currentToken)
          val upsertions =
            changesResponse.changes
              .mapNotNull { if (it is UpsertionChange) it.record else null }
              .filter { record ->
                // Skip records written by Aurboda (outbound sync + BLE sensors)
                val isOwnOrigin = record.metadata.dataOrigin.packageName == "net.aurboda"
                val isOutboundSync =
                  record.metadata.clientRecordId
                    ?.startsWith(OUTBOUND_SYNC_CLIENT_ID_PREFIX) == true
                !(isOwnOrigin || isOutboundSync)
              }
          if (upsertions.isNotEmpty()) {
            Log.d("FetchData", "Adding ${upsertions.size} upserted records (after filtering).")
            localHealthRecords.addAll(upsertions)
            totalUpsertions += upsertions.size
          }
          changesResponse.changes.forEach {
            if (it is DeletionChange) {
              localDeletionIds.add(it.recordId)
            }
          }

          hasMore = changesResponse.hasMore
          currentToken = changesResponse.nextChangesToken

          if (hasMore) {
            statusMessage = "Fetching more data... ($totalUpsertions records so far)"
          }
        }

        localPendingTokenToPersist = currentToken
        if (totalUpsertions == 0 && localDeletionIds.isEmpty()) {
          statusMessage = "No new changes found."
          saveChangesToken(currentActiveContext, localPendingTokenToPersist)
          localPendingTokenToPersist = null
        } else {
          val parts = mutableListOf<String>()
          if (totalUpsertions > 0) parts.add("$totalUpsertions new/updated records")
          if (localDeletionIds.isNotEmpty()) parts.add("${localDeletionIds.size} deletions")
          statusMessage = "Fetched ${parts.joinToString(", ")}. Ready to send."
        }
      } catch (e: Exception) {
        Log.e("FetchData", "Error fetching changes.", e)
        statusMessage = "Error fetching changes: ${e.message}"
        fetchSuccessful = false
      }
    }

    if (fetchSuccessful) {
      healthRecords = localHealthRecords.sortedByDescending { it.getPrimaryInstant() }
      pendingDeletionIds = localDeletionIds
      pendingTokenToPersist = localPendingTokenToPersist
    } else {
      if (lastTokenFromPrefs != null) healthRecords = emptyList()
      pendingDeletionIds = emptyList()
      pendingTokenToPersist = null
    }
    Log.d("HealthConnectScreen", "Data fetch finished. status: $statusMessage")
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
      // Don't trust the launcher result — re-query actual permissions from system
      scope.launch {
        refreshPermissions()
        if (grantedRecordTypes.isNotEmpty()) {
          fetchHealthData(context)
        } else {
          isProcessing = false
        }
      }
    }

  suspend fun checkPermissionsAndFetchData(
    coroutineScope: CoroutineScope,
    currentContext: Context,
  ) {
    grantedPermissions = healthConnectClient.permissionController.getGrantedPermissions()
    val grantedCount = grantedRecordTypes.size
    Log.d("HealthConnect", "Permission check: $grantedCount/${allRecordTypes.size} types granted")

    if (grantedCount > 0) {
      statusMessage = "$grantedCount of ${allRecordTypes.size} data types authorized."
      coroutineScope.launch { fetchHealthData(currentContext) }
    } else {
      // No permissions at all — request everything
      statusMessage = "No permissions granted. Requesting access..."
      isProcessing = false
      requestPermissionLauncher.launch(allPermissions.toTypedArray())
    }
  }

  suspend fun sendPendingDataToServer(currentActiveContext: Context) {
    if (healthRecords.isEmpty() && pendingDeletionIds.isEmpty()) {
      statusMessage = "No records to send."
      Log.d("SendData", "No records or deletions to send.")
      return
    }
    if (isProcessing) {
      Log.d("SendData", "sendPendingDataToServer called while already processing.")
      return
    }
    isProcessing = true
    var allPostsSuccessful = true

    // Step 1: Send deletions to backend
    if (pendingDeletionIds.isNotEmpty()) {
      statusMessage = "Sending ${pendingDeletionIds.size} deletions..."
      Log.d("SendData", "Sending ${pendingDeletionIds.size} deletion IDs to server")
      val deletionResult =
        try {
          val response =
            ktorHttpClient.post("$apiUrl/sync/deletions") {
              contentType(ContentType.Application.Json)
              headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
              setBody(PostWrapper(pendingDeletionIds))
            }
          response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created
        } catch (e: Exception) {
          Log.e("SendData", "Error posting deletions", e)
          false
        }
      if (!deletionResult) {
        allPostsSuccessful = false
        statusMessage = "Failed to send deletions"
        Log.w("SendData", "Failed to send deletions")
      } else {
        Log.d("SendData", "Deletions sent successfully")
        pendingDeletionIds = emptyList()
      }
    }

    // Step 2: Send raw records
    if (allPostsSuccessful && healthRecords.isNotEmpty()) {
      val recordsWithKnownSerializers =
        healthRecords.filter {
          when (it) {
            is HeartRateVariabilityRmssdRecord, is WeightRecord, is HeartRateRecord,
            is ExerciseSessionRecord, is SpeedRecord, is PowerRecord, is NutritionRecord,
            is LeanBodyMassRecord, is BodyFatRecord, is SleepSessionRecord, is BoneMassRecord,
            is BodyWaterMassRecord, is HeightRecord, is RestingHeartRateRecord,
            is StepsRecord, is DistanceRecord, is ActiveCaloriesBurnedRecord,
            is TotalCaloriesBurnedRecord, is FloorsClimbedRecord,
            -> true
            else -> false
          }
        }

      statusMessage = "Sending ${recordsWithKnownSerializers.size} records to server..."

      if (recordsWithKnownSerializers.isEmpty()) {
        Log.d("SendData", "No records with known serializers to send.")
      } else {
        Log.d("SendData", "Sending ${recordsWithKnownSerializers.size} records.")

        val groupedRecords = recordsWithKnownSerializers.groupBy { it::class }
        for ((recordClass, classRecords) in groupedRecords) {
          if (classRecords.isEmpty()) continue
          val recordTypeSimpleName = recordClass.simpleName ?: "UnknownRecordType"
          val syncUrl = "$apiUrl/sync/$recordTypeSimpleName"

          val postResult =
            when (recordClass) {
              HeartRateVariabilityRmssdRecord::class ->
                handlePostData(
                  HrvRecordSerializable.fromRecordsList(classRecords),
                  HrvRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              WeightRecord::class ->
                handlePostData(
                  WeightRecordSerializable.fromRecordsList(classRecords),
                  WeightRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              HeartRateRecord::class ->
                handlePostDataChunked(
                  HeartRateRecordSerializable.fromRecordsList(classRecords),
                  HeartRateRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              ExerciseSessionRecord::class ->
                handlePostData(
                  ExerciseSessionRecordSerializable.fromRecordsList(classRecords),
                  ExerciseSessionRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              SpeedRecord::class ->
                handlePostData(
                  SpeedRecordSerializable.fromRecordsList(classRecords),
                  SpeedRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              PowerRecord::class ->
                handlePostData(
                  PowerRecordSerializable.fromRecordsList(classRecords),
                  PowerRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              NutritionRecord::class ->
                handlePostData(
                  NutritionRecordSerializable.fromRecordsList(classRecords),
                  NutritionRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              LeanBodyMassRecord::class ->
                handlePostData(
                  LeanBodyMassRecordSerializable.fromRecordsList(classRecords),
                  LeanBodyMassRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              BodyFatRecord::class ->
                handlePostData(
                  BodyFatRecordSerializable.fromRecordsList(classRecords),
                  BodyFatRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              SleepSessionRecord::class ->
                handlePostData(
                  SleepSessionRecordSerializable.fromRecordsList(classRecords),
                  SleepSessionRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              BoneMassRecord::class ->
                handlePostData(
                  BoneMassRecordSerializable.fromRecordsList(classRecords),
                  BoneMassRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              BodyWaterMassRecord::class ->
                handlePostData(
                  BodyWaterMassRecordSerializable.fromRecordsList(classRecords),
                  BodyWaterMassRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              HeightRecord::class ->
                handlePostData(
                  HeightRecordSerializable.fromRecordsList(classRecords),
                  HeightRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              RestingHeartRateRecord::class ->
                handlePostData(
                  RestingHeartRateRecordSerializable.fromRecordsList(classRecords),
                  RestingHeartRateRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              StepsRecord::class ->
                handlePostData(
                  StepsRecordSerializable.fromRecordsList(classRecords),
                  StepsRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              DistanceRecord::class ->
                handlePostData(
                  DistanceRecordSerializable.fromRecordsList(classRecords),
                  DistanceRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              ActiveCaloriesBurnedRecord::class ->
                handlePostData(
                  ActiveCaloriesBurnedRecordSerializable.fromRecordsList(classRecords),
                  ActiveCaloriesBurnedRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              TotalCaloriesBurnedRecord::class ->
                handlePostData(
                  TotalCaloriesBurnedRecordSerializable.fromRecordsList(classRecords),
                  TotalCaloriesBurnedRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              FloorsClimbedRecord::class ->
                handlePostData(
                  FloorsClimbedRecordSerializable.fromRecordsList(classRecords),
                  FloorsClimbedRecordSerializable.serializer(),
                  syncUrl,
                  recordTypeSimpleName,
                  ktorHttpClient,
                  authToken,
                )
              else -> {
                Log.w("SendData", "No specific serialization for $recordTypeSimpleName. Skipping.")
                PostResult.Success
              }
            }
          if (!postResult.isSuccess) {
            allPostsSuccessful = false
            val errorDetail = postResult.errorMessage() ?: "Unknown error"
            statusMessage = "Failed to send $recordTypeSimpleName: $errorDetail"
            Log.w("SendData", "Post failed for $recordTypeSimpleName: $errorDetail")
            break
          }
        }
      }
    }

    if (allPostsSuccessful) {
      if (pendingTokenToPersist != null) {
        saveChangesToken(currentActiveContext, pendingTokenToPersist)
        statusMessage = "Data sent successfully. Token updated."
        Log.d("SendData", "All posts successful. Saved token: ${pendingTokenToPersist?.take(10)}...")
        pendingTokenToPersist = null
      } else {
        statusMessage = "Data sent successfully."
        Log.d("SendData", "All posts successful. No new token was pending to save.")
      }
      healthRecords = emptyList()
      pendingDeletionIds = emptyList()
    } else {
      Log.w("SendData", "Not all posts successful. Pending records remain.")
    }
    isProcessing = false
  }

  /** Perform fetch + send in one step, then process outbound sync (backend -> HC). */
  suspend fun syncNow(currentContext: Context) {
    fetchHealthData(currentContext)
    if (healthRecords.isNotEmpty() || pendingDeletionIds.isNotEmpty()) {
      sendPendingDataToServer(currentContext)
    }
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
      Log.w("OutboundSync", "Outbound sync failed in syncNow: ${e.message}")
    }
  }

  LaunchedEffect(Unit) {
    Log.d("HealthConnectScreen", "LaunchedEffect: Initial check")
    checkPermissionsAndFetchData(this, context)
    if (backgroundSyncEnabled) {
      HealthConnectSyncWorker.schedule(context)
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
              fetchHealthData(context)
              // Always send pending data when app comes to foreground
              if (healthRecords.isNotEmpty() || pendingDeletionIds.isNotEmpty()) {
                sendPendingDataToServer(context)
              }
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

  val pendingRecordCount by remember(healthRecords) {
    derivedStateOf { healthRecords.size + pendingDeletionIds.size }
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

          if (pendingRecordCount > 0) {
            Text(
              "$pendingRecordCount records pending",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.primary,
            )
          }

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
                    .map { HealthPermission.getReadPermission(it) }
                    .toTypedArray()
                requestPermissionLauncher.launch(categoryPermissions)
              },
            ) {
              Text("Grant")
            }
          }
        }
      }
    }

    // -- Grant All Permissions button --
    if (!hasAllPermissions) {
      item {
        androidx.compose.material3.OutlinedButton(
          onClick = {
            requestPermissionLauncher.launch(allPermissions.toTypedArray())
          },
          modifier = Modifier.fillMaxWidth(),
        ) {
          Text("Grant All Permissions")
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
