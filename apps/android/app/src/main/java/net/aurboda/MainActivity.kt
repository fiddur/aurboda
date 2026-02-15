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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.font.FontFamily
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
import io.ktor.client.statement.bodyAsText
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
import net.aurboda.update.UpdateAvailableDialog
import net.aurboda.update.UpdateCheckResult
import net.aurboda.update.UpdateDownloadingDialog
import net.aurboda.update.UpdateErrorDialog
import net.aurboda.update.VersionInfo
import net.aurboda.update.checkForUpdate
import net.aurboda.update.downloadUpdate
import net.aurboda.update.installApk
// Import allRecordTypes from HealthDataModels
import net.aurboda.allRecordTypes
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlin.reflect.KClass

private const val PREFS_NAME = "AurbodaAppPrefs"
private const val CHANGES_TOKEN_KEY = "healthConnectChangesToken"
private const val BACKGROUND_SYNC_ENABLED_KEY = "backgroundSyncEnabled"

private fun isBackgroundSyncEnabled(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getBoolean(BACKGROUND_SYNC_ENABLED_KEY, false)
}

private fun setBackgroundSyncEnabled(context: Context, enabled: Boolean) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putBoolean(BACKGROUND_SYNC_ENABLED_KEY, enabled).apply()
    if (enabled) {
        HealthConnectSyncWorker.schedule(context)
    } else {
        HealthConnectSyncWorker.cancel(context)
    }
}

fun Record.getPrimaryInstant(): Instant {
    return when (this) {
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
}

fun getRecordSummary(record: Record): String {
    return when (record) {
        is HeartRateVariabilityRmssdRecord -> "HRV: ${record.heartRateVariabilityMillis} ms"
        is WeightRecord -> "Weight: ${record.weight.inKilograms} kg"
        is StepsRecord -> "Steps: ${record.count}"
        is ExerciseSessionRecord -> "Exercise: ${record.title ?: record.exerciseType.toString().lowercase().replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }}"
        is DistanceRecord -> "Distance: ${String.format("%.2f", record.distance.inMeters)}m"
        is SpeedRecord -> "Speed: First sample ${String.format("%.2f", record.samples.firstOrNull()?.speed?.inMetersPerSecond ?: 0.0)} m/s"
        is HeartRateRecord -> "HeartRate: ${record.samples.size} samples, first ${record.samples.firstOrNull()?.beatsPerMinute ?: "N/A"}bpm"
        is ActiveCaloriesBurnedRecord -> "Active Cals: ${String.format("%.2f", record.energy.inKilocalories)} kcal"
        is TotalCaloriesBurnedRecord -> "Total Cals: ${String.format("%.2f", record.energy.inKilocalories)} kcal"
        is PowerRecord -> "Power: ${record.samples.size} samples, first ${String.format("%.2f", record.samples.firstOrNull()?.power?.inWatts ?: 0.0)}W"
        is NutritionRecord -> "Nutrition: ${record.name ?: "Unnamed food"} (${record.mealType ?: "Unknown"}, ${String.format("%.0f",record.energy?.inKilocalories ?: 0.0)} kcal)"
        is LeanBodyMassRecord -> "Lean Body Mass: ${String.format("%.2f", record.mass.inKilograms)} kg"
        is BodyFatRecord -> "Body Fat: ${String.format("%.1f", record.percentage.value)}%%"
        is SleepSessionRecord -> "Sleep: ${record.title ?: "Session"} (Stages: ${record.stages.size})"
        is BoneMassRecord -> "Bone Mass: ${String.format("%.2f", record.mass.inKilograms)} kg"
        is BodyWaterMassRecord -> "Body Water: ${String.format("%.2f", record.mass.inKilograms)} kg"
        is HeightRecord -> "Height: ${String.format("%.2f", record.height.inMeters)} m"
        is RestingHeartRateRecord -> "Resting HR: ${record.beatsPerMinute} bpm"
        else -> record::class.simpleName ?: "Record" 
    }
}

private fun saveChangesToken(context: Context, token: String?) {
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

private const val SEND_DATA_TAG = "SendData"

private suspend inline fun <reified T : Any> handlePostData(
    dataList: List<T>,
    itemSerializer: KSerializer<T>,
    apiUrl: String,
    recordTypeSimpleName: String,
    httpClient: HttpClient,
    authToken: String
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
    chunkSize: Int = 10
): PostResult = postDataChunked(
    dataList = dataList,
    apiUrl = apiUrl,
    authToken = authToken,
    httpClient = httpClient,
    chunkSize = chunkSize,
    recordTypeName = recordTypeSimpleName,
    logTag = SEND_DATA_TAG
)

class MainActivity : ComponentActivity() {
    companion object {
        const val EXTRA_OPEN_TAB = "open_tab"
        const val TAB_DATA = "data"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val initialTab = when (intent?.getStringExtra(EXTRA_OPEN_TAB)) {
            TAB_DATA -> MainTab.Data
            else -> null
        }
        setContent {
            AurbodaAppTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AurbodaApp(initialTab = initialTab)
                }
            }
        }
    }
}

