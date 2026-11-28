package net.aurboda

import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class PendingDataStoreTest {
    @Test
    fun `a metric queued before units decodes without one`() {
        val stored = """
            [{"id":"e1","data":{"type":"metric","payload":{"metric":"weight","value":72.5,"time":"2026-11-01T08:00:00Z"}},
              "created_at":"2026-11-01T08:00:00Z"}]
        """.trimIndent()
        val payload = (appJson.decodeFromString<List<PendingEntry>>(stored).single().data as PendingPayload.Metric).payload
        assertEquals("weight", payload.metric)
        assertNull(payload.unit)
    }

    @Test
    fun `an activity queued before people and comments decodes without them`() {
        val stored = """
            [{"id":"e0","data":{"type":"activity","payload":{"activity_type":"walk","start_time":"2026-11-01T08:00:00Z",
              "notes":"Along the river"}},"created_at":"2026-11-01T08:00:00Z","fail_count":1,"last_error":"offline"}]
        """.trimIndent()
        val payload = (appJson.decodeFromString<List<PendingEntry>>(stored).single().data as PendingPayload.Activity).payload
        assertEquals("Along the river", payload.notes)
        assertNull(payload.people)
        assertNull(payload.comment)
        assertNull(payload.created_activity_id)
    }

    @Test
    fun `an entry queued before refusals decodes as not refused`() {
        val stored = """
            [{"id":"e4","data":{"type":"metric","payload":{"metric":"weight","value":72.5,"time":"2026-11-01T08:00:00Z"}},
              "created_at":"2026-11-01T08:00:00Z","fail_count":3,"last_error":"Server returned 400 Bad Request"}]
        """.trimIndent()
        assertFalse(appJson.decodeFromString<List<PendingEntry>>(stored).single().refused)
    }

    @Test
    fun `a refused entry survives the queue`() {
        val entry = PendingEntry(
            id = "e5",
            data = PendingPayload.Metric(PendingMetricPayload(metric = "strength_score", value = 3.0, time = "2026-11-01T08:00:00Z")),
            created_at = "2026-11-01T08:00:00Z",
            fail_count = 1,
            last_error = "\"strength_score\" is calculated by Aurboda and cannot be written.",
            refused = true,
        )
        assertEquals(entry, appJson.decodeFromString<List<PendingEntry>>(appJson.encodeToString(listOf(entry))).single())
    }

    @Test
    fun `a sync sends only the entries the server has not refused`() {
        val metric = PendingPayload.Metric(PendingMetricPayload(metric = "weight", value = 72.5, time = "2026-11-01T08:00:00Z"))
        val failed = PendingEntry(id = "a", data = metric, created_at = "2026-11-01T08:00:00Z", fail_count = 2)
        val refused = PendingEntry(id = "b", data = metric, created_at = "2026-11-01T08:00:00Z", fail_count = 1, refused = true)
        val fresh = PendingEntry(id = "c", data = metric, created_at = "2026-11-01T08:00:00Z")
        assertEquals(PendingQueue(toSend = listOf(failed, fresh), refused = 1), pendingQueueOf(listOf(failed, refused, fresh)))
        assertEquals(PendingQueue(toSend = emptyList(), refused = 0), pendingQueueOf(emptyList()))
    }

    @Test
    fun `the idle message names the entries left for the user`() {
        assertEquals("No queued entries", idlePendingDataMessage(0))
        assertEquals("1 entry needs attention", idlePendingDataMessage(1))
        assertEquals("2 entries need attention", idlePendingDataMessage(2))
    }

    @Test
    fun `a metric's unit survives the queue`() {
        val entry = PendingEntry(
            id = "e2",
            data = PendingPayload.Metric(PendingMetricPayload(metric = "ldl", value = 120.0, time = "2026-11-01T08:00:00Z", unit = "mg/dL")),
            created_at = "2026-11-01T08:00:00Z",
        )
        val decoded = appJson.decodeFromString<List<PendingEntry>>(appJson.encodeToString(listOf(entry))).single()
        assertEquals(entry, decoded)
    }

    @Test
    fun `a metric without a unit is stored without the key`() {
        val entry = PendingEntry(
            id = "e3",
            data = PendingPayload.Metric(PendingMetricPayload(metric = "weight", value = 72.5, time = "2026-11-01T08:00:00Z")),
            created_at = "2026-11-01T08:00:00Z",
        )
        assertFalse(appJson.encodeToString(listOf(entry)).contains("\"unit\""))
    }

    @Test
    fun `a flush that adopted a catalogue entry marks its in-use list stale`() {
        val activity = { type: String ->
            PendingPayload.Activity(PendingActivityPayload(activity_type = type, start_time = "2026-11-01T08:00:00Z"))
        }
        val metric = { name: String ->
            PendingPayload.Metric(PendingMetricPayload(metric = name, value = 1.0, time = "2026-11-01T08:00:00Z"))
        }
        val types = listOf(ActivityTypeDefinition(name = "sleep", displayName = "Sleep"))
        val typeCatalog = listOf(CatalogActivityType(name = "yoga", displayName = "Yoga"))
        val metricCatalog = listOf(
            CatalogMetric(name = "ldl", displayName = "LDL", unit = "mg/dL", inUse = false),
            CatalogMetric(name = "hdl", displayName = "HDL", unit = "mg/dL", inUse = true),
        )
        assertEquals(
            CatalogAdoptions(activityTypes = true, metrics = true),
            catalogAdoptions(listOf(activity("yoga"), metric("ldl")), types, typeCatalog, metricCatalog),
        )
        assertEquals(
            CatalogAdoptions(activityTypes = false, metrics = false),
            catalogAdoptions(
                listOf(activity("sleep"), activity("custom_thing"), metric("hdl"), metric("weight")),
                types,
                typeCatalog,
                metricCatalog,
            ),
        )
    }
}
