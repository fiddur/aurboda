package net.aurboda.widget

import net.aurboda.api.models.Challenge
import net.aurboda.api.models.ChallengeParticipation
import net.aurboda.api.models.ChallengeStanding
import java.text.NumberFormat
import java.time.DateTimeException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * Pure logic behind the challenge home-screen widget: which challenges can be
 * picked, how standings become race-chart series and leaderboard rows, and how
 * the widget lays itself out at a given size. No Android framework types, so
 * everything here is unit-testable.
 */

/**
 * Member line colours, in leaderboard order — the same palette (and order) as the
 * web race chart / leaderboard (`apps/web/src/pages/Challenges/PublicChallenge.tsx`),
 * so a member has the same colour on the phone as on the web page.
 */
val CHALLENGE_MEMBER_COLORS: IntArray =
    intArrayOf(
        0xFF8B5CF6.toInt(),
        0xFF10B981.toInt(),
        0xFF3B82F6.toInt(),
        0xFFF59E0B.toInt(),
        0xFFEF4444.toInt(),
        0xFFEC4899.toInt(),
        0xFF14B8A6.toInt(),
        0xFFA855F7.toInt(),
    )

fun challengeMemberColor(index: Int): Int = CHALLENGE_MEMBER_COLORS[index % CHALLENGE_MEMBER_COLORS.size]

const val DAY_MILLIS: Long = 24L * 60 * 60 * 1000

/** A challenge the widget can be pointed at: hosted by the user, or one they joined. */
data class ChallengePick(
    val url: String,
    val name: String,
    /** e.g. "steps · sum" */
    val detail: String,
    val hosted: Boolean,
    val startTs: String,
    val endTs: String,
    /** IANA zone the window was chosen in — dates are rendered in it, as on the web. */
    val timezone: String,
)

/**
 * The challenges offered in the widget configuration screen: everything the user
 * hosts, then everything they are still an active member of. Withdrawn
 * participations are left out — there is nothing to race in.
 */
fun challengePicks(hosted: List<Challenge>, joined: List<ChallengeParticipation>): List<ChallengePick> {
    val own =
        hosted.map {
            ChallengePick(
                url = it.shareUrl,
                name = it.name,
                detail = "${it.spec.unit} · ${it.spec.aggregation.value}",
                hosted = true,
                startTs = it.startTs,
                endTs = it.endTs,
                timezone = it.timezone,
            )
        }
    val others =
        joined
            .filter { it.status == ChallengeParticipation.Status.active }
            .map {
                ChallengePick(
                    url = it.challengeUrl,
                    name = it.name,
                    detail = "${it.spec.unit} · ${it.spec.aggregation.value}",
                    hosted = false,
                    startTs = it.startTs,
                    endTs = it.endTs,
                    timezone = it.timezone,
                )
            }
    return own + others
}

/** What the widget shows about the challenge itself (name, unit, window). */
data class ChallengeSummary(
    val url: String,
    val name: String,
    val unit: String,
    val startMillis: Long,
    val endMillis: Long,
)

/** Find [url] among the user's hosted / joined challenges (trailing slashes ignored). */
fun findChallengeSummary(
    url: String,
    hosted: List<Challenge>,
    joined: List<ChallengeParticipation>,
): ChallengeSummary? {
    val wanted = url.trimEnd('/')
    hosted.firstOrNull { it.shareUrl.trimEnd('/') == wanted }?.let {
        return ChallengeSummary(it.shareUrl, it.name, it.spec.unit, parseInstantMillis(it.startTs), parseInstantMillis(it.endTs))
    }
    joined.firstOrNull { it.challengeUrl.trimEnd('/') == wanted }?.let {
        return ChallengeSummary(it.challengeUrl, it.name, it.spec.unit, parseInstantMillis(it.startTs), parseInstantMillis(it.endTs))
    }
    return null
}

/** Epoch millis of an ISO-8601 instant; 0 if it doesn't parse (a bad value must not crash a widget). */
fun parseInstantMillis(iso: String): Long =
    try {
        Instant.parse(iso).toEpochMilli()
    } catch (e: DateTimeParseException) {
        0L
    }

/** One point of a member's cumulative line. */
data class RacePoint(val timeMillis: Long, val value: Double)

/** One member's line in the race chart. */
data class RaceSeries(val color: Int, val points: List<RacePoint>)

/**
 * The bucket length the standings were aggregated with, inferred as the smallest
 * gap between consecutive bucket starts of any member (the host doesn't send it
 * on this endpoint). Falls back to a day when nobody has two buckets yet.
 */
fun inferBucketMillis(standings: List<ChallengeStanding>): Long {
    var best = Long.MAX_VALUE
    for (s in standings) {
        val starts = s.buckets.map { parseInstantMillis(it.bucketStart) }.sorted()
        for (i in 1 until starts.size) {
            val gap = starts[i] - starts[i - 1]
            if (gap > 0 && gap < best) best = gap
        }
    }
    return if (best == Long.MAX_VALUE) DAY_MILLIS else best
}

/**
 * A member's running total as a line: a zero point on the start line, then the
 * cumulative total plotted at the *end* of each bucket (a bucket's steps are only
 * fully "in" when it is over) — the same shape as the web race chart.
 */
fun cumulativeSeries(
    standing: ChallengeStanding,
    color: Int,
    startMillis: Long,
    bucketMillis: Long,
): RaceSeries {
    val points = ArrayList<RacePoint>(standing.buckets.size + 1)
    points.add(RacePoint(startMillis, 0.0))
    var running = 0.0
    for (b in standing.buckets.sortedBy { it.bucketStart }) {
        running += b.value
        points.add(RacePoint(parseInstantMillis(b.bucketStart) + bucketMillis, running))
    }
    return RaceSeries(color, points)
}