private const val VERSION_JSON_URL = "https://github.com/fiddur/aurboda/releases/latest/download/version.json"

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
    var updateError by remember { mutableStateOf<String?>(null) }

    // Check for updates on app launch
    LaunchedEffect(Unit) {
        val currentVersionCode = BuildConfig.VERSION_CODE_INT
        Log.d("UpdateChecker", "Checking for updates. Current version code: $currentVersionCode")
        when (val result = checkForUpdate(ktorHttpClient, VERSION_JSON_URL, currentVersionCode)) {
            is UpdateCheckResult.UpdateAvailable -> {
                Log.d("UpdateChecker", "Update available: ${result.versionInfo.versionName}")
                updateAvailable = result.versionInfo
                showUpdateDialog = true
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
                            installApk(context, apkFile)
                        }
                    },
                    onDownloadFailed = { error ->
                        scope.launch {
                            showDownloadingDialog = false
                            updateError = error
                        }
                    }
                )
            },
            onDismiss = { showUpdateDialog = false }
        )
    }

    if (showDownloadingDialog) {
        UpdateDownloadingDialog(
            onDismiss = { showDownloadingDialog = false }
        )
    }

    updateError?.let { error ->
        UpdateErrorDialog(
            errorMessage = error,
            onDismiss = { updateError = null }
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
                onLoginSuccess = { appState.onLoginSuccess() }
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
                            modifier = modifier
                        )
                    },
                    dataContent = { modifier ->
                        net.aurboda.ui.screens.DataScreen(
                            apiUrl = credentials.apiUrl,
                            authToken = credentials.authToken,
                            modifier = modifier
                        )
                    },
                    liveContent = { modifier ->
                        net.aurboda.ui.screens.LiveScreen(
                            modifier = modifier
                        )
                    },
                    accountContent = { modifier ->
                        net.aurboda.ui.screens.AccountScreen(
                            username = credentials.username,
                            serverUrl = credentials.serverUrl,
                            onServerUrlChange = { newUrl -> appState.changeServerUrl(newUrl) },
                            onLogout = { appState.logout() },
                            modifier = modifier
                        )
                    }
                )
            } else {
                // Should not happen, but handle gracefully
                appState.logout()
            }
        }
    }
}

