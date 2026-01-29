package net.aurboda

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType

const val SYNC_UTILS_TAG = "SyncUtils"

/** Result of a POST operation with error details for display */
sealed class PostResult {
    data object Success : PostResult()
    data class HttpError(val statusCode: Int, val statusDescription: String) : PostResult()
    data class NetworkError(val message: String) : PostResult()

    val isSuccess: Boolean get() = this is Success

    fun errorMessage(): String? = when (this) {
        is Success -> null
        is HttpError -> "HTTP $statusCode $statusDescription"
        is NetworkError -> "Network error: $message"
    }
}

/**
 * Post a single chunk of data to the server.
 * This is the core posting logic used by both regular and chunked posting.
 *
 * Note: Must be inline with reified T to preserve type information for serialization.
 */
suspend inline fun <reified T : Any> postChunk(
    data: PostWrapper<T>,
    apiUrl: String,
    authToken: String,
    httpClient: HttpClient,
    logTag: String = SYNC_UTILS_TAG
): PostResult {
    return try {
        val response = httpClient.post(apiUrl) {
            contentType(ContentType.Application.Json)
            headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
            setBody(data)
        }
        if (response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created) {
            Log.d(logTag, "POST successful: ${response.status}")
            PostResult.Success
        } else {
            Log.e(logTag, "POST failed: HTTP ${response.status.value} ${response.status.description}")
            PostResult.HttpError(response.status.value, response.status.description)
        }
    } catch (e: Exception) {
        Log.e(logTag, "POST error: ${e.message}", e)
        PostResult.NetworkError(e.message ?: "Unknown error")
    }
}

/**
 * Post data in chunks to avoid 413 Request Entity Too Large errors.
 * HeartRateRecord can be very large (thousands of samples per record).
 *
 * @param dataList The list of records to post
 * @param apiUrl The URL to post to
 * @param authToken The auth token for the request
 * @param httpClient The HTTP client to use
 * @param chunkSize Maximum number of records per chunk (default 10)
 * @param recordTypeName Name of the record type for logging
 * @param logTag Tag for log messages
 * @return PostResult.Success if all chunks succeed, or the first error encountered
 *
 * Note: Must be inline with reified T to preserve type information for serialization.
 */
suspend inline fun <reified T : Any> postDataChunked(
    dataList: List<T>,
    apiUrl: String,
    authToken: String,
    httpClient: HttpClient,
    chunkSize: Int = 10,
    recordTypeName: String = "data",
    logTag: String = SYNC_UTILS_TAG
): PostResult {
    if (dataList.isEmpty()) {
        Log.d(logTag, "No $recordTypeName to send")
        return PostResult.Success
    }

    val chunks = dataList.chunked(chunkSize)
    Log.d(logTag, "Sending $recordTypeName in ${chunks.size} chunks of up to $chunkSize records each")

    for ((index, chunk) in chunks.withIndex()) {
        val chunkNum = index + 1
        Log.d(logTag, "Sending $recordTypeName chunk $chunkNum/${chunks.size} with ${chunk.size} records")

        val result = postChunk(
            data = PostWrapper(chunk),
            apiUrl = apiUrl,
            authToken = authToken,
            httpClient = httpClient,
            logTag = logTag
        )

        if (!result.isSuccess) {
            Log.e(logTag, "$recordTypeName chunk $chunkNum failed: ${result.errorMessage()}")
            return result
        }

        Log.d(logTag, "$recordTypeName chunk $chunkNum succeeded")
    }

    Log.d(logTag, "All ${chunks.size} chunks of $recordTypeName sent successfully")
    return PostResult.Success
}
