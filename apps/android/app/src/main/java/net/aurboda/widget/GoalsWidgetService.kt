package net.aurboda.widget

import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.util.Log
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import kotlinx.coroutines.runBlocking
import net.aurboda.CredentialsManager
import net.aurboda.DataResult
import net.aurboda.R
import net.aurboda.WidgetGoalProgress
import net.aurboda.fetchGoalsProgress
import net.aurboda.formatZoneTime
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import net.aurboda.appJson

// Progress bar colors matching web UI
private const val COLOR_BELOW_MIN = 0xFF757575.toInt()  // Gray
private const val COLOR_MET = 0xFF4CAF50.toInt()        // Green
private const val COLOR_OVER_MAX = 0xFFF44336.toInt()   // Red

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

    private var goals: List<WidgetGoalProgress> = emptyList()

    override fun onCreate() {
        Log.d(TAG, "RemoteViewsFactory created")
    }

    override fun onDataSetChanged() {
        Log.d(TAG, "onDataSetChanged called")
        // Fetch goals synchronously (this runs on a binder thread, not main thread)
        goals = runBlocking { fetchGoals() }
        Log.d(TAG, "Fetched ${goals.size} goals")
    }

    private suspend fun fetchGoals(): List<WidgetGoalProgress> {
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

        // Set fill-in intent for click handling
        val fillInIntent = Intent()
        views.setOnClickFillInIntent(R.id.goal_item_container, fillInIntent)

        // Set label
        val label = metricLabels[goal.title] ?: goal.title
        views.setTextViewText(R.id.goal_label, label)

        // Set current value
        val valueText = formatGoalValue(goal.title, goal.current, goal.unit)
        views.setTextViewText(R.id.goal_value, valueText)

        // Set "losing tomorrow" text
        if (goal.losingTomorrow > 0) {
            val losingText = "(-${formatGoalValue(goal.title, goal.losingTomorrow, goal.unit)} tomorrow)"
            views.setTextViewText(R.id.goal_losing, losingText)
        } else {
            views.setTextViewText(R.id.goal_losing, "")
        }

        // Calculate progress percentage
        val target = goal.max ?: goal.min ?: 1.0
        val progressPercent = (goal.current / target) * 100
        val cappedProgress = progressPercent.coerceIn(0.0, 100.0).toInt()
        views.setProgressBar(R.id.goal_progress, 100, cappedProgress, false)

        // Determine progress bar color based on goal status
        val progressColor = getProgressColor(goal)
        views.setColorStateList(
            R.id.goal_progress,
            "setProgressTintList",
            ColorStateList.valueOf(progressColor)
        )

        // Show min-marker when both min and max are set
        if (goal.min != null && goal.max != null && goal.max > 0) {
            val minPercent = (goal.min / goal.max).toFloat()
            views.setViewVisibility(R.id.min_marker, View.VISIBLE)
            // COMPLEX_UNIT_FRACTION_PARENT doesn't work correctly in RemoteViews
            // Calculate an approximate dp position based on typical widget width
            // (widget width ~280dp minus padding, progress bar takes full width)
            val estimatedProgressBarWidthDp = 260f
            val markerPositionDp = minPercent * estimatedProgressBarWidthDp
            views.setViewLayoutMargin(
                R.id.min_marker,
                RemoteViews.MARGIN_START,
                markerPositionDp,
                TypedValue.COMPLEX_UNIT_DIP
            )
        } else {
            views.setViewVisibility(R.id.min_marker, View.GONE)
        }

        // Handle overflow (progress > 100%)
        if (progressPercent > 100) {
            val overflow = (progressPercent - 100).coerceIn(0.0, 100.0).toInt()
            views.setViewVisibility(R.id.goal_overflow, View.VISIBLE)
            views.setProgressBar(R.id.goal_overflow, 100, overflow, false)
            // Overflow bar uses same color
            views.setColorStateList(
                R.id.goal_overflow,
                "setProgressTintList",
                ColorStateList.valueOf(progressColor)
            )
        } else {
            views.setViewVisibility(R.id.goal_overflow, View.GONE)
        }

        return views
    }

    /**
     * Determine progress bar color based on goal status.
     * Matches the web UI color scheme.
     */
    private fun getProgressColor(goal: WidgetGoalProgress): Int {
        val min = goal.min
        val max = goal.max
        val current = goal.current

        return when {
            // Min-max goal
            min != null && max != null -> when {
                current >= max -> COLOR_OVER_MAX
                current >= min -> COLOR_MET
                else -> COLOR_BELOW_MIN
            }
            // Min-only goal
            min != null -> if (current >= min) COLOR_MET else COLOR_BELOW_MIN
            // Max-only goal
            max != null -> if (current > max) COLOR_OVER_MAX else COLOR_MET
            // No targets (shouldn't happen)
            else -> COLOR_MET
        }
    }

    private fun formatGoalValue(metric: String, value: Double, unit: String): String {
        return when (unit) {
            "sec", "seconds" -> formatZoneTime(value)
            "count" -> value.toLong().toString()
            "m" -> "${(value / 1000).toInt()} km"
            else -> {
                // Show decimals for small values (trend goals like "0.7 per month")
                val formatted = if (value < 100 && value != value.toLong().toDouble()) {
                    "%.1f".format(value)
                } else {
                    value.toLong().toString()
                }
                "$formatted $unit"
            }
        }
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 1

    override fun getItemId(position: Int): Long = position.toLong()

    override fun hasStableIds(): Boolean = false
}
