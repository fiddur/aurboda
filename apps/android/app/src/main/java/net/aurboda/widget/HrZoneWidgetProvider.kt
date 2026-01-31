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
import net.aurboda.fetchGoalsProgress
import net.aurboda.formatZoneTime
import net.aurboda.GoalProgress
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import net.aurboda.appJson

private const val TAG = "HrZoneWidgetProvider"

// Friendly names for metrics
private val metricLabels = mapOf(
    "hr_zone_0_sec" to "Zone 0",
    "hr_zone_1_sec" to "Zone 1",
    "hr_zone_2_sec" to "Zone 2",
    "hr_zone_3_sec" to "Zone 3",
    "hr_zone_4_sec" to "Zone 4",
    "hr_zone_5_sec" to "Zone 5",
    "steps" to "Steps",
    "distance" to "Distance",
    "calories_active" to "Calories"
)

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
                setEmptyWidget(views)
                appWidgetManager.updateAppWidget(appWidgetId, views)
                return@launch
            }

            val httpClient = HttpClient(Android) {
                install(ContentNegotiation) { json(appJson) }
            }

            try {
                val goalsResult = fetchGoalsProgress(
                    httpClient,
                    credentials.apiUrl,
                    credentials.authToken
                )

                when (goalsResult) {
                    is DataResult.Success -> {
                        val goals = goalsResult.data.goals
                        Log.d(TAG, "Fetched ${goals.size} goals")
                        setWidgetData(views, goals)
                    }
                    is DataResult.Error -> {
                        Log.e(TAG, "Error fetching goals: ${goalsResult.message}")
                        setEmptyWidget(views)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error fetching goal data", e)
                setEmptyWidget(views)
            } finally {
                httpClient.close()
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }

    private fun setEmptyWidget(views: RemoteViews) {
        views.setTextViewText(R.id.zone2_label, "Zone 2")
        views.setTextViewText(R.id.zone2_time, "-- min")
        views.setTextViewText(R.id.zone2_losing, "")
        views.setProgressBar(R.id.zone2_progress, 100, 0, false)

        views.setTextViewText(R.id.zone5_label, "Zone 5")
        views.setTextViewText(R.id.zone5_time, "-- min")
        views.setTextViewText(R.id.zone5_losing, "")
        views.setProgressBar(R.id.zone5_progress, 100, 0, false)
    }

    private fun setWidgetData(views: RemoteViews, goals: List<GoalProgress>) {
        // Find Zone 2 and Zone 5 goals, or use first two goals
        val zone2Goal = goals.find { it.metric == "hr_zone_2_sec" }
        val zone5Goal = goals.find { it.metric == "hr_zone_5_sec" }

        // If specific zones not found, use first two goals
        val goal1 = zone2Goal ?: goals.getOrNull(0)
        val goal2 = zone5Goal ?: goals.getOrNull(1)

        // Set Goal 1 (Zone 2 slot)
        if (goal1 != null) {
            setGoalView(
                views,
                goal1,
                R.id.zone2_label,
                R.id.zone2_time,
                R.id.zone2_losing,
                R.id.zone2_progress
            )
        } else {
            views.setTextViewText(R.id.zone2_label, "No Goal")
            views.setTextViewText(R.id.zone2_time, "--")
            views.setTextViewText(R.id.zone2_losing, "")
            views.setProgressBar(R.id.zone2_progress, 100, 0, false)
        }

        // Set Goal 2 (Zone 5 slot)
        if (goal2 != null) {
            setGoalView(
                views,
                goal2,
                R.id.zone5_label,
                R.id.zone5_time,
                R.id.zone5_losing,
                R.id.zone5_progress
            )
        } else {
            views.setTextViewText(R.id.zone5_label, "No Goal")
            views.setTextViewText(R.id.zone5_time, "--")
            views.setTextViewText(R.id.zone5_losing, "")
            views.setProgressBar(R.id.zone5_progress, 100, 0, false)
        }
    }

    private fun setGoalView(
        views: RemoteViews,
        goal: GoalProgress,
        labelId: Int,
        timeId: Int,
        losingId: Int,
        progressId: Int
    ) {
        // Set label
        val label = metricLabels[goal.metric] ?: goal.metric
        views.setTextViewText(labelId, label)

        // Set current value
        val valueText = formatGoalValue(goal.metric, goal.current, goal.unit)
        views.setTextViewText(timeId, valueText)

        // Set "losing tomorrow" text
        if (goal.losingTomorrow > 0) {
            val losingText = "(-${formatGoalValue(goal.metric, goal.losingTomorrow, goal.unit)} tomorrow)"
            views.setTextViewText(losingId, losingText)
        } else {
            views.setTextViewText(losingId, "")
        }

        // Calculate progress percentage
        val target = goal.max ?: goal.min ?: 1.0
        val progress = ((goal.current / target) * 100).coerceIn(0.0, 100.0).toInt()
        views.setProgressBar(progressId, 100, progress, false)
    }

    private fun formatGoalValue(metric: String, value: Double, unit: String): String {
        return when (unit) {
            "sec", "seconds" -> formatZoneTime(value)
            "count" -> value.toLong().toString()
            "m" -> "${(value / 1000).toInt()} km"
            else -> "${value.toInt()} $unit"
        }
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
