package net.aurboda

import net.aurboda.ble.CadenceSample
import net.aurboda.ble.ConnectedDevice
import net.aurboda.ble.DiscoveredDevice
import net.aurboda.ble.HeartRateSample
import net.aurboda.ble.SensorType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Tests for BLE sensor data classes.
 * These tests verify the data structures used for sensor readings.
 */
class BleSensorDataTest {

    // ========================================================================
    // SensorType Tests
    // ========================================================================

    @Test
    fun `SensorType has HEART_RATE value`() {
        val type = SensorType.HEART_RATE
        assertEquals("HEART_RATE", type.name)
    }

    @Test
    fun `SensorType has RUNNING_SPEED_CADENCE value`() {
        val type = SensorType.RUNNING_SPEED_CADENCE
        assertEquals("RUNNING_SPEED_CADENCE", type.name)
    }

    @Test
    fun `SensorType valueOf works for HEART_RATE`() {
        val type = SensorType.valueOf("HEART_RATE")
        assertEquals(SensorType.HEART_RATE, type)
    }

    @Test
    fun `SensorType valueOf works for RUNNING_SPEED_CADENCE`() {
        val type = SensorType.valueOf("RUNNING_SPEED_CADENCE")
        assertEquals(SensorType.RUNNING_SPEED_CADENCE, type)
    }

    // ========================================================================
    // HeartRateSample Tests
    // ========================================================================

    @Test
    fun `HeartRateSample stores basic heart rate`() {
        val timestamp = Instant.parse("2024-01-15T10:30:00Z")
        val sample = HeartRateSample(
            timestamp = timestamp,
            bpm = 72
        )

        assertEquals(timestamp, sample.timestamp)
        assertEquals(72, sample.bpm)
        assertNull(sample.rrIntervals)
    }

    @Test
    fun `HeartRateSample stores RR intervals`() {
        val timestamp = Instant.now()
        val rrIntervals = listOf(800, 810, 795)
        val sample = HeartRateSample(
            timestamp = timestamp,
            bpm = 75,
            rrIntervals = rrIntervals
        )

        assertEquals(75, sample.bpm)
        assertEquals(rrIntervals, sample.rrIntervals)
    }

    @Test
    fun `HeartRateSample equality based on all fields`() {
        val timestamp = Instant.parse("2024-01-15T10:30:00Z")

        val sample1 = HeartRateSample(timestamp, 72, listOf(800))
        val sample2 = HeartRateSample(timestamp, 72, listOf(800))
        val sample3 = HeartRateSample(timestamp, 73, listOf(800))

        assertEquals(sample1, sample2)
        assertNotEquals(sample1, sample3)
    }

    @Test
    fun `HeartRateSample handles high heart rates`() {
        val sample = HeartRateSample(
            timestamp = Instant.now(),
            bpm = 200  // Maximum athletic heart rate
        )

        assertEquals(200, sample.bpm)
    }

    @Test
    fun `HeartRateSample handles low heart rates`() {
        val sample = HeartRateSample(
            timestamp = Instant.now(),
            bpm = 40  // Bradycardia / athletic resting HR
        )

        assertEquals(40, sample.bpm)
    }

    // ========================================================================
    // CadenceSample Tests
    // ========================================================================

    @Test
    fun `CadenceSample stores cadence without speed`() {
        val timestamp = Instant.now()
        val sample = CadenceSample(
            timestamp = timestamp,
            cadence = 180,  // steps per minute
            speed = null
        )

        assertEquals(180, sample.cadence)
        assertNull(sample.speed)
    }

    @Test
    fun `CadenceSample stores cadence with speed`() {
        val timestamp = Instant.now()
        val sample = CadenceSample(
            timestamp = timestamp,
            cadence = 175,
            speed = 3.5f  // m/s (~12.6 km/h)
        )

        assertEquals(175, sample.cadence)
        assertEquals(3.5f, sample.speed)
    }

