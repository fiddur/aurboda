package net.aurboda

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class PeriodMetricStats(
    val metric: String,
    val unit: String,
    val avg: Double? = null,
    val min: Double? = null,
    val max: Double? = null,
    val sum: Double? = null,
    val count: Int? = null,
    val stddev: Double? = null,
    val trend: Double? = null,
    @SerialName("data_points") val dataPoints: Int? = null
)

@Serializable
data class PeriodSummaryResponse(
    val success: Boolean,
    val metrics: List<PeriodMetricStats>,
    @SerialName("period_start") val periodStart: String? = null,
    @SerialName("period_end") val periodEnd: String? = null
)

@Serializable
data class HrZoneThresholds(
    @SerialName("1") val zone1: Int,
    @SerialName("2") val zone2: Int,
    @SerialName("3") val zone3: Int,
    @SerialName("4") val zone4: Int,
    @SerialName("5") val zone5: Int
)

@Serializable
data class UserSettingsResponse(
    val success: Boolean,
    @SerialName("hr_zone_start") val hrZoneStart: HrZoneThresholds? = null,
    @SerialName("birth_date") val birthDate: String? = null
)

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

val defaultHrZoneThresholds = HrZoneThresholds(
    zone1 = 86,
    zone2 = 102,
    zone3 = 118,
    zone4 = 135,
    zone5 = 151
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

fun formatBpmRange(zoneIndex: Int, thresholds: HrZoneThresholds): String {
    val zoneStarts = listOf(0, thresholds.zone1, thresholds.zone2, thresholds.zone3, thresholds.zone4, thresholds.zone5)
    return when (zoneIndex) {
        0 -> "< ${thresholds.zone1} bpm"
        5 -> "${thresholds.zone5}+ bpm"
        else -> "${zoneStarts[zoneIndex]} - ${zoneStarts[zoneIndex + 1] - 1} bpm"
    }
}

fun getMetricTimeSeconds(metric: PeriodMetricStats): Double = metric.avg ?: 0.0

fun findMetricTimeSeconds(metrics: List<PeriodMetricStats>, metricName: String): Double =
    metrics.find { it.metric == metricName }?.let { getMetricTimeSeconds(it) } ?: 0.0
