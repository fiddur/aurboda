package net.aurboda

import android.content.Context
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
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
            val records = fetchHealthData()
            if (records.isNotEmpty()) {
                val success = sendDataToServer(records, credentials.serverUrl, credentials.authToken)
                if (success) {
                    Log.d(TAG, "Background sync completed successfully")
                    Result.success()
                } else {
                    Log.w(TAG, "Background sync failed to send data")
                    Result.retry()
                }
            } else {
                Log.d(TAG, "No new data to sync")
                Result.success()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Background sync failed", e)
            Result.retry()
        }
    }

    private suspend fun fetchHealthData(): List<Record> {
        val records = mutableListOf<Record>()
        val lastToken = loadChangesToken()

        if (lastToken == null) {
            Log.d(TAG, "No token found, skipping background fetch (initial fetch should be done in foreground)")
            return emptyList()
        }

        var currentToken = lastToken
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
                }
            }

            currentToken = changesResponse.nextChangesToken
            hasMore = changesResponse.hasMore
        }

        // Save the new token if we have records to send (token will be updated after successful send)
        // If no records, save token now to avoid re-fetching empty changes
        if (records.isEmpty()) {
            saveChangesToken(currentToken)
        } else {
            // Store temporarily, will be saved after successful send
            pendingToken = currentToken
        }

        return records
    }

    private var pendingToken: String? = null

    private suspend fun sendDataToServer(
        records: List<Record>,
        serverUrl: String,
        authToken: String
    ): Boolean {
        val recordsWithKnownSerializers = records.filter {
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
                StepsRecord::class -> postData(
                    StepsRecordSerializable.fromRecordsList(classRecords),
                    StepsRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                HeartRateRecord::class -> postData(
                    HeartRateRecordSerializable.fromRecordsList(classRecords),
                    HeartRateRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                ExerciseSessionRecord::class -> postData(
                    ExerciseSessionRecordSerializable.fromRecordsList(classRecords),
                    ExerciseSessionRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                DistanceRecord::class -> postData(
                    DistanceRecordSerializable.fromRecordsList(classRecords),
                    DistanceRecordSerializable.serializer(),
                    apiUrl, recordTypeSimpleName, authToken
                )
                SpeedRecord::class -> postData(
                    SpeedRecordSerializable.fromRecordsList(classRecords),
                    SpeedRecordSerializable.serializer(),
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

    private suspend fun <T : Any> postData(
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

        val postData = PostWrapper(dataList)
        return try {
            val response = httpClient.post(apiUrl) {
                contentType(ContentType.Application.Json)
                headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
                setBody(postData)
            }
            Log.d(TAG, "$recordTypeSimpleName Server response: ${response.status}")
            response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created
        } catch (e: Exception) {
            Log.e(TAG, "Error posting $recordTypeSimpleName data to $apiUrl", e)
            false
        }
    }

    private fun saveChangesToken(token: String?) {
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        Log.d(TAG, "Saving token: ${token?.take(10)}...")
        prefs.edit().putString(CHANGES_TOKEN_KEY, token).apply()
    }

    private fun loadChangesToken(): String? {
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(CHANGES_TOKEN_KEY, null)
    }

    companion object {
        /**
         * Schedule periodic background sync.
         * Sync runs every 15 minutes (minimum interval for periodic work).
         */
        fun schedule(context: Context) {
            val workRequest = PeriodicWorkRequestBuilder<HealthConnectSyncWorker>(
                15, TimeUnit.MINUTES
            ).build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                workRequest
            )
            Log.d(TAG, "Background sync scheduled")
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
