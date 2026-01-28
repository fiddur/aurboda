package net.aurboda.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.RemoteViews
import net.aurboda.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import net.aurboda.CredentialsManager
import net.aurboda.DataResult
import net.aurboda.R
import net.aurboda.fetchPeriodSummary
import net.aurboda.findMetricTimeSeconds
import net.aurboda.formatZoneTime
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import net.aurboda.appJson
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

private const val TAG = "HrZoneWidgetProvider"

// Widget targets: Zone 2 min 150, max 200; Zone 5 min 5, max 10
private const val ZONE_2_TARGET_MIN = 150
private const val ZONE_5_TARGET_MIN = 5

class HrZoneWidgetProvider : AppWidgetProvider() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        Log.d(TAG, "onUpdate called for ${appWidgetIds.size} widgets")
        for (appWidgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_UPDATE_WIDGETS) {
            Log.d(TAG, "Received update broadcast")
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val componentName = ComponentName(context, HrZoneWidgetProvider::class.java)
            val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)
            onUpdate(context, appWidgetManager, appWidgetIds)
        }
    }

    private fun updateWidget(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int
    ) {
        scope.launch {
            val views = RemoteViews(context.packageName, R.layout.widget_hr_zones)

            // Set up click handler to open the app on the Data tab
            val openAppIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(MainActivity.EXTRA_OPEN_TAB, MainActivity.TAB_DATA)
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                appWidgetId,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_container, pendingIntent)

            val credentials = CredentialsManager.getCredentials(context)
            if (credentials == null) {
                Log.w(TAG, "No credentials, showing empty widget")
                setWidgetData(views, 0.0, 0.0)
                appWidgetManager.updateAppWidget(appWidgetId, views)
                return@launch
            }

            val httpClient = HttpClient(Android) {
                install(ContentNegotiation) { json(appJson) }
            }

            try {
                val hrZoneData = fetchHrZoneData(httpClient, credentials)
                setWidgetData(views, hrZoneData.zone2Seconds, hrZoneData.zone5Seconds)
            } catch (e: Exception) {
                Log.e(TAG, "Error fetching HR zone data", e)
                // Keep existing data or show zeros
                setWidgetData(views, 0.0, 0.0)
            } finally {
                httpClient.close()
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }

    private suspend fun fetchHrZoneData(
        httpClient: HttpClient,
        credentials: CredentialsManager.Credentials
    ): HrZoneData {
        val today = LocalDate.now()
        val weekAgo = today.minusDays(6) // 7 days including today

        val formatter = DateTimeFormatter.ISO_INSTANT
        val startInstant = weekAgo.atStartOfDay().toInstant(ZoneOffset.UTC)
        val endInstant = today.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC)

        val start = formatter.format(startInstant)
        val end = formatter.format(endInstant)

        val metrics = listOf("hr_zone_2_sec", "hr_zone_5_sec")

        val result = fetchPeriodSummary(
            httpClient,
            credentials.apiUrl,
            credentials.authToken,
            start,
            end,
            metrics
        )

        return when (result) {
            is DataResult.Success -> {
                val zone2Seconds = findMetricTimeSeconds(result.data.metrics, "hr_zone_2_sec")
                val zone5Seconds = findMetricTimeSeconds(result.data.metrics, "hr_zone_5_sec")
                Log.d(TAG, "Fetched HR zone data: zone2=$zone2Seconds sec, zone5=$zone5Seconds sec")
                HrZoneData(zone2Seconds, zone5Seconds)
            }
            is DataResult.Error -> {
                Log.e(TAG, "Error fetching period summary: ${result.message}")
                HrZoneData(0.0, 0.0)
            }
        }
    }

    private fun setWidgetData(views: RemoteViews, zone2Seconds: Double, zone5Seconds: Double) {
        val zone2Minutes = (zone2Seconds / 60.0).toInt()
        val zone5Minutes = (zone5Seconds / 60.0).toInt()

        // Calculate progress as percentage (0-100)
        val zone2Progress = ((zone2Minutes.toFloat() / ZONE_2_TARGET_MIN) * 100).coerceIn(0f, 100f).toInt()
        val zone5Progress = ((zone5Minutes.toFloat() / ZONE_5_TARGET_MIN) * 100).coerceIn(0f, 100f).toInt()

        // Set time text
        views.setTextViewText(R.id.zone2_time, formatZoneTime(zone2Seconds))
        views.setTextViewText(R.id.zone5_time, formatZoneTime(zone5Seconds))

        // Set progress bar values
        views.setProgressBar(R.id.zone2_progress, 100, zone2Progress, false)
        views.setProgressBar(R.id.zone5_progress, 100, zone5Progress, false)
    }

    companion object {
        const val ACTION_UPDATE_WIDGETS = "net.aurboda.ACTION_UPDATE_HR_ZONE_WIDGETS"

        /**
         * Trigger an update of all HR Zone widgets.
         * Call this after background sync completes.
         */
        fun triggerUpdate(context: Context) {
            val intent = Intent(context, HrZoneWidgetProvider::class.java).apply {
                action = ACTION_UPDATE_WIDGETS
            }
            context.sendBroadcast(intent)
        }
    }
}

private data class HrZoneData(
    val zone2Seconds: Double,
    val zone5Seconds: Double
)
