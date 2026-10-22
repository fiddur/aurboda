package net.aurboda

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CancellationException
import net.aurboda.api.models.Challenge
import net.aurboda.api.models.ChallengeParticipation
import net.aurboda.api.models.ChallengeParticipationsResponse
import net.aurboda.api.models.ChallengeStandingsResponse
import net.aurboda.api.models.ChallengesResponse
import net.aurboda.api.models.DiscoverChallengesResponse
import net.aurboda.api.models.DiscoveredChallenge
import net.aurboda.api.models.WellKnownAurboda
import java.net.URLEncoder

private const val TAG = "ChallengeApi"

/** A parsed public challenge URL `<base>/u/<username>/<slug>` (base may carry a sub-path). */
data class ChallengeUrl(val base: String, val username: String, val slug: String)

/**
 * Parse a challenge (or any `/u/:username/:slug`) URL into its instance base,
 * host username and slug — the same split the backend's federation code does.
 * Returns null when the URL doesn't have that shape.
 */
fun parseChallengeUrl(url: String): ChallengeUrl? {
    val marker = "/u/"
    val i = url.indexOf(marker)
    if (i < 0) return null
    val base = url.substring(0, i).trimEnd('/')
    val parts = url.substring(i + marker.length).split('/').filter { it.isNotEmpty() }
    if (base.isEmpty() || parts.size < 2) return null
    return ChallengeUrl(base = base, username = parts[0], slug = parts[1])
}

/**
 * The API base for the instance at [instanceBase]. The user's own instance is
 * answered locally from [credentials]; any other instance is discovered through
 * its `/.well-known/aurboda` document, exactly like the backend does when joining.
 */
suspend fun resolveApiBase(
    httpClient: HttpClient,
    credentials: CredentialsManager.Credentials,
    instanceBase: String,
): DataResult<String> {
    if (instanceBase.trimEnd('/') == credentials.serverUrl.trimEnd('/')) {
        return DataResult.Success(credentials.apiUrl)
    }
    return discoverApiBase(httpClient, instanceBase)
}

/** Discover a (remote) instance's API base from `<base>/.well-known/aurboda`. */
suspend fun discoverApiBase(httpClient: HttpClient, instanceBase: String): DataResult<String> =
    when (val res = getJson<WellKnownAurboda>(httpClient, "${instanceBase.trimEnd('/')}/.well-known/aurboda")) {
        is DataResult.Success ->
            if (res.data.federation) DataResult.Success(res.data.apiBase)
            else DataResult.Error("Instance does not support federation")
        is DataResult.Error -> res
    }

/** Challenges hosted by the signed-in user. */
suspend fun fetchChallenges(
    httpClient: HttpClient,
    apiUrl: String,
    authToken: String,
): DataResult<List<Challenge>> =
    getJson<ChallengesResponse>(httpClient, "$apiUrl/challenges", authToken).map { it.challenges }

/** Challenges the signed-in user has joined (any status; callers filter). */
suspend fun fetchChallengeParticipations(
    httpClient: HttpClient,
    apiUrl: String,
    authToken: String,
): DataResult<List<ChallengeParticipation>> =
    getJson<ChallengeParticipationsResponse>(httpClient, "$apiUrl/challenges/participations/mine", authToken)
        .map { it.participations }

/**
 * Public standings of the challenge at `/u/[username]/[slug]` on the instance
 * serving [apiBase]: the members plus the bucket size the host aggregated with.
 */
suspend fun fetchPublicChallengeStandings(
    httpClient: HttpClient,
    apiBase: String,
    username: String,
    slug: String,
): DataResult<ChallengeStandingsResponse> {
    val url = "${apiBase.trimEnd('/')}/public/${urlEncode(username)}/${urlEncode(slug)}/standings"
    return getJson<ChallengeStandingsResponse>(httpClient, url)
}

/**
 * Open challenges hosted by people the signed-in user follows that they haven't
 * joined — ongoing first, soonest to end (the server walks the followed
 * instances, so this is the slow one of the challenge calls).
 */
suspend fun fetchDiscoverChallenges(
    httpClient: HttpClient,
    apiUrl: String,
    authToken: String,
): DataResult<List<DiscoveredChallenge>> =
    getJson<DiscoverChallengesResponse>(httpClient, "$apiUrl/challenges/discover", authToken).map { it.challenges }

private fun urlEncode(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

private inline fun <T, R> DataResult<T>.map(f: (T) -> R): DataResult<R> =
    when (this) {
        is DataResult.Success -> DataResult.Success(f(data))
        is DataResult.Error -> this
    }

private suspend inline fun <reified T> getJson(
    httpClient: HttpClient,
    url: String,
    authToken: String? = null,
): DataResult<T> =
    try {
        val response = httpClient.get(url) {
            if (authToken != null) headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        }
        if (response.status == HttpStatusCode.OK) {
            DataResult.Success(appJson.decodeFromString<T>(response.bodyAsText()))
        } else {
            Log.e(TAG, "GET $url failed: ${response.status}")
            DataResult.Error("Server returned ${response.status}")
        }
    } catch (e: CancellationException) {
        // A stopped worker must stop, not carry on with a fake "error" result.
        throw e
    } catch (e: Exception) {
        Log.e(TAG, "GET $url threw", e)
        DataResult.Error(e.message ?: "Unknown error")
    }
