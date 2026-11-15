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
}