/** One line of the widget leaderboard. */
data class LeaderboardRow(
    val rank: Int,
    val name: String,
    val color: Int,
    val total: Double,
    /** The signed-in user's own row (rendered emphasised). */
    val isMe: Boolean,
)

/** Active members in leaderboard order, each with its palette colour and rank. */
fun leaderboard(standings: List<ChallengeStanding>, myIdentityUrl: String?): List<LeaderboardRow> {
    val me = myIdentityUrl?.trimEnd('/')
    return standings
        .filter { it.status == ChallengeStanding.Status.active }
        .mapIndexed { i, s ->
            LeaderboardRow(
                rank = i + 1,
                name = s.displayName,
                color = challengeMemberColor(i),
                total = s.total,
                isMe = me != null && s.identityBaseUrl.trimEnd('/') == me,
            )
        }
}

/**
 * The rows that fit in [maxRows]: the top of the table, except that the user's own
 * row (if it would be cut) replaces the last visible one — a widget on your home
 * screen should always show where *you* stand.
 */
fun visibleRows(rows: List<LeaderboardRow>, maxRows: Int): List<LeaderboardRow> {
    if (maxRows <= 0) return emptyList()
    if (rows.size <= maxRows) return rows
    val top = rows.take(maxRows)
    val me = rows.firstOrNull { it.isMe } ?: return top
    if (top.any { it.isMe }) return top
    return top.dropLast(1) + me
}

/**
 * The signed-in user's federation identity (`<server>/u/<username>`) — what the
 * host lists as `identity_base_url` for them in the standings.
 */
fun myIdentityUrl(serverUrl: String, username: String): String = "${serverUrl.trimEnd('/')}/u/$username"

/** Widget-internal geometry, in dp. */
object ChallengeWidgetGeometry {
    const val PADDING = 8
    const val HEADER = 30 // title + meta line
    const val ROW = 15
    const val MIN_CHART = 30
    const val MIN_WIDTH_FOR_RANK = 130
}

/** How the widget divides its height between the race chart and leaderboard rows. */
data class ChallengeWidgetLayout(
    val rowCount: Int,
    val chartHeightDp: Int,
    val chartWidthDp: Int,
    /** Rank numbers are dropped on the narrowest widgets so names keep some room. */
    val showRank: Boolean,
)

/**
 * Split a widget of [widthDp] × [heightDp] into chart + rows: as many leaderboard
 * rows as fit above a minimum chart height (never more than [memberCount]), the
 * rest of the height going to the chart. A 2×2 cell (~110 dp) yields two rows and
 * a ~36 dp chart; taller widgets show more members, wider ones a longer chart.
 */
fun planChallengeWidgetLayout(widthDp: Float, heightDp: Float, memberCount: Int): ChallengeWidgetLayout {
    val g = ChallengeWidgetGeometry
    val available = (heightDp - 2 * g.PADDING - g.HEADER).coerceAtLeast(0f)
    val roomForRows = floor((available - g.MIN_CHART) / g.ROW).toInt().coerceAtLeast(0)
    val rows = minOf(memberCount, roomForRows).coerceAtLeast(if (memberCount > 0) 1 else 0)
    val chart = (available - rows * g.ROW).toInt().coerceAtLeast(g.MIN_CHART)
    val chartWidth = (widthDp - 2 * g.PADDING).toInt().coerceAtLeast(40)
    return ChallengeWidgetLayout(
        rowCount = rows,
        chartHeightDp = chart,
        chartWidthDp = chartWidth,
        showRank = widthDp >= g.MIN_WIDTH_FOR_RANK,
    )
}

/** "138,989" — a whole-number total with locale grouping, like the web leaderboard. */
fun formatChallengeTotal(total: Double): String = NumberFormat.getIntegerInstance().format(total.roundToLong())

/**
 * The widget's second line: the unit and where the challenge is in its window
 * ("steps · 13 days left", "steps · last day", "steps · starts in 2 days",
 * "steps · ended"). [endMillis] is the exclusive window end.
 */
fun challengeMetaLine(unit: String, startMillis: Long, endMillis: Long, nowMillis: Long): String {
    val phase =
        when {
            nowMillis < startMillis -> {
                val days = ceil((startMillis - nowMillis).toDouble() / DAY_MILLIS).toInt()
                if (days <= 1) "starts tomorrow" else "starts in $days days"
            }
            nowMillis >= endMillis -> "ended"
            else -> {
                val days = ceil((endMillis - nowMillis).toDouble() / DAY_MILLIS).toInt()
                if (days <= 1) "last day" else "$days days left"
            }
        }
    return "$unit · $phase"
}

/**
 * "Aug 1 – Aug 31": the inclusive window of a challenge, rendered in the zone it
 * was chosen in ([endTs] is the exclusive end, so step back one ms first). Falls
 * back to the device zone for an unknown zone id.
 */
fun challengeDateRange(startTs: String, endTs: String, timezone: String, locale: Locale = Locale.getDefault()): String {
    val zone =
        try {
            ZoneId.of(timezone)
        } catch (e: DateTimeException) {
            ZoneId.systemDefault()
        }
    val fmt = DateTimeFormatter.ofPattern("MMM d", locale).withZone(zone)
    val start = Instant.ofEpochMilli(parseInstantMillis(startTs))
    val end = Instant.ofEpochMilli(parseInstantMillis(endTs) - 1)
    return "${fmt.format(start)} – ${fmt.format(end)}"
}
