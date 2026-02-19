package net.aurboda

import net.aurboda.api.models.GoalProgress
import net.aurboda.api.models.GoalsProgressResponse
import net.aurboda.api.models.MetricType
import net.aurboda.api.models.PeriodMetricStats
import net.aurboda.api.models.PeriodSummaryResponse
import org.junit.Test
import org.junit.Assert.*

/**
 * Unit tests for DataApi models and utilities
 */
class DataApiTest {

    private fun metricStats(
        metric: String = "hr_zone_0_sec",
        unit: String = "sec",
        avg: Double = 0.0,
        min: Double = 0.0,
        max: Double = 0.0,
        count: Int = 1,
        stddev: Double = 0.0,
    ) = PeriodMetricStats(
        avg = avg,
        changeFromPreviousPeriodPercent = null,
        completenessPercent = 100.0,
        count = count,
        max = max,
        metric = metric,
        min = min,
        stddev = stddev,
        trendPerDay = null,
        unit = unit,
    )

    @Test
    fun `getMetricTimeSeconds returns avg value for HR zone metric`() {
        val metric = metricStats(metric = "hr_zone_2_sec", avg = 3600.0, min = 3600.0, max = 3600.0)
        assertEquals(3600.0, getMetricTimeSeconds(metric), 0.01)
    }

    @Test
    fun `getMetricTimeSeconds returns avg value`() {
        val metric = metricStats(avg = 2498.28)
        assertEquals(2498.28, getMetricTimeSeconds(metric), 0.01)
    }

    @Test
    fun `findMetricTimeSeconds returns time for existing metric`() {
        val metrics = listOf(
            metricStats(metric = "hr_zone_0_sec", avg = 1000.0),
            metricStats(metric = "hr_zone_1_sec", avg = 2000.0),
            metricStats(metric = "hr_zone_2_sec", avg = 3000.0),
        )

        assertEquals(2000.0, findMetricTimeSeconds(metrics, "hr_zone_1_sec"), 0.01)
    }

    @Test
    fun `findMetricTimeSeconds returns 0 for missing metric`() {
        val metrics = listOf(
            metricStats(metric = "hr_zone_0_sec", avg = 1000.0),
        )

        assertEquals(0.0, findMetricTimeSeconds(metrics, "hr_zone_5_sec"), 0.01)
    }

    @Test
    fun `formatZoneTime formats minutes correctly`() {
        assertEquals("5 min", formatZoneTime(300.0))
        assertEquals("30 min", formatZoneTime(1800.0))
        assertEquals("0 min", formatZoneTime(0.0))
    }

    @Test
    fun `formatZoneTime formats hours and minutes`() {
        assertEquals("1 h", formatZoneTime(3600.0))
        assertEquals("1 h 30 min", formatZoneTime(5400.0))
        assertEquals("2 h 15 min", formatZoneTime(8100.0))
    }

    @Test
    fun `formatBpmRange formats zone 0 correctly`() {
        val thresholds = defaultHrZoneThresholds
        assertEquals("< 86 bpm", formatBpmRange(0, thresholds))
    }

    @Test
    fun `formatBpmRange formats zone 5 correctly`() {
        val thresholds = defaultHrZoneThresholds
        assertEquals("151+ bpm", formatBpmRange(5, thresholds))
    }

    @Test
    fun `formatBpmRange formats middle zones correctly`() {
        val thresholds = defaultHrZoneThresholds
        assertEquals("86 - 101 bpm", formatBpmRange(1, thresholds))
        assertEquals("102 - 117 bpm", formatBpmRange(2, thresholds))
        assertEquals("118 - 134 bpm", formatBpmRange(3, thresholds))
        assertEquals("135 - 150 bpm", formatBpmRange(4, thresholds))
    }