@Composable
fun HealthConnectScreen(
    apiUrl: String,
    authToken: String,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val healthConnectClient = remember { HealthConnectClient.getOrCreate(context) }
    var hasPermissions by remember { mutableStateOf(false) }
    var healthRecords by remember { mutableStateOf<List<Record>>(emptyList()) }
    var pendingDeletionIds by remember { mutableStateOf<List<String>>(emptyList()) }
    var isProcessing by remember { mutableStateOf(false) }
    var pendingTokenToPersist by remember { mutableStateOf<String?>(null) }
    var statusMessage by remember { mutableStateOf("Checking permissions...") }
    var backgroundSyncEnabled by remember { mutableStateOf(isBackgroundSyncEnabled(context)) }
    var showBatteryOptimizationDialog by remember { mutableStateOf(false) }

    val batteryOptimizationLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) {
        // Check if exemption was granted after returning from settings
        if (isIgnoringBatteryOptimizations(context)) {
            Log.d("BatteryOptimization", "Battery optimization exemption granted")
        } else {
            Log.d("BatteryOptimization", "Battery optimization exemption was not granted")
        }
    }

    val scope = rememberCoroutineScope()
    val permissions = remember(allRecordTypes) { allRecordTypes.map { HealthPermission.getReadPermission(it) }.toSet() }
    val ktorHttpClient = remember { HttpClient(Android) { install(ContentNegotiation) { json(appJson) } } }

    suspend fun fetchHealthData(currentActiveContext: Context) {
        if (!hasPermissions) {
            statusMessage = "Permissions not granted. Cannot fetch data."
            Log.d("HealthConnectScreen", "fetchHealthData called but no permissions.")
            return 
        }
        if(isProcessing) { 
            Log.d("HealthConnectScreen", "fetchHealthData called while already processing (concurrent call). Bailing.")
            return
        }
        isProcessing = true 
        statusMessage = "Fetching data from Health Connect..."
        Log.d("HealthConnectScreen", "Starting data fetch for ${allRecordTypes.size} types...")
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
                for (recordType: KClass<out Record> in allRecordTypes) {
                    try {
                        @Suppress("UNCHECKED_CAST")
                        val specificRecordType = recordType as KClass<Record>
                        val request = ReadRecordsRequest(
                            recordType = specificRecordType,
                            timeRangeFilter = TimeRangeFilter.between(sevenDaysAgo, now),
                            ascendingOrder = false
                        )
                        val recordsOfType = healthConnectClient.readRecords(request).records
                        if(recordsOfType.isNotEmpty()) {
                            Log.d("FetchData", "Fetched ${recordsOfType.size} records of type ${recordType.simpleName}")
                            localHealthRecords.addAll(recordsOfType)
                        }
                    } catch (e: Exception) {
                        Log.w("FetchData", "Error fetching ${recordType.simpleName}: ${e.message}. May require specific permissions not yet handled or type not available.")
                    }
                }
                Log.d("FetchData", "Initial fetch process complete. Total ${localHealthRecords.size} records fetched.")
                if (localHealthRecords.isNotEmpty()) {
                    val initialToken = healthConnectClient.getChangesToken(ChangesTokenRequest(allRecordTypes.toSet()))
                    localPendingTokenToPersist = initialToken
                    statusMessage = "Fetched ${localHealthRecords.size} initial records. Ready to send."
                } else {
                    statusMessage = "No records found during initial fetch for any type."
                    try {
                        val initialToken = healthConnectClient.getChangesToken(ChangesTokenRequest(allRecordTypes.toSet()))
                        saveChangesToken(currentActiveContext, initialToken) 
                        Log.d("FetchData", "Saved initial token as no data was found: ${initialToken.take(10)}...")
                    } catch (e: Exception) {
                        Log.e("FetchData", "Failed to get/save initial changes token when no initial data found.", e)
                        statusMessage = "Error initializing token with no data."
                    }
                }
            } catch (e: Exception) {
                Log.e("FetchData", "Error during overall initial data fetch from Health Connect.", e)
                statusMessage = "Error fetching initial data: ${e.message}"
                fetchSuccessful = false
            }
        } else {
            Log.d("FetchData", "Token found: ${lastTokenFromPrefs.take(10)}... Fetching changes.")
            try {
                var currentToken: String = lastTokenFromPrefs
                var totalUpsertions = 0
                var hasMore = true

                // Loop to fetch all changes until hasMore is false
                while (hasMore) {
                    val changesResponse = healthConnectClient.getChanges(currentToken)
                    val upsertions = changesResponse.changes.mapNotNull { if (it is UpsertionChange) it.record else null }
                    if (upsertions.isNotEmpty()) {
                        Log.d("FetchData", "Adding ${upsertions.size} upserted records to list.")
                        localHealthRecords.addAll(upsertions)
                        totalUpsertions += upsertions.size
                    }
                    changesResponse.changes.forEach {
                        if (it is DeletionChange) {
                            Log.d("HealthConnect", "Record deleted, ID: ${it.recordId}")
                            localDeletionIds.add(it.recordId)
                        }
                    }

                    hasMore = changesResponse.hasMore
                    currentToken = changesResponse.nextChangesToken

                    if (hasMore) {
                        Log.d("FetchData", "More changes available, continuing fetch...")
                        statusMessage = "Fetching more data... ($totalUpsertions records so far)"
                    }
                }

                localPendingTokenToPersist = currentToken
                Log.d("FetchData", "Fetched $totalUpsertions total upsertions, ${localDeletionIds.size} deletions. Next token candidate: ${localPendingTokenToPersist?.take(10)}...")
                if (totalUpsertions == 0 && localDeletionIds.isEmpty()) {
                    statusMessage = "No new changes found."
                    saveChangesToken(currentActiveContext, localPendingTokenToPersist)
                    Log.d("FetchData", "Saved next changes token as no new data was found: ${localPendingTokenToPersist?.take(10)}...")
                    localPendingTokenToPersist = null
                } else {
                    val parts = mutableListOf<String>()
                    if (totalUpsertions > 0) parts.add("$totalUpsertions new/updated records")
                    if (localDeletionIds.isNotEmpty()) parts.add("${localDeletionIds.size} deletions")
                    statusMessage = "Fetched ${parts.joinToString(", ")}. Ready to send."
                }
            } catch (e: Exception) {
                Log.e("FetchData", "Error fetching changes from Health Connect.", e)
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
        Log.d("HealthConnectScreen", "Data fetch processing finished. status: $statusMessage")
        isProcessing = false 
    }

    val requestPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { permissionsMap ->
        val allGranted = permissionsMap.values.all { it }
        hasPermissions = allGranted
        if (allGranted) {
            Log.d("HealthConnect", "All permissions granted via launcher. Attempting to fetch data.")
            scope.launch { fetchHealthData(context) } 
        } else {
            val deniedPermissions = permissionsMap.filter { !it.value }.keys
            val deniedCount = deniedPermissions.size
            Log.w("HealthConnect", "Not all permissions were granted via launcher. Denied ($deniedCount): $deniedPermissions")
            statusMessage = "$deniedCount permission(s) were denied. Health data may be incomplete. Missing: ${deniedPermissions.joinToString()}"
            isProcessing = false 
        }
    }

    suspend fun checkPermissionsAndFetchData(coroutineScope: CoroutineScope, currentContext: Context) {
        val grantedPermissionsSet = healthConnectClient.permissionController.getGrantedPermissions()
        if (grantedPermissionsSet.containsAll(permissions)) {
            hasPermissions = true
            Log.d("HealthConnect", "Permissions are already granted. Will attempt to fetch data.")
            coroutineScope.launch { fetchHealthData(currentContext) }
        } else {
            hasPermissions = false
            val missingPermissions = permissions.subtract(grantedPermissionsSet)
            Log.w("HealthConnect", "Permissions check failed. App needs ${permissions.size}, granted ${grantedPermissionsSet.size}.")
            Log.w("HealthConnect", "Expected permissions: ${permissions.joinToString()}")
            Log.w("HealthConnect", "Granted permissions: ${grantedPermissionsSet.joinToString()}")
            Log.w("HealthConnect", "Missing permissions (${missingPermissions.size}): ${missingPermissions.joinToString()}")
            statusMessage = "${missingPermissions.size} permission(s) not granted. Requesting. Missing: ${missingPermissions.joinToString { it.substringAfterLast(".") } }"
            isProcessing = false 
            requestPermissionLauncher.launch(permissions.toTypedArray())
        }
    }

    // Record types handled by daily aggregates (should not be sent as raw records)
    val aggregatedRecordTypes = setOf(
        StepsRecord::class,
        DistanceRecord::class,
        ActiveCaloriesBurnedRecord::class,
        TotalCaloriesBurnedRecord::class,
        FloorsClimbedRecord::class
    )

    suspend fun sendPendingDataToServer(currentActiveContext: Context) {
        if (healthRecords.isEmpty() && pendingDeletionIds.isEmpty()) {
            statusMessage = "No records to send."
            Log.d("SendData", "No records or deletions to send.")
            return
        }
        if(isProcessing){
             Log.d("SendData", "sendPendingDataToServer called while already processing.")
            return
        }
        isProcessing = true
        var allPostsSuccessful = true

        // Step 1: Send deletions to backend
        if (pendingDeletionIds.isNotEmpty()) {
            statusMessage = "Sending ${pendingDeletionIds.size} deletions..."
            Log.d("SendData", "Sending ${pendingDeletionIds.size} deletion IDs to server")
            val deletionResult = try {
                val response = ktorHttpClient.post("$apiUrl/sync/deletions") {
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

        // Step 2: Send raw records (excluding aggregated types handled by daily aggregates)
        if (allPostsSuccessful && healthRecords.isNotEmpty()) {
            // Filter out aggregated types (steps, distance, etc.) - these are handled by daily aggregates
            val recordsWithKnownSerializers = healthRecords.filter {
                it::class !in aggregatedRecordTypes && when (it) {
                    is HeartRateVariabilityRmssdRecord, is WeightRecord, is HeartRateRecord,
                    is ExerciseSessionRecord, is SpeedRecord, is PowerRecord, is NutritionRecord,
                    is LeanBodyMassRecord, is BodyFatRecord, is SleepSessionRecord, is BoneMassRecord,
                    is BodyWaterMassRecord, is HeightRecord, is RestingHeartRateRecord -> true
                    else -> false
                }
            }

            statusMessage = "Sending ${recordsWithKnownSerializers.size} records to server..."

            if (recordsWithKnownSerializers.isEmpty()) {
                Log.d("SendData", "No records with known serializers to send (aggregated types excluded).")
            } else {
                Log.d("SendData", "Attempting to send ${recordsWithKnownSerializers.size} records (excluded ${healthRecords.size - recordsWithKnownSerializers.size} aggregated/unsupported types).")

                val groupedRecords = recordsWithKnownSerializers.groupBy { it::class }
                for ((recordClass, classRecords) in groupedRecords) {
                    if (classRecords.isEmpty()) continue
                    val recordTypeSimpleName = recordClass.simpleName ?: "UnknownRecordType"
                    val syncUrl = "$apiUrl/sync/$recordTypeSimpleName"

                    val postResult = when (recordClass) {
                        HeartRateVariabilityRmssdRecord::class -> handlePostData(HrvRecordSerializable.fromRecordsList(classRecords), HrvRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        WeightRecord::class -> handlePostData(WeightRecordSerializable.fromRecordsList(classRecords), WeightRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        HeartRateRecord::class -> handlePostDataChunked(HeartRateRecordSerializable.fromRecordsList(classRecords), HeartRateRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        ExerciseSessionRecord::class -> handlePostData(ExerciseSessionRecordSerializable.fromRecordsList(classRecords), ExerciseSessionRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        SpeedRecord::class -> handlePostData(SpeedRecordSerializable.fromRecordsList(classRecords), SpeedRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        PowerRecord::class -> handlePostData(PowerRecordSerializable.fromRecordsList(classRecords), PowerRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        NutritionRecord::class -> handlePostData(NutritionRecordSerializable.fromRecordsList(classRecords), NutritionRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        LeanBodyMassRecord::class -> handlePostData(LeanBodyMassRecordSerializable.fromRecordsList(classRecords), LeanBodyMassRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        BodyFatRecord::class -> handlePostData(BodyFatRecordSerializable.fromRecordsList(classRecords), BodyFatRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        SleepSessionRecord::class -> handlePostData(SleepSessionRecordSerializable.fromRecordsList(classRecords), SleepSessionRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        BoneMassRecord::class -> handlePostData(BoneMassRecordSerializable.fromRecordsList(classRecords), BoneMassRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        BodyWaterMassRecord::class -> handlePostData(BodyWaterMassRecordSerializable.fromRecordsList(classRecords), BodyWaterMassRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        HeightRecord::class -> handlePostData(HeightRecordSerializable.fromRecordsList(classRecords), HeightRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        RestingHeartRateRecord::class -> handlePostData(RestingHeartRateRecordSerializable.fromRecordsList(classRecords), RestingHeartRateRecordSerializable.serializer(), syncUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                        else -> { Log.w("SendData", "No specific serialization for $recordTypeSimpleName. Skipping."); PostResult.Success }
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
                statusMessage = "Data sent successfully, but no new token was pending."
                Log.d("SendData", "All posts successful. No new token was pending to save.")
            }
            healthRecords = emptyList()
            pendingDeletionIds = emptyList()
        } else {
            Log.w("SendData", "Not all posts successful. Pending records and their token candidate remain.")
        }
        isProcessing = false
    }
    
    LaunchedEffect(Unit) {
        Log.d("HealthConnectScreen", "LaunchedEffect: Initial check - current status: $statusMessage, isProcessing: $isProcessing")
        checkPermissionsAndFetchData(this, context)
        // Re-schedule background sync if it was previously enabled
        if (backgroundSyncEnabled) {
            HealthConnectSyncWorker.schedule(context)
        }
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                Log.d("HealthConnectScreen", "App resumed. HasPermissions: $hasPermissions, IsProcessing: $isProcessing, BackgroundSyncEnabled: $backgroundSyncEnabled")
                if (hasPermissions && !isProcessing) {
                    Log.d("HealthConnectScreen", "Permissions granted and not processing, fetching data on resume.")
                    scope.launch {
                        fetchHealthData(context)
                        // Auto-send when background sync is enabled
                        if (backgroundSyncEnabled && (healthRecords.isNotEmpty() || pendingDeletionIds.isNotEmpty())) {
                            Log.d("HealthConnectScreen", "Background sync enabled, auto-sending ${healthRecords.size} records and ${pendingDeletionIds.size} deletions.")
                            sendPendingDataToServer(context)
                        }
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
    LaunchedEffect(backgroundSyncEnabled, hasPermissions) {
        if (backgroundSyncEnabled && hasPermissions) {
            Log.d("HealthConnectScreen", "Starting periodic sync loop (60s interval)")
            while (true) {
                delay(60_000L) // Wait 60 seconds
                if (!isProcessing) {
                    Log.d("HealthConnectScreen", "Periodic sync: fetching and sending data")
                    fetchHealthData(context)
                    if (healthRecords.isNotEmpty() || pendingDeletionIds.isNotEmpty()) {
                        sendPendingDataToServer(context)
                    }
                }
            }
        }
    }

    val supportedRecordsForDisplay by remember(healthRecords) {
        derivedStateOf {
            healthRecords.filterNot { record ->
                val summary = getRecordSummary(record)
                summary == record::class.simpleName || summary == "Record"
            }
        }
    }

    val unsupportedRecordsSummaryText by remember(healthRecords) {
        derivedStateOf {
            val unsupported = healthRecords.filter { record ->
                val summary = getRecordSummary(record)
                summary == record::class.simpleName || summary == "Record"
            }
            val groupedByType = unsupported.groupBy { it::class }
            if (groupedByType.isEmpty()) {
                ""
            } else {
                val count = unsupported.size
                val typesString = groupedByType.keys.mapNotNull { it.simpleName }.distinct().sorted().joinToString(", ")
                "$count Unsupported Records of types: $typesString"
            }
        }
    }

    val groupedAndSortedSupportedRecordsForDisplay by remember(supportedRecordsForDisplay) {
        derivedStateOf {
            val zoneId = ZoneId.systemDefault()
            supportedRecordsForDisplay
                .groupBy { record -> LocalDateTime.ofInstant(record.getPrimaryInstant(), zoneId).toLocalDate() }
                .entries
                .sortedByDescending { it.key } 
                .map { entry -> entry.key to entry.value.sortedByDescending { record -> record.getPrimaryInstant() } } 
        }
    }

    val timeFormatter = remember { DateTimeFormatter.ofPattern("HH:mm") }
    val dateHeaderFormatter = remember { DateTimeFormatter.ofPattern("EEE, MMM d, yyyy") }
    val today = remember { LocalDate.now(ZoneId.systemDefault()) }
    val yesterday = remember { today.minusDays(1) }

    Column(
        modifier = modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(statusMessage)
        Spacer(modifier = Modifier.height(8.dp))

        if (!hasPermissions) {
            Button(
                onClick = { scope.launch { checkPermissionsAndFetchData(scope, context) } }, 
                enabled = !isProcessing 
            ) {
                Text("Request Permissions")
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { scope.launch { fetchHealthData(context) } },
                    enabled = !isProcessing
                ) {
                    Text("Fetch New Data")
                }
                Button(
                    onClick = { scope.launch { sendPendingDataToServer(context) } },
                    enabled = (pendingDeletionIds.isNotEmpty() || healthRecords.any { record ->
                        record::class !in aggregatedRecordTypes && when (record) {
                            is HeartRateVariabilityRmssdRecord, is WeightRecord, is HeartRateRecord,
                            is ExerciseSessionRecord, is SpeedRecord, is PowerRecord, is NutritionRecord,
                            is LeanBodyMassRecord, is BodyFatRecord, is SleepSessionRecord, is BoneMassRecord,
                            is BodyWaterMassRecord, is HeightRecord, is RestingHeartRateRecord -> true
                            else -> false
                        }
                    }) && !isProcessing
                ) {
                    Text("Send Pending Data")
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text("Background Sync")
                Switch(
                    checked = backgroundSyncEnabled,
                    onCheckedChange = { enabled ->
                        backgroundSyncEnabled = enabled
                        setBackgroundSyncEnabled(context, enabled)
                        if (enabled && !isIgnoringBatteryOptimizations(context)) {
                            showBatteryOptimizationDialog = true
                        }
                    }
                )
            }

            if (showBatteryOptimizationDialog) {
                AlertDialog(
                    onDismissRequest = { showBatteryOptimizationDialog = false },
                    title = { Text("Battery Optimization") },
                    text = {
                        Text(
                            "For reliable background sync, allow Aurboda to run " +
                            "without battery restrictions. This helps ensure your " +
                            "health data syncs even when the app is closed."
                        )
                    },
                    confirmButton = {
                        Button(
                            onClick = {
                                showBatteryOptimizationDialog = false
                                batteryOptimizationLauncher.launch(
                                    createBatteryOptimizationIntent(context)
                                )
                            }
                        ) {
                            Text("Allow")
                        }
                    },
                    dismissButton = {
                        Button(
                            onClick = { showBatteryOptimizationDialog = false }
                        ) {
                            Text("Not Now")
                        }
                    }
                )
            }
        }

        Text("Total pending records (all types): ${healthRecords.size}")
        if (unsupportedRecordsSummaryText.isNotEmpty()) {
            Text(unsupportedRecordsSummaryText)
        }
        Spacer(modifier = Modifier.height(8.dp))

        if (groupedAndSortedSupportedRecordsForDisplay.isNotEmpty()) {
            LazyColumn(modifier = Modifier.weight(1f)) {
                groupedAndSortedSupportedRecordsForDisplay.forEach { (date, recordsInGroup) ->
                    item {
                        val dateHeaderText = when (date) {
                            today -> "Today"
                            yesterday -> "Yesterday"
                            else -> date.format(dateHeaderFormatter)
                        }
                        Text(
                            text = dateHeaderText,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(vertical = 8.dp)
                        )
                    }
                    items(recordsInGroup) { record ->
                        Row(verticalAlignment = Alignment.CenterVertically) { 
                            val recordTime = LocalDateTime.ofInstant(record.getPrimaryInstant(), ZoneId.systemDefault()).format(timeFormatter)
                            val recordSummaryText = getRecordSummary(record) 
                            Row {
                                recordTime.forEach { char ->
                                    Text(
                                        text = char.toString(),
                                        fontFamily = FontFamily.Monospace,
                                        textAlign = TextAlign.Center,
                                        modifier = Modifier.width(12.dp) 
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.width(8.dp)) 
                            Text(
                                text = recordSummaryText,
                                modifier = Modifier.weight(1f) 
                            )
                        }
                    }
                }
            }
        } else if (hasPermissions && !isProcessing && healthRecords.isEmpty()) {
             Text("No health records found for the selected period.")
        } else if (hasPermissions && !isProcessing && supportedRecordsForDisplay.isEmpty() && healthRecords.isNotEmpty()){
             Text("No records with custom display found. Check 'Unsupported Records' summary above.")
        }
    }
}

@Preview(showBackground = true)
@Composable
fun HealthConnectScreenPreview() {
    AurbodaAppTheme {
        HealthConnectScreen(
            apiUrl = "https://example.com/api",
            authToken = "preview-token"
        )
    }
}
