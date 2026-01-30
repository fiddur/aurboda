package net.aurboda.update

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class VersionInfo(
    @SerialName("versionCode") val versionCode: Int,
    @SerialName("versionName") val versionName: String,
    @SerialName("downloadUrl") val downloadUrl: String,
    @SerialName("releaseNotes") val releaseNotes: String? = null
)

sealed class UpdateCheckResult {
    data class UpdateAvailable(val versionInfo: VersionInfo) : UpdateCheckResult()
    data object NoUpdate : UpdateCheckResult()
    data class Error(val message: String) : UpdateCheckResult()
}

private val json = Json { ignoreUnknownKeys = true }

suspend fun checkForUpdate(
    httpClient: HttpClient,
    versionJsonUrl: String,
    currentVersionCode: Int
): UpdateCheckResult {
    return try {
        val response = httpClient.get(versionJsonUrl)
        if (response.status != HttpStatusCode.OK) {
            UpdateCheckResult.Error("HTTP ${response.status.value}: Failed to fetch version info")
        } else {
            val body = response.bodyAsText()
            val versionInfo = json.decodeFromString<VersionInfo>(body)
            if (versionInfo.versionCode > currentVersionCode) {
                UpdateCheckResult.UpdateAvailable(versionInfo)
            } else {
                UpdateCheckResult.NoUpdate
            }
        }
    } catch (e: Exception) {
        UpdateCheckResult.Error(e.message ?: "Unknown error checking for updates")
    }
}
