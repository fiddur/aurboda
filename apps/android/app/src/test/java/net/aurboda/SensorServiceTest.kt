package net.aurboda

import net.aurboda.ble.BleConnectionState
import net.aurboda.ble.ConnectedDevice
import net.aurboda.ble.HeartRateSyncSample
import net.aurboda.ble.SensorServiceState
import net.aurboda.ble.SensorType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Tests for SensorService data classes and serialization.
 * These tests verify the data structures used for BLE sensor data sync.
 */
class SensorServiceTest {

    // ========================================================================
    // SensorServiceState Tests
    // ========================================================================

    @Test
    fun `SensorServiceState has correct defaults`() {
        val state = SensorServiceState()

        assertFalse(state.isRunning)
        assertTrue(state.connectionState is BleConnectionState.Disconnected)
        assertNull(state.connectedDevice)
        assertNull(state.currentHeartRate)
        assertNull(state.lastSyncTime)
        assertEquals(0, state.pendingSamples)
    }

    @Test
    fun `SensorServiceState copy updates isRunning`() {
        val initial = SensorServiceState()
        val updated = initial.copy(isRunning = true)

        assertTrue(updated.isRunning)
        assertFalse(initial.isRunning) // Original unchanged
    }

    @Test
    fun `SensorServiceState copy updates connectionState`() {
        val initial = SensorServiceState()
        val updated = initial.copy(connectionState = BleConnectionState.Connected)

        assertTrue(updated.connectionState is BleConnectionState.Connected)
        assertTrue(initial.connectionState is BleConnectionState.Disconnected)
    }

    @Test
    fun `SensorServiceState copy updates connectedDevice`() {
        val device = ConnectedDevice(
            address = "AA:BB:CC:DD:EE:FF",
            name = "Polar H10",
            type = SensorType.HEART_RATE
        )
        val initial = SensorServiceState()
        val updated = initial.copy(connectedDevice = device)

        assertEquals(device, updated.connectedDevice)
        assertNull(initial.connectedDevice)
    }

    @Test
    fun `SensorServiceState copy updates currentHeartRate`() {
        val initial = SensorServiceState()
        val updated = initial.copy(currentHeartRate = 72)

        assertEquals(72, updated.currentHeartRate)
        assertNull(initial.currentHeartRate)
    }

    @Test
    fun `SensorServiceState copy updates pendingSamples`() {
        val initial = SensorServiceState()
        val updated = initial.copy(pendingSamples = 5)

        assertEquals(5, updated.pendingSamples)
        assertEquals(0, initial.pendingSamples)
    }

    @Test
    fun `SensorServiceState copy updates lastSyncTime`() {
        val now = Instant.now()
        val initial = SensorServiceState()
        val updated = initial.copy(lastSyncTime = now)

        assertEquals(now, updated.lastSyncTime)
        assertNull(initial.lastSyncTime)
    }

    @Test
    fun `SensorServiceState supports chained updates`() {
        val device = ConnectedDevice(
            address = "AA:BB:CC:DD:EE:FF",
            name = "Polar H10",
            type = SensorType.HEART_RATE
        )

        val state = SensorServiceState()
            .copy(isRunning = true)
            .copy(connectionState = BleConnectionState.Connected)
            .copy(connectedDevice = device)
            .copy(currentHeartRate = 85)
            .copy(pendingSamples = 3)

        assertTrue(state.isRunning)
        assertTrue(state.connectionState is BleConnectionState.Connected)
        assertEquals(device, state.connectedDevice)
        assertEquals(85, state.currentHeartRate)
        assertEquals(3, state.pendingSamples)
    }

    // ========================================================================
    // HeartRateSyncSample Tests
    // ========================================================================

    @Test
    fun `HeartRateSyncSample stores time as ISO string`() {
        val sample = HeartRateSyncSample(
            time = "2024-01-15T10:30:00Z",
            bpm = 72
        )

        assertEquals("2024-01-15T10:30:00Z", sample.time)
        assertEquals(72, sample.bpm)
        assertNull(sample.rrIntervals)
    }

    @Test
    fun `HeartRateSyncSample with RR intervals`() {
        val sample = HeartRateSyncSample(
            time = "2024-01-15T10:30:00Z",
            bpm = 85,
            rrIntervals = listOf(700, 710, 695)
        )

        assertEquals(85, sample.bpm)
        assertEquals(listOf(700, 710, 695), sample.rrIntervals)
    }

