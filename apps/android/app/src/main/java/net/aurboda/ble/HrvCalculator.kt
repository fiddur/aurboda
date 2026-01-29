package net.aurboda.ble

import kotlin.math.sqrt

/**
 * Result of HRV calculation including RMSSD value and quality metrics.
 */
data class HrvResult(
    val rmssd: Double?,           // null if insufficient valid data
    val validIntervals: Int,
    val artifactCount: Int,
    val artifactPercentage: Double,
    val isReliable: Boolean       // <10% artifacts && >=30 valid intervals
)

/**
 * Filters RR intervals based on physiological bounds and successive difference.
 *
 * @param intervals Raw RR intervals in milliseconds
 * @param minMs Minimum physiologically valid RR interval (default 300ms = 200 bpm)
 * @param maxMs Maximum physiologically valid RR interval (default 2000ms = 30 bpm)
 * @param maxSuccessiveDiffPercent Maximum allowed difference between successive intervals
 *                                  as a percentage of the previous interval (default 20%)
 * @return List of filtered RR intervals
 */
fun filterRrIntervals(
    intervals: List<Int>,
    minMs: Int = 300,
    maxMs: Int = 2000,
    maxSuccessiveDiffPercent: Double = 0.20
): List<Int> {
    if (intervals.isEmpty()) return emptyList()

    val result = mutableListOf<Int>()

    for (i in intervals.indices) {
        val rr = intervals[i]

        // Check physiological bounds
        if (rr < minMs || rr > maxMs) continue

        // Check successive difference (only if we have a previous valid interval)
        if (result.isNotEmpty()) {
            val prevRr = result.last()
            val diff = kotlin.math.abs(rr - prevRr)
            val threshold = prevRr * maxSuccessiveDiffPercent
            if (diff > threshold) continue
        }

        result.add(rr)
    }

    return result
}

/**
 * Calculates RMSSD (Root Mean Square of Successive Differences) from filtered RR intervals.
 *
 * RMSSD is a time-domain HRV metric that reflects parasympathetic (vagal) activity.
 * It requires at least 2 intervals to calculate a meaningful value, but statistically
 * valid measurements need 30+ intervals.
 *
 * @param filteredIntervals RR intervals in milliseconds (should already be filtered)
 * @return RMSSD value in milliseconds, or null if insufficient data
 */
fun calculateRmssd(filteredIntervals: List<Int>): Double? {
    if (filteredIntervals.size < 2) return null

    var sumSquaredDiffs = 0.0
    var count = 0

    for (i in 1 until filteredIntervals.size) {
        val diff = filteredIntervals[i] - filteredIntervals[i - 1]
        sumSquaredDiffs += diff.toDouble() * diff.toDouble()
        count++
    }

    if (count == 0) return null

    return sqrt(sumSquaredDiffs / count)
}

/**
 * Calculates HRV (RMSSD) with artifact filtering and quality metrics.
 *
 * @param rrIntervals Raw RR intervals in milliseconds
 * @param minValidIntervals Minimum number of valid intervals for reliable measurement (default 30)
 * @param maxArtifactPercent Maximum artifact percentage for reliable measurement (default 10%)
 * @return HrvResult containing RMSSD value and quality metrics
 */
fun calculateHrv(
    rrIntervals: List<Int>,
    minValidIntervals: Int = 30,
    maxArtifactPercent: Double = 10.0
): HrvResult {
    val totalCount = rrIntervals.size
    val filtered = filterRrIntervals(rrIntervals)
    val artifactCount = totalCount - filtered.size
    val artifactPercentage = if (totalCount > 0) {
        (artifactCount.toDouble() / totalCount) * 100.0
    } else {
        0.0
    }

    val rmssd = calculateRmssd(filtered)

    val isReliable = filtered.size >= minValidIntervals &&
            artifactPercentage <= maxArtifactPercent &&
            rmssd != null

    return HrvResult(
        rmssd = rmssd,
        validIntervals = filtered.size,
        artifactCount = artifactCount,
        artifactPercentage = artifactPercentage,
        isReliable = isReliable
    )
}
