package net.aurboda.widget

import net.aurboda.api.models.Challenge
import net.aurboda.api.models.ChallengeEffectiveBucketSize
import net.aurboda.api.models.ChallengeParticipation
import net.aurboda.api.models.ChallengeStanding
import net.aurboda.api.models.DiscoveredChallenge
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
    val unit: String,
) {
    /** What the widget shows about this challenge itself. */
    fun summary(): ChallengeSummary =
        ChallengeSummary(url, name, unit, parseInstantMillis(startTs), parseInstantMillis(endTs), timezone)
}

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
                unit = it.spec.unit,
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
                    unit = it.spec.unit,
                )
            }
    return own + others
}

/** How long a finished challenge stays on the widget before it moves on to another one. */
const val WIDGET_ADVANCE_AFTER_MILLIS: Long = DAY_MILLIS

/** What the refresh should render for a widget configured to one challenge. */
sealed class WidgetTarget {
    /** The configured challenge: running, upcoming, or over for less than a day. */
    data class Keep(val pick: ChallengePick) : WidgetTarget()

    /** The configured one is long over (or gone from the user's lists): move on to [pick] and remember it. */
    data class Advance(val pick: ChallengePick) : WidgetTarget()

    /**
     * Nothing of the user's own is worth showing — suggest one to join. [fallback]
     * is the finished challenge to keep showing when no suggestion turns up.
     */
    data class Suggest(val fallback: ChallengePick?) : WidgetTarget()
}

/**
 * Where a widget configured to [currentUrl] should point now. Reconfiguring a
 * widget is awkward on some launchers, so a finished challenge is kept for a
 * day (its result banner) and then the widget moves on by itself: to the running
 * challenge that ends soonest, else the upcoming one that starts soonest, else
 * to a suggestion. A challenge that vanished from the user's lists (left, or
 * deleted by its host) moves on right away.
 */
fun widgetTarget(currentUrl: String, picks: List<ChallengePick>, nowMillis: Long): WidgetTarget {
    val wanted = currentUrl.trimEnd('/')
    val current = picks.firstOrNull { it.url.trimEnd('/') == wanted }
    if (current != null && nowMillis < parseInstantMillis(current.endTs) + WIDGET_ADVANCE_AFTER_MILLIS) {
        return WidgetTarget.Keep(current)
    }
    val next = nextChallengePick(picks.filter { it.url.trimEnd('/') != wanted }, nowMillis)
    return if (next != null) WidgetTarget.Advance(next) else WidgetTarget.Suggest(current)
}

/** The challenge worth showing next: a running one (soonest to end), else the soonest upcoming; null when none is open. */
fun nextChallengePick(picks: List<ChallengePick>, nowMillis: Long): ChallengePick? {
    val open = picks.filter { parseInstantMillis(it.endTs) > nowMillis }
    val running = open.filter { parseInstantMillis(it.startTs) <= nowMillis }.minByOrNull { parseInstantMillis(it.endTs) }
    return running ?: open.minByOrNull { parseInstantMillis(it.startTs) }
}

/** Who hosts a discovered challenge, as people know them: handle, else display name, else identity URL. */
fun discoveredHostLabel(c: DiscoveredChallenge): String = c.hostHandle ?: c.hostDisplayName ?: c.hostIdentity

/** The body of the widget while it suggests a challenge to join instead of showing one. */
fun challengeSuggestionText(name: String, host: String): String = "$name\nby $host\n\nTap to see and join"

/** What the widget shows about the challenge itself (name, unit, window). */
data class ChallengeSummary(
    val url: String,
    val name: String,
    val unit: String,
    val startMillis: Long,
    val endMillis: Long,
    /** IANA zone the window was chosen in — calendar buckets (days, months) end in it. */
    val timezone: String,
)

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

private const val MINUTE_MILLIS: Long = 60L * 1000

private fun zoneOf(timezone: String): ZoneId =
    try {
        ZoneId.of(timezone)
    } catch (e: DateTimeException) {
        ZoneId.systemDefault()
    }

/**
 * When the bucket starting at [startMillis] ends: by the host's [effective]
 * bucket size when the standings carry one — calendar days, weeks and months in
 * the challenge [timezone], so a month bucket ends at the next month's midnight
 * and a DST day is 23 or 25 hours — else [fallbackMillis] inferred from the data.
 */
