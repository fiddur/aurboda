package net.aurboda

import net.aurboda.ble.BleConnectionState
import net.aurboda.ble.ConnectedDevice
import net.aurboda.ble.LiveHeartRateSample
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
    // LiveHeartRateSample Tests (Health Connect format)
    // ========================================================================

    @Test
    fun `LiveHeartRateSample stores time and beatsPerMinute`() {
        val sample = LiveHeartRateSample(
            time = "2024-01-15T10:30:00Z",
            beatsPerMinute = 72L
        )

        assertEquals("2024-01-15T10:30:00Z", sample.time)
        assertEquals(72L, sample.beatsPerMinute)
    }

    @Test
    fun `LiveHeartRateSample serializes to Health Connect JSON format`() {
        val sample = LiveHeartRateSample(
            time = "2024-01-15T10:30:00Z",
            beatsPerMinute = 72L
        )

        val json = appJson.encodeToString(LiveHeartRateSample.serializer(), sample)

        // Verify JSON contains expected fields (Health Connect format)
        assertTrue(json.contains("\"time\""))
        assertTrue(json.contains("\"beatsPerMinute\""))
        assertTrue(json.contains("2024-01-15T10:30:00Z"))
        assertTrue(json.contains("72"))
    }

    @Test
    fun `LiveHeartRateSample deserializes from JSON`() {
        val json = """{"time":"2024-01-15T10:30:00Z","beatsPerMinute":72}"""

        val sample = appJson.decodeFromString(LiveHeartRateSample.serializer(), json)

        assertEquals("2024-01-15T10:30:00Z", sample.time)
        assertEquals(72L, sample.beatsPerMinute)
    }

    @Test
    fun `LiveHeartRateSample roundtrip serialization`() {
        val original = LiveHeartRateSample(
            time = "2024-01-15T10:30:00.123Z",
            beatsPerMinute = 142L
        )

        val json = appJson.encodeToString(LiveHeartRateSample.serializer(), original)
        val restored = appJson.decodeFromString(LiveHeartRateSample.serializer(), json)

        assertEquals(original, restored)
    }

    @Test
    fun `LiveHeartRateSample list serialization for batch sync`() {
        val samples = listOf(
            LiveHeartRateSample("2024-01-15T10:30:00Z", 72L),
            LiveHeartRateSample("2024-01-15T10:30:01Z", 73L),
            LiveHeartRateSample("2024-01-15T10:30:02Z", 74L)
        )

        val json = appJson.encodeToString(
            kotlinx.serialization.builtins.ListSerializer(LiveHeartRateSample.serializer()),
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
