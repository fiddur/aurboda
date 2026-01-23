package net.aurboda

import android.content.Context
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.platform.LocalLifecycleOwner
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
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer
import net.aurboda.ui.theme.AurbodaAppTheme
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

private suspend inline fun <reified T : Any> handlePostData(
    dataList: List<T>,
    itemSerializer: KSerializer<T>,
    apiUrl: String,
    recordTypeSimpleName: String,
    httpClient: HttpClient,
    authToken: String
): Boolean {
    if (dataList.isEmpty()) {
        Log.d("SendData", "No data to send for $recordTypeSimpleName")
        return true
    }
    val postData = PostWrapper(dataList)
    Log.d("SendData", "JSON Body for $recordTypeSimpleName: ${appJson.encodeToString(PostWrapper.serializer(itemSerializer), postData)}")
    try {
        val response = httpClient.post(apiUrl) {
            contentType(ContentType.Application.Json)
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
            setBody(postData)
        }
        Log.d("SendData", "$recordTypeSimpleName Server response: ${response.status} - ${response.bodyAsText()}")
        return response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created
    } catch (e: Exception) {
        Log.e("SendData", "Error posting $recordTypeSimpleName data to $apiUrl", e)
        return false
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AurbodaAppTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AurbodaApp()
                }
            }
        }
    }
}