    @Test
    fun `CadenceSample equality based on all fields`() {
        val timestamp = Instant.parse("2024-01-15T10:30:00Z")

        val sample1 = CadenceSample(timestamp, 180, 3.5f)
        val sample2 = CadenceSample(timestamp, 180, 3.5f)
        val sample3 = CadenceSample(timestamp, 180, 3.6f)

        assertEquals(sample1, sample2)
        assertNotEquals(sample1, sample3)
    }

    // ========================================================================
    // DiscoveredDevice Tests
    // ========================================================================

    @Test
    fun `DiscoveredDevice stores all fields`() {
        val device = DiscoveredDevice(
            address = "AA:BB:CC:DD:EE:FF",
            name = "Polar H10",
            rssi = -65,
            sensorType = SensorType.HEART_RATE
        )

        assertEquals("AA:BB:CC:DD:EE:FF", device.address)
        assertEquals("Polar H10", device.name)
        assertEquals(-65, device.rssi)
        assertEquals(SensorType.HEART_RATE, device.sensorType)
    }

    @Test
    fun `DiscoveredDevice handles null name`() {
        val device = DiscoveredDevice(
            address = "AA:BB:CC:DD:EE:FF",
            name = null,
            rssi = -70,
            sensorType = SensorType.HEART_RATE
        )

        assertNull(device.name)
        assertEquals("AA:BB:CC:DD:EE:FF", device.address)
    }

    @Test
    fun `DiscoveredDevice stores RSC sensor type`() {
        val device = DiscoveredDevice(
            address = "11:22:33:44:55:66",
            name = "Zwift Runpod",
            rssi = -55,
            sensorType = SensorType.RUNNING_SPEED_CADENCE
        )

        assertEquals(SensorType.RUNNING_SPEED_CADENCE, device.sensorType)
    }

    @Test
    fun `DiscoveredDevice RSSI typical range`() {
        // RSSI typically ranges from -30 (very close) to -100 (very far)
        val closeDevice = DiscoveredDevice(
            address = "AA:BB:CC:DD:EE:FF",
            name = "Close Device",
            rssi = -30,
            sensorType = SensorType.HEART_RATE
        )

        val farDevice = DiscoveredDevice(
            address = "11:22:33:44:55:66",
            name = "Far Device",
            rssi = -95,
            sensorType = SensorType.HEART_RATE
        )

        assertTrue(closeDevice.rssi > farDevice.rssi)
    }

    // ========================================================================
    // ConnectedDevice Tests
    // ========================================================================

    @Test
    fun `ConnectedDevice stores all fields`() {
        val device = ConnectedDevice(
            address = "AA:BB:CC:DD:EE:FF",
            name = "Polar H10",
            type = SensorType.HEART_RATE
        )

        assertEquals("AA:BB:CC:DD:EE:FF", device.address)
        assertEquals("Polar H10", device.name)
        assertEquals(SensorType.HEART_RATE, device.type)
    }

    @Test
    fun `ConnectedDevice handles null name`() {
        val device = ConnectedDevice(
            address = "AA:BB:CC:DD:EE:FF",
            name = null,
            type = SensorType.HEART_RATE
        )

        assertNull(device.name)
    }

    @Test
    fun `ConnectedDevice equality based on all fields`() {
        val device1 = ConnectedDevice("AA:BB:CC:DD:EE:FF", "Polar H10", SensorType.HEART_RATE)
        val device2 = ConnectedDevice("AA:BB:CC:DD:EE:FF", "Polar H10", SensorType.HEART_RATE)
        val device3 = ConnectedDevice("11:22:33:44:55:66", "Polar H10", SensorType.HEART_RATE)

        assertEquals(device1, device2)
        assertNotEquals(device1, device3)
    }

    @Test
    fun `ConnectedDevice can be created from DiscoveredDevice data`() {
        val discovered = DiscoveredDevice(
            address = "AA:BB:CC:DD:EE:FF",
            name = "Polar H10",
            rssi = -65,
            sensorType = SensorType.HEART_RATE
        )

        val connected = ConnectedDevice(
            address = discovered.address,
            name = discovered.name,
            type = discovered.sensorType
        )

        assertEquals(discovered.address, connected.address)
        assertEquals(discovered.name, connected.name)
        assertEquals(discovered.sensorType, connected.type)
    }
}
