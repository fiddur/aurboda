package net.aurboda

import net.aurboda.api.models.GoalProgress
import net.aurboda.api.models.GoalsProgressResponse
import net.aurboda.api.models.MetricType
import org.junit.Test
import org.junit.Assert.*

/**
 * Unit tests for DataApi models and utilities
 */
class DataApiTest {

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
    fun `AddActivityBody serializes correctly`() {
        val body = AddActivityBody(
            activityType = "exercise",
            startTime = "2026-04-14T10:00:00+02:00",
            endTime = "2026-04-14T11:00:00+02:00",
            title = "Morning run",
            notes = null,
        )
        val json = appJson.encodeToString(AddActivityBody.serializer(), body)
        assertTrue(json.contains("\"activity_type\""))
        assertTrue(json.contains("\"start_time\""))
        assertTrue(json.contains("\"exercise\""))
    }

    @Test
    fun `AddActivityResponse deserializes success response`() {
        val json = """
            {
                "success": true,
                "data": {
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "activity_type": "exercise",
                    "start_time": "2026-04-14T10:00:00Z",
                    "end_time": "2026-04-14T11:00:00Z",
                    "title": "Morning run"
                }
            }
        """.trimIndent()

        val parsed = appJson.decodeFromString<AddActivityResponse>(json)
        assertTrue(parsed.success)
        assertEquals("550e8400-e29b-41d4-a716-446655440000", parsed.data?.id)
        assertEquals("exercise", parsed.data?.activityType)
    }
}
