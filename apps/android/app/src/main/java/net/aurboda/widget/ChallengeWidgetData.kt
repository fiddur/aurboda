package net.aurboda.widget

import io.ktor.client.HttpClient
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import net.aurboda.CredentialsManager
import net.aurboda.DataResult
import net.aurboda.api.models.ChallengeStanding
import net.aurboda.fetchChallengeParticipations
import net.aurboda.fetchChallenges
import net.aurboda.fetchPublicChallengeStandings
import net.aurboda.parseChallengeUrl
import net.aurboda.resolveApiBase

/** Everything one widget render needs: the challenge itself and its current standings. */
data class ChallengeWidgetData(val summary: ChallengeSummary, val standings: List<ChallengeStanding>)

/**
 * Load a widget's challenge: the name/unit/window come from the user's own
 * instance (hosted list + participations, so a rename or a left challenge is
 * reflected), the standings from whichever instance hosts the challenge (via its
 * public standings endpoint, discovered like a federated join). The three
 * requests run concurrently.
 */
suspend fun loadChallengeWidgetData(
    httpClient: HttpClient,
    credentials: CredentialsManager.Credentials,
    challengeUrl: String,
): DataResult<ChallengeWidgetData> {
    val parsed = parseChallengeUrl(challengeUrl) ?: return DataResult.Error("Not a challenge link")
    return coroutineScope {
        val hosted = async { fetchChallenges(httpClient, credentials.apiUrl, credentials.authToken) }
        val joined = async { fetchChallengeParticipations(httpClient, credentials.apiUrl, credentials.authToken) }
        val standings =
            async {
                when (val apiBase = resolveApiBase(httpClient, credentials, parsed.base)) {
                    is DataResult.Success ->
                        fetchPublicChallengeStandings(httpClient, apiBase.data, parsed.username, parsed.slug)
                    is DataResult.Error -> apiBase
                }
            }

        val hostedResult = hosted.await()
        val joinedResult = joined.await()
        val standingsResult = standings.await()
        if (hostedResult !is DataResult.Success || joinedResult !is DataResult.Success) {
            return@coroutineScope DataResult.Error("Couldn't load challenges")
        }
        if (standingsResult !is DataResult.Success) return@coroutineScope DataResult.Error("Couldn't load standings")
        val summary =
            findChallengeSummary(challengeUrl, hostedResult.data, joinedResult.data)
                ?: return@coroutineScope DataResult.Error("Challenge no longer available")
        DataResult.Success(ChallengeWidgetData(summary, standingsResult.data))
    }
}