    @Test
    fun `PeriodMetricStats parses JSON from API response`() {
        val json = """
            {
                "metric": "hr_zone_0_sec",
                "unit": "sec",
                "avg": 3525.0,
                "min": 3525.0,
                "max": 3525.0,
                "count": 1,
                "stddev": 0,
                "completeness_percent": 100.0,
                "trend_per_day": null,
                "change_from_previous_period_percent": null
            }
        """.trimIndent()

        val parsed = appJson.decodeFromString<PeriodMetricStats>(json)
        assertEquals(3525.0, parsed.avg, 0.01)
        assertEquals(3525.0, getMetricTimeSeconds(parsed), 0.01)
    }

    @Test
    fun `GoalProgress deserializes snake_case losing_tomorrow from API`() {
        val json = """
            {
                "id": "a0000001-0000-4000-8000-000000000001",
                "metric": "hr_zone_2_sec",
                "min": 9000,
                "max": null,
                "window": "7d",
                "current": 5400.0,
                "losing_tomorrow": 1200.0,
                "unit": "sec"
            }
        """.trimIndent()

        val parsed = appJson.decodeFromString<GoalProgress>(json)
        assertEquals("a0000001-0000-4000-8000-000000000001", parsed.id)
        assertEquals(MetricType.hr_zone_2_sec, parsed.metric)
        assertEquals(9000.0, parsed.min)
        assertNull(parsed.max)
        assertEquals("7d", parsed.window)
        assertEquals(5400.0, parsed.current, 0.01)
        assertEquals(1200.0, parsed.losingTomorrow, 0.01)
        assertEquals("sec", parsed.unit)
    }

    @Test
    fun `GoalsProgressResponse deserializes complete API response`() {
        val json = """
            {
                "success": true,
                "goals": [
                    {
                        "id": "a0000001-0000-4000-8000-000000000001",
                        "metric": "hr_zone_2_sec",
                        "min": 9000,
                        "window": "7d",
                        "current": 5400.0,
                        "losing_tomorrow": 1200.0,
                        "unit": "sec"
                    },
                    {
                        "id": "a0000002-0000-4000-8000-000000000002",
                        "metric": "steps",
                        "min": 70000,
                        "window": "7d",
                        "current": 45000.0,
                        "losing_tomorrow": 8000.0,
                        "unit": "count"
                    }
                ]
            }
        """.trimIndent()

        val parsed = appJson.decodeFromString<GoalsProgressResponse>(json)
        assertTrue(parsed.success)
        assertEquals(2, parsed.goals.size)
        assertEquals(1200.0, parsed.goals[0].losingTomorrow, 0.01)
        assertEquals(8000.0, parsed.goals[1].losingTomorrow, 0.01)
    }

    @Test
    fun `PeriodSummaryResponse parses complete API response`() {
        val json = """
            {
                "success": true,
                "metrics": [
                    {
                        "metric": "hr_zone_0_sec", "unit": "sec", "avg": 3525.0,
                        "min": 3525.0, "max": 3525.0, "count": 1, "stddev": 0,
                        "completeness_percent": 100.0, "trend_per_day": null,
                        "change_from_previous_period_percent": null
                    },
                    {
                        "metric": "hr_zone_1_sec", "unit": "sec", "avg": 2498.28,
                        "min": 2498.28, "max": 2498.28, "count": 1, "stddev": 0,
                        "completeness_percent": 100.0, "trend_per_day": null,
                        "change_from_previous_period_percent": null
                    }
                ],
                "period_days": 7,
                "start": "2026-01-17T00:00:00Z",
                "end": "2026-01-23T23:59:59Z"
            }
        """.trimIndent()

        val parsed = appJson.decodeFromString<PeriodSummaryResponse>(json)
        assertTrue(parsed.success)
        assertEquals(2, parsed.metrics?.size)
        assertEquals(3525.0, findMetricTimeSeconds(parsed.metrics.orEmpty(), "hr_zone_0_sec"), 0.01)
        assertEquals(2498.28, findMetricTimeSeconds(parsed.metrics.orEmpty(), "hr_zone_1_sec"), 0.01)
    }
}
