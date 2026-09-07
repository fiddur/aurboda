package net.aurboda.widget

import android.util.Log
import io.ktor.client.HttpClient
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import net.aurboda.CredentialsManager
import net.aurboda.DataResult
import net.aurboda.api.models.Challenge
import net.aurboda.api.models.ChallengeEffectiveBucketSize
import net.aurboda.api.models.ChallengeParticipation
import net.aurboda.api.models.ChallengeStanding
import net.aurboda.api.models.DiscoveredChallenge
import net.aurboda.fetchChallengeParticipations
import net.aurboda.fetchChallenges
import net.aurboda.fetchDiscoverChallenges
import net.aurboda.fetchPublicChallengeStandings
import net.aurboda.parseChallengeUrl
import net.aurboda.resolveApiBase

private const val TAG = "ChallengeWidgetData"

/** The signed-in user's own challenges — the same for every widget, so fetched once per refresh (#991). */
data class ChallengeWidgetLists(val hosted: List<Challenge>, val joined: List<ChallengeParticipation>)

/** Hosted list + participations from the user's own instance, concurrently. */
suspend fun fetchChallengeWidgetLists(
    httpClient: HttpClient,
    credentials: CredentialsManager.Credentials,
): DataResult<ChallengeWidgetLists> =
    coroutineScope {
        val hosted = async { fetchChallenges(httpClient, credentials.apiUrl, credentials.authToken) }
        val joined = async { fetchChallengeParticipations(httpClient, credentials.apiUrl, credentials.authToken) }
        val hostedResult = hosted.await()
        val joinedResult = joined.await()
        if (hostedResult is DataResult.Success && joinedResult is DataResult.Success) {
            DataResult.Success(ChallengeWidgetLists(hostedResult.data, joinedResult.data))
        } else {
            DataResult.Error("Couldn't load challenges")
        }
    }

/** Everything one widget render needs: the challenge itself and its current standings. */
data class ChallengeWidgetData(
    val summary: ChallengeSummary,
    val standings: List<ChallengeStanding>,
    /** The bucket size the host aggregated with; null from a host that doesn't send it (inferred instead). */
    val effectiveBucketSize: ChallengeEffectiveBucketSize?,
)

/**
 * Load a widget's standings from whichever instance hosts the challenge (via its
 * public standings endpoint, discovered like a federated join). The name / unit /
 * window in [summary] come from the user's own lists, so a rename or a left
 * challenge is reflected without asking the host.
 */
suspend fun loadChallengeWidgetData(
    httpClient: HttpClient,
    credentials: CredentialsManager.Credentials,
    summary: ChallengeSummary,
): DataResult<ChallengeWidgetData> {
    val parsed = parseChallengeUrl(summary.url) ?: return DataResult.Error("Not a challenge link")
    val apiBase =
        when (val resolved = resolveApiBase(httpClient, credentials, parsed.base)) {
            is DataResult.Success -> resolved.data
            is DataResult.Error -> return DataResult.Error("Couldn't load standings")
        }
    return when (val standings = fetchPublicChallengeStandings(httpClient, apiBase, parsed.username, parsed.slug)) {
        is DataResult.Success ->
            DataResult.Success(
                ChallengeWidgetData(summary, standings.data.members ?: emptyList(), standings.data.effectiveBucketSize),
            )
        is DataResult.Error -> DataResult.Error("Couldn't load standings")
    }
}

/**
 * The challenge the widget should suggest joining — the first open one hosted by
 * someone the user follows — or null when there is none. A failed discovery is
 * null too: a suggestion is a nicety, never an error state on the home screen.
 */
suspend fun fetchWidgetSuggestion(
    httpClient: HttpClient,
    credentials: CredentialsManager.Credentials,
): DiscoveredChallenge? =
    when (val result = fetchDiscoverChallenges(httpClient, credentials.apiUrl, credentials.authToken)) {
        is DataResult.Success -> result.data.firstOrNull()
        is DataResult.Error -> {
            Log.w(TAG, "Challenge discovery failed: ${result.message}")
            null
        }
    }