fun bucketEndAt(startMillis: Long, effective: ChallengeEffectiveBucketSize?, timezone: String, fallbackMillis: Long): Long {
    val zoned = { Instant.ofEpochMilli(startMillis).atZone(zoneOf(timezone)) }
    return when (effective) {
        ChallengeEffectiveBucketSize._5m -> startMillis + 5 * MINUTE_MILLIS
        ChallengeEffectiveBucketSize._15m -> startMillis + 15 * MINUTE_MILLIS
        ChallengeEffectiveBucketSize._1h -> startMillis + 60 * MINUTE_MILLIS
        ChallengeEffectiveBucketSize._1d -> zoned().plusDays(1).toInstant().toEpochMilli()
        ChallengeEffectiveBucketSize._1w -> zoned().plusWeeks(1).toInstant().toEpochMilli()
        ChallengeEffectiveBucketSize._1M -> zoned().plusMonths(1).toInstant().toEpochMilli()
        null -> startMillis + fallbackMillis
    }
}

/** The bucket-end function for one set of standings: the host's size when sent, inference otherwise (#991). */
fun bucketEndFunction(
    effective: ChallengeEffectiveBucketSize?,
    timezone: String,
    standings: List<ChallengeStanding>,
): (Long) -> Long {
    val inferred = inferBucketMillis(standings)
    return { start -> bucketEndAt(start, effective, timezone, inferred) }
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
    bucketEnd: (Long) -> Long,
): RaceSeries {
    val points = ArrayList<RacePoint>(standing.buckets.size + 1)
    points.add(RacePoint(startMillis, 0.0))
    var running = 0.0
    for (b in standing.buckets.sortedBy { it.bucketStart }) {
        running += b.value
        points.add(RacePoint(bucketEnd(parseInstantMillis(b.bucketStart)), running))
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

/**
 * Active members in leaderboard order, each with its palette colour and
 * competition rank: equal totals share a rank and the next rank skips (1, 1, 3),
 * so a tie for first is two winners — the same ranking the host's completion
 * post uses.
 */
fun leaderboard(standings: List<ChallengeStanding>, myIdentityUrl: String?): List<LeaderboardRow> {
    val me = myIdentityUrl?.trimEnd('/')
    val active = standings.filter { it.status == ChallengeStanding.Status.active }
    return active.mapIndexed { i, s ->
        LeaderboardRow(
            rank = 1 + active.count { it.total > s.total },
            name = s.displayName,
            color = challengeMemberColor(i),
            total = s.total,
            isMe = me != null && s.identityBaseUrl.trimEnd('/') == me,
        )
    }
}

/** 🏆 for the winner, 🥈/🥉 for the runners-up; null below the podium. */
fun podiumMedal(rank: Int): String? =
    when (rank) {
        1 -> "🏆"
        2 -> "🥈"
        3 -> "🥉"
        else -> null
    }

/**
 * The rank column: the medal once the challenge is over (final standings) for a
 * member who actually scored — a 0 is never a podium, as on the web page — else
 * the number.
 */
fun rankLabel(rank: Int, ended: Boolean, total: Double): String =
    (if (ended && total > 0) podiumMedal(rank) else null) ?: rank.toString()

/** True when [visible] ends with the signed-in user's row pulled up from below the cut (see [visibleRows]). */
fun hasSubstitutedMeRow(visible: List<LeaderboardRow>, all: List<LeaderboardRow>): Boolean {
    val last = visible.lastOrNull() ?: return false
    return last.isMe && all.indexOf(last) >= visible.size
}

/**
 * The text of a row's rank cell, or null when the cell is hidden. The narrowest
 * widgets drop ranks to give names room — except on a "me" row that replaced
 * the last visible row (#992): without its rank a 10th place right under the
 * leader reads as 2nd, so that row keeps its rank, prefixed "…" to say rows
 * were skipped.
 */
fun rankCellText(row: LeaderboardRow, showRank: Boolean, ended: Boolean, substituted: Boolean): String? =
    when {
        showRank -> rankLabel(row.rank, ended, row.total)
        substituted && row.isMe -> "…" + rankLabel(row.rank, ended, row.total)
        else -> null
    }

/** The banner a finished challenge shows above the chart: a big emoji, a headline, a detail line. */
data class ChallengeResultBanner(val emoji: String, val headline: String, val detail: String)

/** `a`, `a and b`, `a, b and c`. */
private fun joinNames(names: List<String>): String =
    when (names.size) {
        0 -> ""
        1 -> names[0]
        else -> names.dropLast(1).joinToString(", ") + " and " + names.last()
    }

/**
 * What a finished challenge says from the signed-in user's point of view: a big
 * 🏆 "You won!" when they won (or tied for the win), 🥈/🥉 with the winner named
 * when they made the podium, otherwise who won and where the user finished (or
 * just the winner when the user isn't a member). Null while the challenge is
 * still running or when nobody scored — then there is no result to show.
 */
fun challengeResultBanner(rows: List<LeaderboardRow>, ended: Boolean, unit: String): ChallengeResultBanner? {
    if (!ended) return null
    val winners = rows.filter { it.rank == 1 && it.total > 0 }
    if (winners.isEmpty()) return null
    val me = rows.firstOrNull { it.isMe }
    val winnerNames = joinNames(winners.map { it.name })
    val winnerTotal = "${formatChallengeTotal(winners[0].total)} $unit"
    return when {
        me == null -> ChallengeResultBanner("🏆", "$winnerNames won", winnerTotal)
        // A 0 never medals (matches the web page / the announcement), so it falls through to "won · you finished #n".
        me.total <= 0 -> ChallengeResultBanner("🏆", "$winnerNames won", "$winnerTotal · you finished #${me.rank}")
        me.rank == 1 && winners.size == 1 -> ChallengeResultBanner("🏆", "You won!", winnerTotal)
        me.rank == 1 ->
            ChallengeResultBanner(
                "🏆",
                "You tied for the win!",
                "with ${joinNames(winners.filter { !it.isMe }.map { it.name })} · $winnerTotal",
            )
        me.rank == 2 -> ChallengeResultBanner("🥈", "You came 2nd", "🏆 $winnerNames · $winnerTotal")
        me.rank == 3 -> ChallengeResultBanner("🥉", "You came 3rd", "🏆 $winnerNames · $winnerTotal")
        else -> ChallengeResultBanner("🏆", "$winnerNames won", "$winnerTotal · you finished #${me.rank}")
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
    /** The finished-challenge banner (big emoji + two text lines). */
    const val RESULT = 34
}

/** How the widget divides its height between the result banner, race chart and leaderboard rows. */
data class ChallengeWidgetLayout(
    val rowCount: Int,
    val chartHeightDp: Int,
    val chartWidthDp: Int,
    /** Rank numbers are dropped on the narrowest widgets so names keep some room. */
    val showRank: Boolean,
    /** False when a finished challenge's banner leaves no room for a readable chart. */
    val showChart: Boolean = true,
)

/**
 * Split a widget of [widthDp] × [heightDp] into chart + rows: as many leaderboard
 * rows as fit above a minimum chart height (never more than [memberCount]), the
 * rest of the height going to the chart. A 2×2 cell (~110 dp) yields two rows and
 * a ~36 dp chart; taller widgets show more members, wider ones a longer chart.
 *
 * With [showResult] (a finished challenge) the banner takes its height first; if
 * what's left can't hold a readable chart the chart is dropped and its space
 * goes to leaderboard rows instead — on a 2×2 cell that is the banner + two rows.
 */
fun planChallengeWidgetLayout(
    widthDp: Float,
    heightDp: Float,
    memberCount: Int,
    showResult: Boolean = false,
): ChallengeWidgetLayout {
    val g = ChallengeWidgetGeometry
    val banner = if (showResult) g.RESULT else 0
    val available = (heightDp - 2 * g.PADDING - g.HEADER - banner).coerceAtLeast(0f)
    val roomForRows = floor((available - g.MIN_CHART) / g.ROW).toInt().coerceAtLeast(0)
    val minRows = if (memberCount > 0) 1 else 0
    var rows = minOf(memberCount, roomForRows).coerceAtLeast(minRows)
    val chartRoom = (available - rows * g.ROW).toInt()
    val showChart = !showResult || chartRoom >= g.MIN_CHART
    if (!showChart) rows = minOf(memberCount, floor(available / g.ROW).toInt()).coerceAtLeast(minRows)
    val chartWidth = (widthDp - 2 * g.PADDING).toInt().coerceAtLeast(40)
    return ChallengeWidgetLayout(
        rowCount = rows,
        chartHeightDp = chartRoom.coerceAtLeast(g.MIN_CHART),
        chartWidthDp = chartWidth,
        showRank = widthDp >= g.MIN_WIDTH_FOR_RANK,
        showChart = showChart,
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
    val fmt = DateTimeFormatter.ofPattern("MMM d", locale).withZone(zoneOf(timezone))
    val start = Instant.ofEpochMilli(parseInstantMillis(startTs))
    val end = Instant.ofEpochMilli(parseInstantMillis(endTs) - 1)
    return "${fmt.format(start)} – ${fmt.format(end)}"
}
