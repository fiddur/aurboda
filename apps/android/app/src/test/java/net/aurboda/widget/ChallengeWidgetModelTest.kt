package net.aurboda.widget

import net.aurboda.api.models.Challenge
import net.aurboda.api.models.ChallengeAggregation
import net.aurboda.api.models.ChallengeBucketSize
import net.aurboda.api.models.ChallengeParticipation
import net.aurboda.api.models.ChallengeSourceType
import net.aurboda.api.models.ChallengeSpec
import net.aurboda.api.models.ChallengeStanding
import net.aurboda.api.models.ChartDataBucket
import net.aurboda.api.models.ShareVisibility
import net.aurboda.parseChallengeUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class ChallengeWidgetModelTest {
    private val spec =
        ChallengeSpec(
            aggregation = ChallengeAggregation.sum,
            bucketSize = ChallengeBucketSize.auto,
            pattern = "steps",
            sourceType = ChallengeSourceType.metric,
            unit = "steps",
        )

    private fun hosted(name: String, url: String) =
        Challenge(
            createdAt = "2026-07-30T00:00:00.000Z",
            endTs = "2026-08-31T22:00:00.000Z",
            id = "c-$name",
            name = name,
            shareUrl = url,
            slug = name,
            spec = spec,
            startTs = "2026-07-31T22:00:00.000Z",
            timezone = "Europe/Stockholm",
            updatedAt = "2026-07-30T00:00:00.000Z",
            visibility = ShareVisibility.public,
        )

    private fun joined(name: String, url: String, status: ChallengeParticipation.Status = ChallengeParticipation.Status.active) =
        ChallengeParticipation(
            challengeUrl = url,
            createdAt = "2026-07-30T00:00:00.000Z",
            endTs = "2026-08-31T22:00:00.000Z",
            hostIdentity = "https://other.example/u/host",
            id = "p-$name",
            name = name,
            spec = spec,
            startTs = "2026-07-31T22:00:00.000Z",
            status = status,
            timezone = "Europe/Stockholm",
        )

    private fun standing(
        name: String,
        identity: String,
        buckets: List<Pair<String, Double>>,
        status: ChallengeStanding.Status = ChallengeStanding.Status.active,
    ) = ChallengeStanding(
        buckets = buckets.map { (start, v) -> ChartDataBucket(bucketStart = start, value = v) },
        displayName = name,
        identityBaseUrl = identity,
        lastUpdated = null,
        stale = false,
        status = status,
        total = buckets.sumOf { it.second },
    )

    // --- URLs -------------------------------------------------------------

    @Test
    fun `parseChallengeUrl splits base, username and slug`() {
        val parsed = parseChallengeUrl("https://aurboda.net/u/fiddur/august-steppers")
        assertEquals("https://aurboda.net", parsed?.base)
        assertEquals("fiddur", parsed?.username)
        assertEquals("august-steppers", parsed?.slug)
    }

    @Test
    fun `parseChallengeUrl keeps an instance sub-path and ignores a trailing slash`() {
        val parsed = parseChallengeUrl("https://host.example/aurboda/u/anna/walk/")
        assertEquals("https://host.example/aurboda", parsed?.base)
        assertEquals("anna", parsed?.username)
        assertEquals("walk", parsed?.slug)
    }

    @Test
    fun `parseChallengeUrl rejects non-challenge URLs`() {
        assertNull(parseChallengeUrl("https://aurboda.net/challenges"))
        assertNull(parseChallengeUrl("https://aurboda.net/u/fiddur"))
        assertNull(parseChallengeUrl("/u/fiddur/slug"))
    }

    @Test
    fun `challengeDeepLinkPath is site-relative on the own instance and absolute elsewhere`() {
        assertEquals(
            "/u/fiddur/august-steppers",
            challengeDeepLinkPath("https://aurboda.net/", "https://aurboda.net/u/fiddur/august-steppers"),
        )
        assertEquals(
            "https://other.example/u/anna/walk",
            challengeDeepLinkPath("https://aurboda.net", "https://other.example/u/anna/walk"),
        )
        // Signed out: still an absolute link rather than a wrong relative one.
        assertEquals("https://aurboda.net/u/fiddur/x", challengeDeepLinkPath(null, "https://aurboda.net/u/fiddur/x"))
    }

    // --- Picks + summary --------------------------------------------------

    @Test
    fun `challengePicks lists hosted first, then active joined only`() {
        val picks =
            challengePicks(
                hosted = listOf(hosted("mine", "https://aurboda.net/u/me/mine")),
                joined =
                    listOf(
                        joined("theirs", "https://other.example/u/anna/theirs"),
                        joined("left", "https://other.example/u/anna/left", ChallengeParticipation.Status.withdrawn),
                    ),
            )
        assertEquals(listOf("mine", "theirs"), picks.map { it.name })
        assertEquals(listOf(true, false), picks.map { it.hosted })
        assertEquals("steps · sum", picks[0].detail)
    }

    @Test
    fun `findChallengeSummary matches hosted or joined by URL, ignoring trailing slashes`() {
        val hostedList = listOf(hosted("mine", "https://aurboda.net/u/me/mine"))
        val joinedList = listOf(joined("theirs", "https://other.example/u/anna/theirs"))
        assertEquals("mine", findChallengeSummary("https://aurboda.net/u/me/mine/", hostedList, joinedList)?.name)
        assertEquals("theirs", findChallengeSummary("https://other.example/u/anna/theirs", hostedList, joinedList)?.name)
        assertNull(findChallengeSummary("https://aurboda.net/u/me/gone", hostedList, joinedList))
        val s = findChallengeSummary("https://aurboda.net/u/me/mine", hostedList, joinedList)!!
        assertEquals("steps", s.unit)
        assertEquals(parseInstantMillis("2026-07-31T22:00:00.000Z"), s.startMillis)
    }

    // --- Series -----------------------------------------------------------

    @Test
    fun `inferBucketMillis is the smallest gap between bucket starts, defaulting to a day`() {
        val daily =
            standing(
                "a",
                "https://x/u/a",
                listOf("2026-08-01T00:00:00Z" to 1.0, "2026-08-03T00:00:00Z" to 1.0, "2026-08-02T00:00:00Z" to 1.0),
            )
        assertEquals(DAY_MILLIS, inferBucketMillis(listOf(daily)))
        val hourly = standing("b", "https://x/u/b", listOf("2026-08-01T00:00:00Z" to 1.0, "2026-08-01T01:00:00Z" to 1.0))
        assertEquals(60L * 60 * 1000, inferBucketMillis(listOf(daily, hourly)))
        assertEquals(DAY_MILLIS, inferBucketMillis(listOf(standing("c", "https://x/u/c", listOf("2026-08-01T00:00:00Z" to 5.0)))))
        assertEquals(DAY_MILLIS, inferBucketMillis(emptyList()))
    }

    @Test
    fun `cumulativeSeries starts at zero on the start line and accumulates at bucket ends`() {
        val start = parseInstantMillis("2026-07-31T22:00:00Z")
        val s =
            standing(
                "a",
                "https://x/u/a",
                listOf("2026-08-02T00:00:00Z" to 3000.0, "2026-08-01T00:00:00Z" to 5000.0),
            )
        val series = cumulativeSeries(s, 0xFF123456.toInt(), start, DAY_MILLIS)
        assertEquals(0xFF123456.toInt(), series.color)
        assertEquals(listOf(0.0, 5000.0, 8000.0), series.points.map { it.value })
        assertEquals(start, series.points[0].timeMillis)
        assertEquals(parseInstantMillis("2026-08-02T00:00:00Z"), series.points[1].timeMillis)
        assertEquals(parseInstantMillis("2026-08-03T00:00:00Z"), series.points[2].timeMillis)
    }

    // --- Leaderboard ------------------------------------------------------

    @Test
    fun `leaderboard ranks active members with the web palette and marks the signed-in user`() {
        val rows =
            leaderboard(
                listOf(
                    standing("delvoriah", "https://aurboda.net/u/delvoriah", listOf("2026-08-01T00:00:00Z" to 138989.0)),
                    standing("fiddur", "https://aurboda.net/u/fiddur/", listOf("2026-08-01T00:00:00Z" to 120055.0)),
                    standing("gone", "https://aurboda.net/u/gone", emptyList(), ChallengeStanding.Status.withdrawn),
                ),
                myIdentityUrl("https://aurboda.net/", "fiddur"),
            )
        assertEquals(listOf(1, 2), rows.map { it.rank })
        assertEquals(listOf(CHALLENGE_MEMBER_COLORS[0], CHALLENGE_MEMBER_COLORS[1]), rows.map { it.color })
        assertEquals(listOf(false, true), rows.map { it.isMe })
        // Grouping separator is locale-specific; the digits and the fact that it is grouped are not.
        val formatted = formatChallengeTotal(rows[0].total)
        assertEquals("138989", formatted.filter { it.isDigit() })
        assertTrue(formatted.length > 6)
    }

    @Test
    fun `visibleRows keeps the top rows but swaps the user in when they would be cut`() {
        val rows =
            (1..6).map { i ->
                LeaderboardRow(rank = i, name = "m$i", color = challengeMemberColor(i - 1), total = 100.0 - i, isMe = i == 5)
            }
        assertEquals(listOf(1, 2, 5), visibleRows(rows, 3).map { it.rank })
        assertEquals(listOf(1, 2, 3, 4, 5), visibleRows(rows, 5).map { it.rank })
        assertEquals((1..6).toList(), visibleRows(rows, 10).map { it.rank })
        assertTrue(visibleRows(rows, 0).isEmpty())
        val nobodyIsMe = rows.map { it.copy(isMe = false) }
        assertEquals(listOf(1, 2, 3), visibleRows(nobodyIsMe, 3).map { it.rank })
    }

    // --- Layout + text ----------------------------------------------------

    @Test
    fun `planChallengeWidgetLayout gives a 2x2 cell two rows and a small chart, and grows with height`() {
        val small = planChallengeWidgetLayout(widthDp = 110f, heightDp = 110f, memberCount = 5)
        assertEquals(2, small.rowCount)
        assertTrue(small.chartHeightDp >= ChallengeWidgetGeometry.MIN_CHART)
        assertEquals(110 - 2 * ChallengeWidgetGeometry.PADDING, small.chartWidthDp)
        assertFalse(small.showRank)

        val tall = planChallengeWidgetLayout(widthDp = 110f, heightDp = 250f, memberCount = 5)
        assertEquals(5, tall.rowCount)
        assertTrue(tall.chartHeightDp > small.chartHeightDp)

        // Never more rows than members; the spare height goes to the chart.
        val two = planChallengeWidgetLayout(widthDp = 250f, heightDp = 250f, memberCount = 2)
        assertEquals(2, two.rowCount)
        assertTrue(two.chartHeightDp > tall.chartHeightDp)
        assertTrue(two.showRank)

        // At least one row when there is anyone to show, even if it squeezes the chart.
        assertEquals(1, planChallengeWidgetLayout(widthDp = 110f, heightDp = 70f, memberCount = 3).rowCount)
        assertEquals(0, planChallengeWidgetLayout(widthDp = 110f, heightDp = 110f, memberCount = 0).rowCount)
    }

    @Test
    fun `challengeMetaLine describes where the challenge is in its window`() {
        val start = parseInstantMillis("2026-07-31T22:00:00Z")
        val end = parseInstantMillis("2026-08-31T22:00:00Z")
        assertEquals("steps · 14 days left", challengeMetaLine("steps", start, end, parseInstantMillis("2026-08-18T10:00:00Z")))
        assertEquals("steps · last day", challengeMetaLine("steps", start, end, parseInstantMillis("2026-08-31T10:00:00Z")))
        assertEquals("steps · ended", challengeMetaLine("steps", start, end, end))
        assertEquals("steps · starts in 3 days", challengeMetaLine("steps", start, end, parseInstantMillis("2026-07-29T10:00:00Z")))
        assertEquals("steps · starts tomorrow", challengeMetaLine("steps", start, end, parseInstantMillis("2026-07-31T10:00:00Z")))
    }

    @Test
    fun `challengeDateRange renders the inclusive window in the challenge timezone`() {
        // Midnight Stockholm = 22:00Z the day before; the exclusive end steps back to Aug 31.
        assertEquals("Aug 1 – Aug 31", challengeDateRange("2026-07-31T22:00:00Z", "2026-08-31T22:00:00Z", "Europe/Stockholm", Locale.ENGLISH))
        assertEquals("Jul 31 – Aug 31", challengeDateRange("2026-07-31T22:00:00Z", "2026-08-31T22:00:00Z", "UTC", Locale.ENGLISH))
        // An unknown zone must not throw.
        assertFalse(challengeDateRange("2026-07-31T22:00:00Z", "2026-08-31T22:00:00Z", "Not/AZone", Locale.ENGLISH).isEmpty())
    }
}
