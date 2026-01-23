package net.aurboda

import org.junit.Test
import org.junit.Assert.*

/**
 * Unit tests for DataApi models and utilities
 */
class DataApiTest {

    @Test
    fun `getMetricTimeSeconds returns avg value for HR zone metric`() {
        val metric = PeriodMetricStats(
            metric = "hr_zone_2_sec",
            unit = "sec",
            avg = 3600.0,
            min = 3600.0,
            max = 3600.0,
            count = 1,
            stddev = 0.0
        )

        assertEquals(3600.0, getMetricTimeSeconds(metric), 0.01)
    }

    @Test
    fun `getMetricTimeSeconds returns 0 when avg is null`() {
        val metric = PeriodMetricStats(
            metric = "hr_zone_0_sec",
            unit = "sec",
            avg = null
        )

        assertEquals(0.0, getMetricTimeSeconds(metric), 0.01)
    }

    @Test
    fun `getMetricTimeSeconds handles decimal values`() {
        val metric = PeriodMetricStats(
            metric = "hr_zone_1_sec",
            unit = "sec",
            avg = 2498.28
        )

        assertEquals(2498.28, getMetricTimeSeconds(metric), 0.01)
    }

    @Test
    fun `findMetricTimeSeconds returns time for existing metric`() {
        val metrics = listOf(
            PeriodMetricStats(metric = "hr_zone_0_sec", unit = "sec", avg = 1000.0),
            PeriodMetricStats(metric = "hr_zone_1_sec", unit = "sec", avg = 2000.0),
            PeriodMetricStats(metric = "hr_zone_2_sec", unit = "sec", avg = 3000.0)
        )

        assertEquals(2000.0, findMetricTimeSeconds(metrics, "hr_zone_1_sec"), 0.01)
    }

    @Test
    fun `findMetricTimeSeconds returns 0 for missing metric`() {
        val metrics = listOf(
            PeriodMetricStats(metric = "hr_zone_0_sec", unit = "sec", avg = 1000.0)
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
    fun `PeriodMetricStats parses JSON without sum field`() {
        // Simulate API response that doesn't include 'sum'
        val json = """
            {
                "metric": "hr_zone_0_sec",
                "unit": "sec",
                "avg": 3525.0,
                "min": 3525.0,
                "max": 3525.0,
                "count": 1,
                "stddev": 0
            }
        """.trimIndent()

        val parsed = appJson.decodeFromString<PeriodMetricStats>(json)
        assertEquals(3525.0, parsed.avg)
        assertNull(parsed.sum)
        assertEquals(3525.0, getMetricTimeSeconds(parsed), 0.01)
    }

    @Test
    fun `PeriodSummaryResponse parses complete API response`() {
        val json = """
            {
                "success": true,
                "metrics": [
                    {"metric": "hr_zone_0_sec", "unit": "sec", "avg": 3525.0, "count": 1},
                    {"metric": "hr_zone_1_sec", "unit": "sec", "avg": 2498.28, "count": 1}
                ],
                "periodDays": 7,
                "start": "2026-01-17T00:00:00Z",
                "end": "2026-01-23T23:59:59Z"
            }
        """.trimIndent()

        val parsed = appJson.decodeFromString<PeriodSummaryResponse>(json)
        assertTrue(parsed.success)
        assertEquals(2, parsed.metrics.size)
        assertEquals(3525.0, findMetricTimeSeconds(parsed.metrics, "hr_zone_0_sec"), 0.01)
        assertEquals(2498.28, findMetricTimeSeconds(parsed.metrics, "hr_zone_1_sec"), 0.01)
    }
}
