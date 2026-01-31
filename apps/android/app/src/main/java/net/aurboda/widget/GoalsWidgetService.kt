package net.aurboda.widget

import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import kotlinx.coroutines.runBlocking
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

private const val TAG = "GoalsWidgetService"

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


class GoalsWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return GoalsRemoteViewsFactory(applicationContext)
    }
}

class GoalsRemoteViewsFactory(private val context: Context) : RemoteViewsService.RemoteViewsFactory {

    private var goals: List<GoalProgress> = emptyList()

    override fun onCreate() {
        Log.d(TAG, "RemoteViewsFactory created")
    }

    override fun onDataSetChanged() {
        Log.d(TAG, "onDataSetChanged called")
        // Fetch goals synchronously (this runs on a binder thread, not main thread)
        goals = runBlocking { fetchGoals() }
        Log.d(TAG, "Fetched ${goals.size} goals")
    }

    private suspend fun fetchGoals(): List<GoalProgress> {
        val credentials = CredentialsManager.getCredentials(context) ?: return emptyList()

        val httpClient = HttpClient(Android) {
            install(ContentNegotiation) { json(appJson) }
        }

        return try {
            when (val result = fetchGoalsProgress(httpClient, credentials.apiUrl, credentials.authToken)) {
                is DataResult.Success -> result.data.goals
                is DataResult.Error -> {
                    Log.e(TAG, "Error fetching goals: ${result.message}")
                    emptyList()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Exception fetching goals", e)
            emptyList()
        } finally {
            httpClient.close()
        }
    }

    override fun onDestroy() {
        goals = emptyList()
    }

    override fun getCount(): Int = goals.size

    override fun getViewAt(position: Int): RemoteViews {
        val goal = goals.getOrNull(position)
            ?: return RemoteViews(context.packageName, R.layout.widget_goal_item)

        val views = RemoteViews(context.packageName, R.layout.widget_goal_item)

        // Set label
        val label = metricLabels[goal.metric] ?: goal.metric
        views.setTextViewText(R.id.goal_label, label)

        // Set current value
        val valueText = formatGoalValue(goal.metric, goal.current, goal.unit)
        views.setTextViewText(R.id.goal_value, valueText)

        // Set "losing tomorrow" text
        if (goal.losingTomorrow > 0) {
            val losingText = "(-${formatGoalValue(goal.metric, goal.losingTomorrow, goal.unit)} tomorrow)"
            views.setTextViewText(R.id.goal_losing, losingText)
        } else {
            views.setTextViewText(R.id.goal_losing, "")
        }

        // Calculate progress percentage
        val target = goal.max ?: goal.min ?: 1.0
        val progress = ((goal.current / target) * 100).coerceIn(0.0, 100.0).toInt()
        views.setProgressBar(R.id.goal_progress, 100, progress, false)

        return views
    }

    private fun formatGoalValue(metric: String, value: Double, unit: String): String {
        return when (unit) {
            "sec", "seconds" -> formatZoneTime(value)
            "count" -> value.toLong().toString()
            "m" -> "${(value / 1000).toInt()} km"
            else -> "${value.toInt()} $unit"
        }
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 1

    override fun getItemId(position: Int): Long = position.toLong()

    override fun hasStableIds(): Boolean = false
}
