package net.aurboda

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import net.aurboda.api.models.AddMetricBody
import net.aurboda.api.models.AddMetricResponse
import net.aurboda.api.models.GoalsProgressResponse
import net.aurboda.api.models.GoalProgress
import net.aurboda.api.models.UserSettingsResponse

sealed class DataResult<out T> {
    data class Success<T>(val data: T) : DataResult<T>()
    data class Error(val message: String) : DataResult<Nothing>()
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

// --- Add Activity ---

@Serializable
data class AddActivityBody(
    @SerialName("activity_type") val activityType: String,
    @SerialName("start_time") val startTime: String,
    @SerialName("end_time") val endTime: String? = null,
    val title: String? = null,
    val notes: String? = null,
    val data: Map<String, String>? = null,
)

@Serializable
data class AddedActivity(
    val id: String,
    @SerialName("activity_type") val activityType: String,
    @SerialName("start_time") val startTime: String,
    @SerialName("end_time") val endTime: String? = null,
    val title: String? = null,
    val notes: String? = null,
)

@Serializable
data class AddActivityResponse(
    val success: Boolean,
    val data: AddedActivity? = null,
    val error: String? = null,
)

suspend fun postActivity(
    httpClient: HttpClient,
    serverUrl: String,
    authToken: String,
    body: AddActivityBody,
): DataResult<AddActivityResponse> {
    return try {
        val url = "$serverUrl/activities"
        Log.d("DataApi", "Posting activity to: $url")

        val response = httpClient.post(url) {
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
            contentType(ContentType.Application.Json)
            setBody(appJson.encodeToString(AddActivityBody.serializer(), body))
        }

        if (response.status == HttpStatusCode.Created || response.status == HttpStatusCode.OK) {
            val parsed = appJson.decodeFromString<AddActivityResponse>(response.bodyAsText())
            DataResult.Success(parsed)
        } else {
            val errorBody = response.bodyAsText()
            Log.e("DataApi", "Add activity error: ${response.status} - $errorBody")
            DataResult.Error("Server returned ${response.status}")
        }
    } catch (e: Exception) {
        Log.e("DataApi", "Error posting activity", e)
        DataResult.Error(e.message ?: "Unknown error")
    }
}

// --- Add Metric ---

suspend fun postMetric(
    httpClient: HttpClient,
    serverUrl: String,
    authToken: String,
    body: AddMetricBody,
): DataResult<AddMetricResponse> {
    return try {
        val url = "$serverUrl/metrics"
        Log.d("DataApi", "Posting metric to: $url")

        val response = httpClient.post(url) {
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
            contentType(ContentType.Application.Json)
            setBody(appJson.encodeToString(AddMetricBody.serializer(), body))
        }

        if (response.status == HttpStatusCode.Created || response.status == HttpStatusCode.OK) {
            val parsed = appJson.decodeFromString<AddMetricResponse>(response.bodyAsText())
            DataResult.Success(parsed)
        } else {
            val errorBody = response.bodyAsText()
            Log.e("DataApi", "Add metric error: ${response.status} - $errorBody")
            DataResult.Error("Server returned ${response.status}")
        }
    } catch (e: Exception) {
        Log.e("DataApi", "Error posting metric", e)
        DataResult.Error(e.message ?: "Unknown error")
    }
}

// --- Activity Types ---

@Serializable
data class DataFieldDefinition(
    val name: String,
    val type: String,
    val label: String? = null,
    val required: Boolean? = null,
    val unit: String? = null,
    @SerialName("enum_values") val enumValues: List<String>? = null,
    @SerialName("show_in_summary") val showInSummary: Boolean? = null,
)

@Serializable
data class DataSchemaDefinition(
    val fields: List<DataFieldDefinition>,
)

@Serializable
data class ActivityTypeDefinition(
    val name: String,
    @SerialName("display_name") val displayName: String,
    @SerialName("display_category") val displayCategory: String? = null,
    val color: String? = null,
    val icon: String? = null,
    @SerialName("is_builtin") val isBuiltin: Boolean = false,
    @SerialName("data_schema") val dataSchema: DataSchemaDefinition? = null,
)

@Serializable
data class ActivityTypeDefinitionsResponse(
    val success: Boolean,
    val data: List<ActivityTypeDefinition>,
)

suspend fun fetchActivityTypes(
    httpClient: HttpClient,
    serverUrl: String,
    authToken: String,
): DataResult<List<ActivityTypeDefinition>> {
    return try {
        val url = "$serverUrl/activity-types"
        Log.d("DataApi", "Fetching activity types from: $url")

        val response = httpClient.get(url) {
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        }

        if (response.status == HttpStatusCode.OK) {
            val parsed = appJson.decodeFromString<ActivityTypeDefinitionsResponse>(response.bodyAsText())
            DataResult.Success(parsed.data)
        } else {
            Log.e("DataApi", "Activity types error: ${response.status}")
            DataResult.Error("Server returned ${response.status}")
        }
    } catch (e: Exception) {
        Log.e("DataApi", "Error fetching activity types", e)
        DataResult.Error(e.message ?: "Unknown error")
    }
}

// --- Custom Metrics ---

@Serializable
data class CustomMetricDefinition(
    val name: String,
    val unit: String? = null,
    val description: String? = null,
)

@Serializable
data class CustomMetricsListResponse(
    val success: Boolean,
    val data: List<CustomMetricDefinition>? = null,
)

suspend fun fetchCustomMetrics(
    httpClient: HttpClient,
    serverUrl: String,
    authToken: String,
): DataResult<List<CustomMetricDefinition>> {
    return try {
        val url = "$serverUrl/metrics/custom"
        Log.d("DataApi", "Fetching custom metrics from: $url")

        val response = httpClient.get(url) {
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        }

        if (response.status == HttpStatusCode.OK) {
            val parsed = appJson.decodeFromString<CustomMetricsListResponse>(response.bodyAsText())
            DataResult.Success(parsed.data ?: emptyList())
        } else {
            Log.e("DataApi", "Custom metrics error: ${response.status}")
            DataResult.Error("Server returned ${response.status}")
        }
    } catch (e: Exception) {
        Log.e("DataApi", "Error fetching custom metrics", e)
        DataResult.Error(e.message ?: "Unknown error")
    }
}
