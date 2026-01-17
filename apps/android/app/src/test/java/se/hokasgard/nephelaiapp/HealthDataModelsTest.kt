package se.hokasgard.nephelaiapp

import org.junit.Test
import org.junit.Assert.*
import java.time.Instant
import java.time.ZoneOffset

/**
 * Unit tests for HealthDataModels utilities
 */
class HealthDataModelsTest {

    @Test
    fun `toIsoString formats instant correctly in UTC`() {
        val instant = Instant.parse("2024-01-15T10:30:00Z")
        assertEquals("2024-01-15T10:30:00Z", instant.toIsoString())
    }

    @Test
    fun `toIsoString handles epoch instant`() {
        val instant = Instant.EPOCH
        assertEquals("1970-01-01T00:00:00Z", instant.toIsoString())
    }

    @Test
    fun `toIsoString handles milliseconds`() {
        val instant = Instant.parse("2024-06-20T14:25:30.123Z")
        // The formatter should include milliseconds
        assertTrue(instant.toIsoString().startsWith("2024-06-20T14:25:30"))
    }

    @Test
    fun `appJson configuration is lenient`() {
        // Test that the JSON configuration can parse with unknown keys
        val jsonString = """{"known": "value", "unknown": "ignored"}"""

        @kotlinx.serialization.Serializable
        data class TestData(val known: String)

        val result = appJson.decodeFromString<TestData>(jsonString)
        assertEquals("value", result.known)
    }

    @Test
    fun `appJson encodes defaults`() {
        @kotlinx.serialization.Serializable
        data class TestWithDefault(val value: String = "default")

        val result = appJson.encodeToString(kotlinx.serialization.serializer(), TestWithDefault())
        assertTrue(result.contains("default"))
    }

    @Test
    fun `DeviceSerializable holds device info correctly`() {
        val device = DeviceSerializable(
            manufacturer = "Samsung",
            model = "Galaxy Watch 5",
            type = 1
        )

        assertEquals("Samsung", device.manufacturer)
        assertEquals("Galaxy Watch 5", device.model)
        assertEquals(1, device.type)
    }

    @Test
    fun `DeviceSerializable handles null manufacturer and model`() {
        val device = DeviceSerializable(
            manufacturer = null,
            model = null,
            type = 0
        )

        assertNull(device.manufacturer)
        assertNull(device.model)
        assertEquals(0, device.type)
    }

    @Test
    fun `HealthConnectRecordMetadata stores all fields`() {
        val metadata = HealthConnectRecordMetadata(
            id = "test-id-123",
            dataOrigin = "com.example.app",
            lastModifiedTime = "2024-01-15T10:30:00Z",
            clientRecordId = "client-123",
            clientRecordVersion = 1L,
            device = DeviceSerializable("Test", "Model", 1),
            recordingMethod = 2
        )

        assertEquals("test-id-123", metadata.id)
        assertEquals("com.example.app", metadata.dataOrigin)
        assertEquals("2024-01-15T10:30:00Z", metadata.lastModifiedTime)
        assertEquals("client-123", metadata.clientRecordId)
        assertEquals(1L, metadata.clientRecordVersion)
        assertNotNull(metadata.device)
        assertEquals(2, metadata.recordingMethod)
    }

    @Test
    fun `HeartRateSampleSerializable stores sample data`() {
        val sample = HeartRateSampleSerializable(
            time = "2024-01-15T10:30:00Z",
            beatsPerMinute = 72L
        )

        assertEquals("2024-01-15T10:30:00Z", sample.time)
        assertEquals(72L, sample.beatsPerMinute)
    }

    @Test
    fun `StepsRecordSerializable stores step count`() {
        val metadata = HealthConnectRecordMetadata(
            id = "steps-1",
            dataOrigin = "com.google.android.apps.fitness",
            lastModifiedTime = "2024-01-15T10:30:00Z",
            clientRecordId = null,
            clientRecordVersion = 0L,
            device = null,
            recordingMethod = 1
        )

        val record = StepsRecordSerializable(
            startTime = "2024-01-15T08:00:00Z",
            endTime = "2024-01-15T09:00:00Z",
            count = 5432L,
            metadata = metadata
        )

        assertEquals(5432L, record.count)
        assertEquals("2024-01-15T08:00:00Z", record.startTime)
        assertEquals("2024-01-15T09:00:00Z", record.endTime)
    }

    @Test
    fun `SleepStageSerializable stores stage info`() {
        val stage = SleepStageSerializable(
            startTime = "2024-01-15T23:00:00Z",
            endTime = "2024-01-16T01:00:00Z",
            stage = 4 // Deep sleep
        )

        assertEquals(4, stage.stage)
        assertEquals("2024-01-15T23:00:00Z", stage.startTime)
        assertEquals("2024-01-16T01:00:00Z", stage.endTime)
    }

    @Test
    fun `allRecordTypes contains expected record classes`() {
        // Verify the list contains key health record types
        val typeNames = allRecordTypes.map { it.simpleName }

        assertTrue("Should contain HeartRateRecord", typeNames.contains("HeartRateRecord"))
        assertTrue("Should contain StepsRecord", typeNames.contains("StepsRecord"))
        assertTrue("Should contain SleepSessionRecord", typeNames.contains("SleepSessionRecord"))
        assertTrue("Should contain WeightRecord", typeNames.contains("WeightRecord"))
        assertTrue("Should contain ExerciseSessionRecord", typeNames.contains("ExerciseSessionRecord"))
    }

    @Test
    fun `allRecordTypes has no duplicates`() {
        val uniqueTypes = allRecordTypes.toSet()
        assertEquals(allRecordTypes.size, uniqueTypes.size)
    }
}