@Composable
fun AurbodaApp() {
    val appState = rememberAppState()

    when (appState.currentScreen) {
        AppScreen.Login -> {
            net.aurboda.ui.screens.LoginScreen(
                initialServerUrl = appState.pendingServerUrl,
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
                            serverUrl = credentials.serverUrl,
                            authToken = credentials.authToken,
                            modifier = modifier
                        )
                    },
                    dataContent = { modifier ->
                        net.aurboda.ui.screens.DataScreen(
                            serverUrl = credentials.serverUrl,
                            authToken = credentials.authToken,
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
    serverUrl: String,
    authToken: String,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val healthConnectClient = remember { HealthConnectClient.getOrCreate(context) }
    var hasPermissions by remember { mutableStateOf(false) }
    var healthRecords by remember { mutableStateOf<List<Record>>(emptyList()) } 
    var isProcessing by remember { mutableStateOf(false) } 
    var pendingTokenToPersist by remember { mutableStateOf<String?>(null) }
    var statusMessage by remember { mutableStateOf("Checking permissions...") }
    var backgroundSyncEnabled by remember { mutableStateOf(isBackgroundSyncEnabled(context)) }

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
                    changesResponse.changes.forEach { if (it is DeletionChange) Log.d("HealthConnect", "Record deleted, ID: ${it.recordId}. Deletion handling for server not implemented.") }

                    val nextToken = changesResponse.nextChangesToken
                    hasMore = changesResponse.hasMore

                    if (hasMore && nextToken != null) {
                        currentToken = nextToken
                        Log.d("FetchData", "More changes available, continuing fetch...")
                        statusMessage = "Fetching more data... ($totalUpsertions records so far)"
                    } else {
                        hasMore = false
                        if (nextToken != null) {
                            currentToken = nextToken
                        }
                    }
                }

                localPendingTokenToPersist = currentToken
                Log.d("FetchData", "Fetched $totalUpsertions total upsertions. Next token candidate: ${localPendingTokenToPersist?.take(10)}...")
                if (totalUpsertions == 0) {
                    statusMessage = "No new changes found."
                    saveChangesToken(currentActiveContext, localPendingTokenToPersist)
                    Log.d("FetchData", "Saved next changes token as no new data was found: ${localPendingTokenToPersist?.take(10)}...")
                    localPendingTokenToPersist = null
                } else {
                    statusMessage = "Fetched $totalUpsertions new/updated records. Ready to send."
                }
            } catch (e: Exception) {
                Log.e("FetchData", "Error fetching changes from Health Connect.", e)
                statusMessage = "Error fetching changes: ${e.message}"
                fetchSuccessful = false
            }
        }

        if (fetchSuccessful) {
            healthRecords = localHealthRecords.sortedByDescending { it.getPrimaryInstant() }
            pendingTokenToPersist = localPendingTokenToPersist 
        } else {
            if (lastTokenFromPrefs != null) healthRecords = emptyList() 
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

    suspend fun sendPendingDataToServer(currentActiveContext: Context) {
        if (healthRecords.isEmpty()) {
            statusMessage = "No records to send."
            Log.d("SendData", "No records to send.")
            return
        }
        if(isProcessing){ 
             Log.d("SendData", "sendPendingDataToServer called while already processing.")
            return
        }
        isProcessing = true
        statusMessage = "Sending ${healthRecords.size} records with known serializers to server..."
        var allPostsSuccessful = true

        val recordsWithKnownSerializers = healthRecords.filter {
            when (it) {
                is HeartRateVariabilityRmssdRecord, is WeightRecord, is StepsRecord, is HeartRateRecord,
                is ExerciseSessionRecord, is DistanceRecord, is SpeedRecord, is ActiveCaloriesBurnedRecord,
                is TotalCaloriesBurnedRecord, is PowerRecord, is NutritionRecord, is LeanBodyMassRecord,
                is BodyFatRecord, is SleepSessionRecord, is BoneMassRecord, is HeightRecord,
                is RestingHeartRateRecord -> true
                else -> false
            }
        }

        if (recordsWithKnownSerializers.isEmpty()) {
            statusMessage = "No records with known serializers to send."
            Log.d("SendData", "No records with known serializers to send. Other types might be present but not sent.")
            isProcessing = false
            return
        }

        Log.d("SendData", "Attempting to send ${recordsWithKnownSerializers.size} records with known serializers.")

        val groupedRecords = recordsWithKnownSerializers.groupBy { it::class }
        for ((recordClass, classRecords) in groupedRecords) {
            if (classRecords.isEmpty()) continue
            val recordTypeSimpleName = recordClass.simpleName ?: "UnknownRecordType"
            val apiUrl = "$serverUrl/sync/$recordTypeSimpleName"

            val postSuccessful = when (recordClass) {
                HeartRateVariabilityRmssdRecord::class -> handlePostData(HrvRecordSerializable.fromRecordsList(classRecords), HrvRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                WeightRecord::class -> handlePostData(WeightRecordSerializable.fromRecordsList(classRecords), WeightRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                StepsRecord::class -> handlePostData(StepsRecordSerializable.fromRecordsList(classRecords), StepsRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                HeartRateRecord::class -> handlePostData(HeartRateRecordSerializable.fromRecordsList(classRecords), HeartRateRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                ExerciseSessionRecord::class -> handlePostData(ExerciseSessionRecordSerializable.fromRecordsList(classRecords), ExerciseSessionRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                DistanceRecord::class -> handlePostData(DistanceRecordSerializable.fromRecordsList(classRecords), DistanceRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                SpeedRecord::class -> handlePostData(SpeedRecordSerializable.fromRecordsList(classRecords), SpeedRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                ActiveCaloriesBurnedRecord::class -> handlePostData(ActiveCaloriesBurnedRecordSerializable.fromRecordsList(classRecords), ActiveCaloriesBurnedRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                TotalCaloriesBurnedRecord::class -> handlePostData(TotalCaloriesBurnedRecordSerializable.fromRecordsList(classRecords), TotalCaloriesBurnedRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                PowerRecord::class -> handlePostData(PowerRecordSerializable.fromRecordsList(classRecords), PowerRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                NutritionRecord::class -> handlePostData(NutritionRecordSerializable.fromRecordsList(classRecords), NutritionRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                LeanBodyMassRecord::class -> handlePostData(LeanBodyMassRecordSerializable.fromRecordsList(classRecords), LeanBodyMassRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                BodyFatRecord::class -> handlePostData(BodyFatRecordSerializable.fromRecordsList(classRecords), BodyFatRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                SleepSessionRecord::class -> handlePostData(SleepSessionRecordSerializable.fromRecordsList(classRecords), SleepSessionRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                BoneMassRecord::class -> handlePostData(BoneMassRecordSerializable.fromRecordsList(classRecords), BoneMassRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                HeightRecord::class -> handlePostData(HeightRecordSerializable.fromRecordsList(classRecords), HeightRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                RestingHeartRateRecord::class -> handlePostData(RestingHeartRateRecordSerializable.fromRecordsList(classRecords), RestingHeartRateRecordSerializable.serializer(), apiUrl, recordTypeSimpleName, ktorHttpClient, authToken)
                else -> { Log.w("SendData", "No specific serialization for $recordTypeSimpleName. Skipping."); true }
            }
            if (!postSuccessful) {
                allPostsSuccessful = false
                statusMessage = "Failed to send $recordTypeSimpleName. Pending records remain."
                Log.w("SendData", "Post failed for $recordTypeSimpleName.")
                break
            }
        }

        if (allPostsSuccessful) {
            if (pendingTokenToPersist != null) {
                saveChangesToken(currentActiveContext, pendingTokenToPersist)
                statusMessage = "Known data sent successfully. Token updated."
                Log.d("SendData", "All posts for known types successful. Saved token: ${pendingTokenToPersist?.take(10)}...")
                pendingTokenToPersist = null
            }
             else {
                statusMessage = "Known data sent successfully, but no new token was pending."
                 Log.d("SendData", "All posts for known types successful. No new token was pending to save.")
            }
            healthRecords = healthRecords.filterNot { recordsWithKnownSerializers.contains(it) } 
            if (healthRecords.isEmpty()) statusMessage += " All pending records cleared."
            else statusMessage += " Unsupported records remain."

        } else {
            Log.w("SendData", "Not all posts for known types successful. Pending records and their token candidate remain.")
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
                Log.d("HealthConnectScreen", "App resumed. HasPermissions: $hasPermissions, IsProcessing: $isProcessing")
                if (hasPermissions && !isProcessing) {
                    Log.d("HealthConnectScreen", "Permissions granted and not processing, fetching data on resume.")
                    scope.launch {
                        fetchHealthData(context)
                    }
                }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
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
                    enabled = healthRecords.any { record ->
                        when (record) {
                            is HeartRateVariabilityRmssdRecord, is WeightRecord, is StepsRecord, is HeartRateRecord,
                            is ExerciseSessionRecord, is DistanceRecord, is SpeedRecord, is ActiveCaloriesBurnedRecord,
                            is TotalCaloriesBurnedRecord, is PowerRecord, is NutritionRecord, is LeanBodyMassRecord,
                            is BodyFatRecord, is SleepSessionRecord, is BoneMassRecord, is HeightRecord,
                            is RestingHeartRateRecord -> true
                            else -> false
                        }
                    } && !isProcessing
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
            serverUrl = "https://example.com",
            authToken = "preview-token"
        )
    }
}