    @Test
    fun `HeartRateSyncSample serializes to correct JSON format`() {
        val sample = HeartRateSyncSample(
            time = "2024-01-15T10:30:00Z",
            bpm = 72,
            rrIntervals = null
        )

        val json = appJson.encodeToString(HeartRateSyncSample.serializer(), sample)

        // Verify JSON contains expected fields
        assertTrue(json.contains("\"time\""))
        assertTrue(json.contains("\"bpm\""))
        assertTrue(json.contains("2024-01-15T10:30:00Z"))
        assertTrue(json.contains("72"))
    }

    @Test
    fun `HeartRateSyncSample serializes rr_intervals with correct key`() {
        val sample = HeartRateSyncSample(
            time = "2024-01-15T10:30:00Z",
            bpm = 85,
            rrIntervals = listOf(700, 710)
        )

        val json = appJson.encodeToString(HeartRateSyncSample.serializer(), sample)

        // The @SerialName annotation should serialize as "rr_intervals"
        assertTrue("JSON should contain rr_intervals key: $json", json.contains("\"rr_intervals\""))
        assertTrue(json.contains("700"))
        assertTrue(json.contains("710"))
    }

    @Test
    fun `HeartRateSyncSample deserializes from JSON`() {
        val json = """{"time":"2024-01-15T10:30:00Z","bpm":72}"""

        val sample = appJson.decodeFromString(HeartRateSyncSample.serializer(), json)

        assertEquals("2024-01-15T10:30:00Z", sample.time)
        assertEquals(72, sample.bpm)
        assertNull(sample.rrIntervals)
    }

    @Test
    fun `HeartRateSyncSample deserializes with rr_intervals`() {
        val json = """{"time":"2024-01-15T10:30:00Z","bpm":85,"rr_intervals":[700,710,695]}"""

        val sample = appJson.decodeFromString(HeartRateSyncSample.serializer(), json)

        assertEquals(85, sample.bpm)
        assertEquals(listOf(700, 710, 695), sample.rrIntervals)
    }

    @Test
    fun `HeartRateSyncSample roundtrip serialization`() {
        val original = HeartRateSyncSample(
            time = "2024-01-15T10:30:00.123Z",
            bpm = 142,
            rrIntervals = listOf(423, 425, 420)
        )

        val json = appJson.encodeToString(HeartRateSyncSample.serializer(), original)
        val restored = appJson.decodeFromString(HeartRateSyncSample.serializer(), json)

        assertEquals(original, restored)
    }

    @Test
    fun `HeartRateSyncSample list serialization for batch sync`() {
        val samples = listOf(
            HeartRateSyncSample("2024-01-15T10:30:00Z", 72),
            HeartRateSyncSample("2024-01-15T10:30:01Z", 73),
            HeartRateSyncSample("2024-01-15T10:30:02Z", 74)
        )

        val json = appJson.encodeToString(
            kotlinx.serialization.builtins.ListSerializer(HeartRateSyncSample.serializer()),
            samples
        )

        assertTrue(json.startsWith("["))
        assertTrue(json.endsWith("]"))
        assertTrue(json.contains("72"))
        assertTrue(json.contains("73"))
        assertTrue(json.contains("74"))
    }

    // ========================================================================
    // BleConnectionState Tests
    // ========================================================================

    @Test
    fun `BleConnectionState Disconnected is singleton`() {
        val state1 = BleConnectionState.Disconnected
        val state2 = BleConnectionState.Disconnected

        assertTrue(state1 === state2)
    }

    @Test
    fun `BleConnectionState Connected is singleton`() {
        val state1 = BleConnectionState.Connected
        val state2 = BleConnectionState.Connected

        assertTrue(state1 === state2)
    }

    @Test
    fun `BleConnectionState Connecting is singleton`() {
        val state1 = BleConnectionState.Connecting
        val state2 = BleConnectionState.Connecting

        assertTrue(state1 === state2)
    }

    @Test
    fun `BleConnectionState Error contains message`() {
        val error = BleConnectionState.Error("Connection timeout")

        assertEquals("Connection timeout", error.message)
    }

    @Test
    fun `BleConnectionState Error equality based on message`() {
        val error1 = BleConnectionState.Error("Error A")
        val error2 = BleConnectionState.Error("Error A")
        val error3 = BleConnectionState.Error("Error B")

        assertEquals(error1, error2)
        assertNotEquals(error1, error3)
    }
}
