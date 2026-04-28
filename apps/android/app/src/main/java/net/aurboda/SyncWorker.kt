package net.aurboda

import android.content.Context
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.records.*
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
import io.ktor.serialization.kotlinx.json.json
import net.aurboda.widget.HrZoneWidgetProvider
import java.util.concurrent.TimeUnit
import kotlin.reflect.KClass

private const val TAG = "SyncWorker"
private const val PREFS_NAME = "AurbodaAppPrefs"
private const val CHANGES_TOKEN_KEY = "healthConnectChangesToken"
private const val GRANTED_TYPES_KEY = "grantedRecordTypeNames"
private const val WORK_NAME = "health_connect_sync"

class SyncWorker(
  context: Context,
  params: WorkerParameters,
) : CoroutineWorker(context, params) {
  private val healthConnectClient by lazy { HealthConnectClient.getOrCreate(applicationContext) }
  private val httpClient by lazy {
    HttpClient(Android) {
      install(ContentNegotiation) { json(appJson) }
    }
  }

  override suspend fun doWork(): Result {
    Log.d(TAG, "Starting background sync")
    val reporter = applicationContext.syncProgressReporter()

    val credentials = CredentialsManager.getCredentials(applicationContext)
    if (credentials == null) {
      Log.w(TAG, "No credentials found, skipping sync")
      return Result.success()
    }

    // Check permissions -- proceed with whatever is granted (partial permissions support)
    val grantedPermissions = healthConnectClient.permissionController.getGrantedPermissions()
    val grantedTypes = getGrantedRecordTypes(grantedPermissions)
    if (grantedTypes.isEmpty()) {
      Log.w(TAG, "No permissions granted, skipping sync")
      return Result.success()
    }
    Log.d(TAG, "Granted ${grantedTypes.size}/${allRecordTypes.size} record types")

    // Invalidate token if granted types changed since last sync
    invalidateTokenIfGrantedTypesChanged(grantedTypes)

    reporter.begin()
    return try {
      // Step 0: Process pending local data entries (Add Data offline queue)
      processPendingData(credentials.apiUrl, credentials.authToken, reporter)

      // Step 1: Fetch and send daily aggregates for cumulative metrics (deduplicated)
      val aggregates = fetchDailyAggregates(healthConnectClient, grantedTypes.toSet(), days = 7)
      if (aggregates.isNotEmpty()) {
        val aggregateSuccess = sendDailyAggregates(aggregates, credentials.apiUrl, credentials.authToken, httpClient, reporter)
        if (!aggregateSuccess) {
          Log.w(TAG, "Failed to send daily aggregates, will retry")
          reporter.end("Daily aggregates failed")
          return Result.retry()
        }
        Log.d(TAG, "Sent ${aggregates.size} daily aggregates")
      } else {
        reporter.updateStage(SyncStage.DailyAggregates) {
          it.copy(status = SyncStageStatus.Done, message = "Nothing to send")
        }
      }

      // Step 2: Fetch and send raw records incrementally (page by page)
      val syncSuccess = fetchAndSyncHealthData(credentials.apiUrl, credentials.authToken, reporter)
      if (!syncSuccess) {
        Log.w(TAG, "Incremental sync failed, will retry")
        reporter.end("Health Connect sync failed")
        return Result.retry()
      }

      // Step 3: Process outbound sync (backend -> Health Connect).
      // Reuses grantedPermissions from step 0 above -- permissions don't change mid-sync.
      try {
        processOutboundSync(
          apiUrl = credentials.apiUrl,
          authToken = credentials.authToken,
          httpClient = httpClient,
          healthConnectClient = healthConnectClient,
          grantedPermissions = grantedPermissions,
          reporter = reporter,
        )
      } catch (e: Exception) {
        Log.w(TAG, "Outbound sync failed: ${e.message}")
        reporter.updateStage(SyncStage.Outbound) {
          it.copy(status = SyncStageStatus.Failed, errorMessage = e.message)
        }
      }

      // Step 4: ActivityWatch sync (if enabled).
      // Best-effort: failures don't affect overall sync result.
      if (isActivityWatchSyncEnabled(applicationContext)) {
        try {
          processActivityWatchSync(
            apiUrl = credentials.apiUrl,
            authToken = credentials.authToken,
            httpClient = httpClient,
            context = applicationContext,
          )
        } catch (e: Exception) {
          Log.w(TAG, "ActivityWatch sync failed: ${e.message}")
        }
      }

      HrZoneWidgetProvider.triggerUpdate(applicationContext)
      reporter.end()
      Result.success()
    } catch (e: Exception) {
      Log.e(TAG, "Background sync failed", e)
      reporter.end(e.message)
      Result.retry()
    }
  }

  /**
   * Process pending local data entries (activities and metrics queued offline).
   * Successfully sent entries are removed; failures are left for the next sync cycle.
   */
  private suspend fun processPendingData(serverUrl: String, authToken: String, reporter: SyncProgressReporter) {
    val entries = getPendingEntries(applicationContext)
    if (entries.isEmpty()) {
      reporter.updateStage(SyncStage.PendingData) {
        it.copy(status = SyncStageStatus.Done, message = "No queued entries")
      }
      return
    }
    Log.d(TAG, "Processing ${entries.size} pending data entries")
    reporter.updateStage(SyncStage.PendingData) {
      it.copy(
        status = SyncStageStatus.Active,
        message = "Uploading ${entries.size} queued ${if (entries.size == 1) "entry" else "entries"}",
        sentRecords = 0,
      )
    }
    var sent = 0
    var failed = 0

    for (entry in entries) {
      val result = when (val data = entry.data) {
        is PendingPayload.Activity -> {
          val body = AddActivityBody(
            activityType = data.payload.activity_type,
            startTime = data.payload.start_time,
            endTime = data.payload.end_time,
            title = data.payload.title,
            notes = data.payload.notes,
            data = data.payload.data,
          )
          postActivity(httpClient, serverUrl, authToken, body)
        }
        is PendingPayload.Metric -> {
          val body = net.aurboda.api.models.AddMetricBody(
            metric = data.payload.metric,
            value = data.payload.value,
            time = data.payload.time,
          )
          postMetric(httpClient, serverUrl, authToken, body)
        }
      }
      when (result) {
        is DataResult.Success<*> -> {
          removePendingEntry(applicationContext, entry.id)
          Log.d(TAG, "Pending entry ${entry.id} synced successfully")
          sent++
          reporter.updateStage(SyncStage.PendingData) { it.copy(sentRecords = sent) }
        }
        is DataResult.Error -> {
          markPendingEntryFailed(applicationContext, entry.id, result.message)
          Log.w(TAG, "Pending entry ${entry.id} failed: ${result.message}")
          failed++
        }
      }
    }
    reporter.updateStage(SyncStage.PendingData) {
      it.copy(
        status = if (failed == 0) SyncStageStatus.Done else SyncStageStatus.Failed,
        message = "$sent uploaded, $failed failed",
      )
    }
  }

  /**
   * Fetch Health Connect changes page by page and send each page immediately.
   * After each successful send, the intermediate changes token is saved so that
   * already-sent pages are never re-fetched on retry.
   *
   * Background worker skips initial fetch (no token) -- that must be done in foreground.
   */
  private suspend fun fetchAndSyncHealthData(
    serverUrl: String,
    authToken: String,
    reporter: SyncProgressReporter,
  ): Boolean {
    val lastToken = loadChangesToken()
    if (lastToken == null) {
      Log.d(TAG, "No token found, skipping background fetch (initial fetch should be done in foreground)")
      reporter.updateStage(SyncStage.HealthConnect) {
        it.copy(status = SyncStageStatus.Skipped, message = "Initial fetch must run in foreground")
      }
      return true
    }

    reporter.updateStage(SyncStage.HealthConnect) {
      it.copy(status = SyncStageStatus.Active, message = "Fetching incremental changes…", sentRecords = 0, sentDeletions = 0)
    }

    var currentToken: String = lastToken
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
        Log.d(TAG, "Page $pageNum: ${upsertions.size} records, ${deletionIds.size} deletions")
        upsertions.oldestEventInstant()?.let(reporter::reportDataInstant)
        reporter.updateStage(SyncStage.HealthConnect) {
          it.copy(
            currentPage = pageNum,
            message = "Page $pageNum (${upsertions.size} records, ${deletionIds.size} deletions)",
          )
        }
        val result = sendPage(upsertions, deletionIds, serverUrl, authToken, httpClient, reporter, TAG)
        if (!result.isSuccess) {
          Log.w(TAG, "Page $pageNum failed: ${result.errorMessage()}, will retry from saved token")
          reporter.updateStage(SyncStage.HealthConnect) {
            it.copy(status = SyncStageStatus.Failed, errorMessage = result.errorMessage())
          }
          return false
        }
        totalRecords += upsertions.size
        totalDeletions += deletionIds.size
        reporter.updateStage(SyncStage.HealthConnect) {
          it.copy(sentRecords = totalRecords, sentDeletions = totalDeletions)
        }
      }

      // Save intermediate token -- this page is permanently done
      currentToken = changesResponse.nextChangesToken
      saveChangesToken(currentToken)
      hasMore = changesResponse.hasMore
    }

    if (totalRecords > 0 || totalDeletions > 0) {
      Log.d(TAG, "Incremental sync complete: $totalRecords records, $totalDeletions deletions across $pageNum pages")
      reporter.updateStage(SyncStage.HealthConnect) {
        it.copy(
          status = SyncStageStatus.Done,
          totalPages = pageNum,
          message = "$totalRecords records, $totalDeletions deletions ($pageNum pages)",
        )
      }
    } else {
      Log.d(TAG, "No new inbound data to sync")
      reporter.updateStage(SyncStage.HealthConnect) {
        it.copy(status = SyncStageStatus.Done, message = "Up to date")
      }
    }
    return true
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

  /**
   * Check if granted types changed and invalidate the changes token if so.
   */
  private fun invalidateTokenIfGrantedTypesChanged(currentGrantedTypes: List<KClass<out Record>>) {
    val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val currentNames = currentGrantedTypes.map { it.simpleName ?: "" }.sorted().joinToString(",")
    val savedNames = prefs.getString(GRANTED_TYPES_KEY, null)

    if (savedNames != null && savedNames != currentNames) {
      Log.d(TAG, "Granted types changed, invalidating changes token")
      prefs
        .edit()
        .remove(CHANGES_TOKEN_KEY)
        .putString(GRANTED_TYPES_KEY, currentNames)
        .apply()
    } else {
      prefs.edit().putString(GRANTED_TYPES_KEY, currentNames).apply()
    }
  }

  companion object {
    /**
     * Schedule periodic background sync.
     * Sync runs every 15 minutes (minimum interval for periodic work).
     */
    fun schedule(context: Context) {
      val constraints =
        Constraints
          .Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build()

      val workRequest =
        PeriodicWorkRequestBuilder<SyncWorker>(
          15,
          TimeUnit.MINUTES,
        ).setConstraints(constraints)
          .build()

      WorkManager.getInstance(context).enqueueUniquePeriodicWork(
        WORK_NAME,
        ExistingPeriodicWorkPolicy.UPDATE,
        workRequest,
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
