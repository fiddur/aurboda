package net.aurboda

import android.content.Context
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.LocalDate
import java.time.ZoneId
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
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
import kotlinx.serialization.KSerializer
import net.aurboda.api.models.DailyAggregate
import net.aurboda.api.models.DailyAggregatesBody
import net.aurboda.widget.HrZoneWidgetProvider
import java.util.concurrent.TimeUnit

private const val TAG = "HealthConnectSyncWorker"
private const val PREFS_NAME = "AurbodaAppPrefs"
private const val CHANGES_TOKEN_KEY = "healthConnectChangesToken"
private const val WORK_NAME = "health_connect_sync"

class HealthConnectSyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    private val healthConnectClient by lazy { HealthConnectClient.getOrCreate(applicationContext) }
    private val httpClient by lazy {
        HttpClient(Android) {
            install(ContentNegotiation) { json(appJson) }
        }
    }

    // Cumulative metrics that should be aggregated to avoid duplication
    private val aggregatableMetrics: List<Pair<AggregateMetric<*>, DailyAggregate.Metric>> = listOf(
        Pair(StepsRecord.COUNT_TOTAL, DailyAggregate.Metric.steps),
        Pair(DistanceRecord.DISTANCE_TOTAL, DailyAggregate.Metric.distance),
        Pair(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL, DailyAggregate.Metric.calories_active),
        Pair(TotalCaloriesBurnedRecord.ENERGY_TOTAL, DailyAggregate.Metric.calories_total),
        Pair(FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL, DailyAggregate.Metric.floors_climbed)
    )

    override suspend fun doWork(): Result {
        Log.d(TAG, "Starting background sync")

        val credentials = CredentialsManager.getCredentials(applicationContext)
        if (credentials == null) {
            Log.w(TAG, "No credentials found, skipping sync")
            return Result.success()
        }

        // Check permissions
        val permissions = allRecordTypes.map { HealthPermission.getReadPermission(it) }.toSet()
        val grantedPermissions = healthConnectClient.permissionController.getGrantedPermissions()
        if (!grantedPermissions.containsAll(permissions)) {
            Log.w(TAG, "Not all permissions granted, skipping sync")
            return Result.success()
        }

        return try {
            // Step 1: Fetch and send daily aggregates for cumulative metrics (deduplicated)
            val aggregates = fetchDailyAggregates(days = 7)
            if (aggregates.isNotEmpty()) {
                val aggregateSuccess = sendDailyAggregates(aggregates, credentials.apiUrl, credentials.authToken)
                if (!aggregateSuccess) {
                    Log.w(TAG, "Failed to send daily aggregates, will retry")
                    return Result.retry()
                }
                Log.d(TAG, "Sent ${aggregates.size} daily aggregates")
            }

            // Step 2: Fetch and send raw records (filtered to exclude aggregated types)
            val (records, deletionIds) = fetchHealthData()

            // Step 3: Send deletions to backend
            if (deletionIds.isNotEmpty()) {
                val deletionSuccess = sendDeletions(deletionIds, credentials.apiUrl, credentials.authToken)
                if (!deletionSuccess) {
                    Log.w(TAG, "Failed to send deletions, will retry")
                    return Result.retry()
                }
                Log.d(TAG, "Sent ${deletionIds.size} deletions")
            }

            if (records.isNotEmpty()) {
                val success = sendDataToServer(records, credentials.apiUrl, credentials.authToken)
                if (success) {
                    Log.d(TAG, "Background sync completed successfully")
                    HrZoneWidgetProvider.triggerUpdate(applicationContext)
                    Result.success()
                } else {
                    Log.w(TAG, "Background sync failed to send data")
                    Result.retry()
                }
            } else {
                // If we had deletions but no records, save token
                if (deletionIds.isNotEmpty()) {
                    pendingToken?.let { saveChangesToken(it) }
                }
                Log.d(TAG, "No new data to sync")
                HrZoneWidgetProvider.triggerUpdate(applicationContext)
                Result.success()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Background sync failed", e)
            Result.retry()
        }
    }

    private data class FetchResult(val records: List<Record>, val deletionIds: List<String>)

    private suspend fun fetchHealthData(): FetchResult {
        val records = mutableListOf<Record>()
        val deletionIds = mutableListOf<String>()
        val lastToken = loadChangesToken()

        if (lastToken == null) {
            Log.d(TAG, "No token found, skipping background fetch (initial fetch should be done in foreground)")
            return FetchResult(emptyList(), emptyList())
        }

        var currentToken: String = lastToken
        var hasMore = true

        while (hasMore) {
            val changesResponse = healthConnectClient.getChanges(currentToken)
            val upsertions = changesResponse.changes.mapNotNull {
                if (it is UpsertionChange) it.record else null
            }

            if (upsertions.isNotEmpty()) {
                Log.d(TAG, "Fetched ${upsertions.size} records")
                records.addAll(upsertions)
            }

            changesResponse.changes.forEach {
                if (it is DeletionChange) {
                    Log.d(TAG, "Record deleted, ID: ${it.recordId}")
                    deletionIds.add(it.recordId)
                }
            }

            hasMore = changesResponse.hasMore
            currentToken = changesResponse.nextChangesToken
        }

        // Save the new token if we have records to send (token will be updated after successful send)
        // If no records and no deletions, save token now to avoid re-fetching empty changes
        if (records.isEmpty() && deletionIds.isEmpty()) {
            saveChangesToken(currentToken)
        } else {
            // Store temporarily, will be saved after successful send
            pendingToken = currentToken
        }

        if (deletionIds.isNotEmpty()) {
            Log.d(TAG, "Collected ${deletionIds.size} deletion IDs")
        }

        return FetchResult(records, deletionIds)
    }

    private var pendingToken: String? = null

    private suspend fun sendDataToServer(
        records: List<Record>,
        serverUrl: String,
        authToken: String
    ): Boolean {
        val recordsWithKnownSerializers = records.filter {
            when (it) {
                is HeartRateVariabilityRmssdRecord, is WeightRecord, is HeartRateRecord,
                is ExerciseSessionRecord, is SpeedRecord, is PowerRecord, is NutritionRecord,
                is LeanBodyMassRecord, is BodyFatRecord, is SleepSessionRecord, is BoneMassRecord,
                is BodyWaterMassRecord, is HeightRecord, is RestingHeartRateRecord,
                is StepsRecord, is DistanceRecord, is ActiveCaloriesBurnedRecord,
                is TotalCaloriesBurnedRecord, is FloorsClimbedRecord -> true
                else -> false
            }
        }

        if (recordsWithKnownSerializers.isEmpty()) {
            Log.d(TAG, "No records with known serializers to send")
            pendingToken?.let { saveChangesToken(it) }
            return true
        }

        val groupedRecords = recordsWithKnownSerializers.groupBy { it::class }
        var allPostsSuccessful = true

        for ((recordClass, classRecords) in groupedRecords) {
            if (classRecords.isEmpty()) continue
            val recordTypeSimpleName = recordClass.simpleName ?: "UnknownRecordType"
            val apiUrl = "$serverUrl/sync/$recordTypeSimpleName"

            val postSuccessful = when (recordClass) {
                HeartRateVariabilityRmssdRecord::class -> postData(
                    HrvRecordSerializable.fromRecordsList(classRecords),
                    HrvRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                WeightRecord::class -> postData(
                    WeightRecordSerializable.fromRecordsList(classRecords),
                    WeightRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                HeartRateRecord::class -> postDataChunked(
                    HeartRateRecordSerializable.fromRecordsList(classRecords),
                    HeartRateRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                ExerciseSessionRecord::class -> postData(
                    ExerciseSessionRecordSerializable.fromRecordsList(classRecords),
                    ExerciseSessionRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                SpeedRecord::class -> postData(
                    SpeedRecordSerializable.fromRecordsList(classRecords),
                    SpeedRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                PowerRecord::class -> postData(
                    PowerRecordSerializable.fromRecordsList(classRecords),
                    PowerRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                NutritionRecord::class -> postData(
                    NutritionRecordSerializable.fromRecordsList(classRecords),
                    NutritionRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                LeanBodyMassRecord::class -> postData(
                    LeanBodyMassRecordSerializable.fromRecordsList(classRecords),
                    LeanBodyMassRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                BodyFatRecord::class -> postData(
                    BodyFatRecordSerializable.fromRecordsList(classRecords),
                    BodyFatRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                SleepSessionRecord::class -> postData(
                    SleepSessionRecordSerializable.fromRecordsList(classRecords),
                    SleepSessionRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                BoneMassRecord::class -> postData(
                    BoneMassRecordSerializable.fromRecordsList(classRecords),
                    BoneMassRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                BodyWaterMassRecord::class -> postData(
                    BodyWaterMassRecordSerializable.fromRecordsList(classRecords),
                    BodyWaterMassRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                HeightRecord::class -> postData(
                    HeightRecordSerializable.fromRecordsList(classRecords),
                    HeightRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                RestingHeartRateRecord::class -> postData(
                    RestingHeartRateRecordSerializable.fromRecordsList(classRecords),
                    RestingHeartRateRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                StepsRecord::class -> postData(
                    StepsRecordSerializable.fromRecordsList(classRecords),
                    StepsRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                DistanceRecord::class -> postData(
                    DistanceRecordSerializable.fromRecordsList(classRecords),
                    DistanceRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                ActiveCaloriesBurnedRecord::class -> postData(
                    ActiveCaloriesBurnedRecordSerializable.fromRecordsList(classRecords),
                    ActiveCaloriesBurnedRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                TotalCaloriesBurnedRecord::class -> postData(
                    TotalCaloriesBurnedRecordSerializable.fromRecordsList(classRecords),
                    TotalCaloriesBurnedRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                FloorsClimbedRecord::class -> postData(
                    FloorsClimbedRecordSerializable.fromRecordsList(classRecords),
                    FloorsClimbedRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                else -> {
                    Log.w(TAG, "No specific serialization for $recordTypeSimpleName. Skipping.")
                    true
                }
            }

            if (!postSuccessful) {
                allPostsSuccessful = false
                Log.w(TAG, "Post failed for $recordTypeSimpleName")
                break
            }
        }

        if (allPostsSuccessful) {
            pendingToken?.let { saveChangesToken(it) }
            Log.d(TAG, "All data sent successfully, token updated")
        }

        return allPostsSuccessful
    }

    private suspend inline fun <reified T : Any> postData(
        dataList: List<T>,
        itemSerializer: KSerializer<T>,
        apiUrl: String,
        recordTypeSimpleName: String,
        authToken: String
    ): Boolean {
        if (dataList.isEmpty()) {
            Log.d(TAG, "No data to send for $recordTypeSimpleName")
            return true
        }
        Log.d(TAG, "Posting $recordTypeSimpleName: ${dataList.size} records")
        return postChunk(PostWrapper(dataList), apiUrl, authToken, httpClient, TAG).isSuccess
    }

    /**
     * Post data in chunks to avoid 413 Request Entity Too Large errors.
     * HeartRateRecord can be very large (thousands of samples per record).
     */
    private suspend inline fun <reified T : Any> postDataChunked(
        dataList: List<T>,
        itemSerializer: KSerializer<T>,
        apiUrl: String,
        recordTypeSimpleName: String,
        authToken: String,
        chunkSize: Int = 10
    ): Boolean = postDataChunked(
        dataList = dataList,
        apiUrl = apiUrl,
        authToken = authToken,
        httpClient = httpClient,
        chunkSize = chunkSize,
        recordTypeName = recordTypeSimpleName,
        logTag = TAG
    ).isSuccess

    private fun saveChangesToken(token: String?) {
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        Log.d(TAG, "Saving token: ${token?.take(10)}...")
        prefs.edit().putString(CHANGES_TOKEN_KEY, token).apply()
    }

    private fun loadChangesToken(): String? {
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(CHANGES_TOKEN_KEY, null)
    }

    /**
     * Fetch daily aggregates for cumulative metrics using Health Connect's aggregate() API.
     * This automatically deduplicates based on user-configured app priority.
     */
    private suspend fun fetchDailyAggregates(days: Int = 7): List<DailyAggregate> {
        val aggregates = mutableListOf<DailyAggregate>()
        val today = LocalDate.now()
        val zoneId = ZoneId.systemDefault()

        for (dayOffset in 0 until days) {
            val date = today.minusDays(dayOffset.toLong())
            val startTime = date.atStartOfDay(zoneId).toInstant()
            val endTime = date.plusDays(1).atStartOfDay(zoneId).toInstant()

            for ((metric, metricType) in aggregatableMetrics) {
                try {
                    val request = AggregateRequest(
                        metrics = setOf(metric),
                        timeRangeFilter = TimeRangeFilter.between(startTime, endTime)
                    )
                    val result = healthConnectClient.aggregate(request)

                    // Extract value based on metric type
                    val value: Double? = when (metric) {
                        StepsRecord.COUNT_TOTAL -> result[StepsRecord.COUNT_TOTAL]?.toDouble()
                        DistanceRecord.DISTANCE_TOTAL -> result[DistanceRecord.DISTANCE_TOTAL]?.inMeters
                        ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL ->
                            result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories
                        TotalCaloriesBurnedRecord.ENERGY_TOTAL ->
                            result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories
                        FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL ->
                            result[FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL]
                        else -> null
                    }

                    if (value != null && value > 0) {
                        val dataOrigins = result.dataOrigins.map { it.packageName }
                        aggregates.add(
                            DailyAggregate(
                                date = date.toString(), // YYYY-MM-DD format
                                metric = metricType,
                                value = value,
                                dataOrigins = dataOrigins
                            )
                        )
                        Log.d(TAG, "Aggregate for $metricType on $date: $value from ${dataOrigins.size} sources")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to fetch aggregate for $metricType on $date", e)
                }
            }
        }

        return aggregates
    }

    /**
     * Send daily aggregates to the backend.
     */
    private suspend fun sendDailyAggregates(
        aggregates: List<DailyAggregate>,
        serverUrl: String,
        authToken: String
    ): Boolean {
        if (aggregates.isEmpty()) {
            Log.d(TAG, "No aggregates to send")
            return true
        }

        val postData = DailyAggregatesBody(data = aggregates)
        return try {
            val response = httpClient.post("$serverUrl/sync/daily-aggregates") {
                contentType(ContentType.Application.Json)
                headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
                setBody(postData)
            }
            Log.d(TAG, "Daily aggregates response: ${response.status}")
            response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created
        } catch (e: Exception) {
            Log.e(TAG, "Error posting daily aggregates", e)
            false
        }
    }

    /**
     * Send Health Connect deletion IDs to the backend.
     */
    private suspend fun sendDeletions(
        deletionIds: List<String>,
        serverUrl: String,
        authToken: String
    ): Boolean {
        if (deletionIds.isEmpty()) return true

        val postData = PostWrapper(deletionIds)
        return try {
            val response = httpClient.post("$serverUrl/sync/deletions") {
                contentType(ContentType.Application.Json)
                headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
                setBody(postData)
            }
            Log.d(TAG, "Deletions response: ${response.status}")
            response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created
        } catch (e: Exception) {
            Log.e(TAG, "Error posting deletions", e)
            false
        }
    }

    companion object {
        /**
         * Schedule periodic background sync.
         * Sync runs every 15 minutes (minimum interval for periodic work).
         */
        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = PeriodicWorkRequestBuilder<HealthConnectSyncWorker>(
                15, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                workRequest
            )
            Log.d(TAG, "Background sync scheduled with network constraint")
        }

        /**
         * Cancel scheduled background sync.
         */
        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.d(TAG, "Background sync cancelled")
        }
    }
}
