package net.aurboda

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import net.aurboda.api.models.GoalsProgressResponse
import net.aurboda.api.models.GoalProgress
import net.aurboda.api.models.HrZoneThresholdsOutput
import net.aurboda.api.models.PeriodMetricStats
import net.aurboda.api.models.PeriodSummaryResponse
import net.aurboda.api.models.UserSettingsResponse

sealed class DataResult<out T> {
    data class Success<T>(val data: T) : DataResult<T>()
    data class Error(val message: String) : DataResult<Nothing>()
}

suspend fun fetchPeriodSummary(
    httpClient: HttpClient,
    serverUrl: String,
    authToken: String,
    start: String,
    end: String,
    metrics: List<String>
): DataResult<PeriodSummaryResponse> {
    return try {
        val metricsParam = metrics.joinToString(",")
        val url = "$serverUrl/period-summary?start=$start&end=$end&metrics=$metricsParam"
        Log.d("DataApi", "Fetching period summary from: $url")

        val response = httpClient.get(url) {
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        }

        if (response.status == HttpStatusCode.OK) {
            val body = response.bodyAsText()
            Log.d("DataApi", "Period summary response: $body")
            val parsed = appJson.decodeFromString<PeriodSummaryResponse>(body)
            DataResult.Success(parsed)
        } else {
            Log.e("DataApi", "Period summary error: ${response.status}")
            DataResult.Error("Server returned ${response.status}")
        }
    } catch (e: Exception) {
        Log.e("DataApi", "Error fetching period summary", e)
        DataResult.Error(e.message ?: "Unknown error")
    }
}

suspend fun fetchUserSettings(
    httpClient: HttpClient,
    serverUrl: String,
    authToken: String
): DataResult<UserSettingsResponse> {
    return try {
        val url = "$serverUrl/user/settings"
        Log.d("DataApi", "Fetching user settings from: $url")

        val response = httpClient.get(url) {
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        }

        if (response.status == HttpStatusCode.OK) {
            val body = response.bodyAsText()
            Log.d("DataApi", "User settings response: $body")
            val parsed = appJson.decodeFromString<UserSettingsResponse>(body)
            DataResult.Success(parsed)
        } else {
            Log.e("DataApi", "User settings error: ${response.status}")
            DataResult.Error("Server returned ${response.status}")
        }
    } catch (e: Exception) {
        Log.e("DataApi", "Error fetching user settings", e)
        DataResult.Error(e.message ?: "Unknown error")
    }
}

suspend fun fetchGoalsProgress(
    httpClient: HttpClient,
    serverUrl: String,
    authToken: String
): DataResult<GoalsProgressResponse> {
    return try {
        val url = "$serverUrl/goals/progress"
        Log.d("DataApi", "Fetching goals progress from: $url")

        val response = httpClient.get(url) {
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        }

        if (response.status == HttpStatusCode.OK) {
            val body = response.bodyAsText()
            Log.d("DataApi", "Goals progress response: $body")
            val parsed = appJson.decodeFromString<GoalsProgressResponse>(body)
            DataResult.Success(parsed)
        } else {
            Log.e("DataApi", "Goals progress error: ${response.status}")
            DataResult.Error("Server returned ${response.status}")
        }
    } catch (e: Exception) {
        Log.e("DataApi", "Error fetching goals progress", e)
        DataResult.Error(e.message ?: "Unknown error")
    }
}

val defaultHrZoneThresholds = HrZoneThresholdsOutput(
    _1 = 86,
    _2 = 102,
    _3 = 118,
    _4 = 135,
    _5 = 151
)

val hrZoneWeeklyTargetMinutes = listOf(0, 60, 200, 60, 30, 10)

fun formatZoneTime(seconds: Double): String {
    val totalMinutes = (seconds / 60).toInt()
    return if (totalMinutes >= 60) {
        val hours = totalMinutes / 60
        val mins = totalMinutes % 60
        if (mins > 0) "$hours h $mins min" else "$hours h"
    } else {
        "$totalMinutes min"
    }
}

fun formatBpmRange(zoneIndex: Int, thresholds: HrZoneThresholdsOutput): String {
    val zoneStarts = listOf(0, thresholds._1, thresholds._2, thresholds._3, thresholds._4, thresholds._5)
    return when (zoneIndex) {
        0 -> "< ${thresholds._1} bpm"
        5 -> "${thresholds._5}+ bpm"
        else -> "${zoneStarts[zoneIndex]} - ${zoneStarts[zoneIndex + 1] - 1} bpm"
    }
}

fun getMetricTimeSeconds(metric: PeriodMetricStats): Double = metric.avg

fun findMetricTimeSeconds(metrics: List<PeriodMetricStats>, metricName: String): Double =
    metrics.find { it.metric == metricName }?.let { getMetricTimeSeconds(it) } ?: 0.0
