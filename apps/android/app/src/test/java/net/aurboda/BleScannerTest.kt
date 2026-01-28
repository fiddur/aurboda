package net.aurboda

import net.aurboda.ble.CLIENT_CHARACTERISTIC_CONFIG_UUID
import net.aurboda.ble.HEART_RATE_MEASUREMENT_UUID
import net.aurboda.ble.HEART_RATE_SERVICE_UUID
import net.aurboda.ble.HR_MONITOR_NAME_PATTERNS
import net.aurboda.ble.RSC_MEASUREMENT_UUID
import net.aurboda.ble.RUNNING_SPEED_CADENCE_SERVICE_UUID
import net.aurboda.ble.STEP_SENSOR_NAME_PATTERNS
import net.aurboda.ble.SensorType
import net.aurboda.ble.detectSensorTypeFromName
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.UUID

/**
 * Tests for BLE scanner utilities and constants.
 * These tests verify that the Bluetooth GATT UUIDs are correct
 * according to the Bluetooth SIG specifications.
 */
class BleScannerTest {

    @Test
    fun `heart rate service UUID matches Bluetooth SIG specification`() {
        // Heart Rate Service UUID is 0x180D
        // Full 128-bit UUID: 0000180d-0000-1000-8000-00805f9b34fb
        val expected = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        assertEquals(expected, HEART_RATE_SERVICE_UUID)
    }

    @Test
    fun `running speed and cadence service UUID matches Bluetooth SIG specification`() {
        // RSC Service UUID is 0x1814
        // Full 128-bit UUID: 00001814-0000-1000-8000-00805f9b34fb
        val expected = UUID.fromString("00001814-0000-1000-8000-00805f9b34fb")
        assertEquals(expected, RUNNING_SPEED_CADENCE_SERVICE_UUID)
    }

    @Test
    fun `heart rate measurement characteristic UUID matches Bluetooth SIG specification`() {
        // Heart Rate Measurement UUID is 0x2A37
        val expected = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
        assertEquals(expected, HEART_RATE_MEASUREMENT_UUID)
    }

    @Test
    fun `RSC measurement characteristic UUID matches Bluetooth SIG specification`() {
        // RSC Measurement UUID is 0x2A53
        val expected = UUID.fromString("00002a53-0000-1000-8000-00805f9b34fb")
        assertEquals(expected, RSC_MEASUREMENT_UUID)
    }

    @Test
    fun `client characteristic config descriptor UUID matches Bluetooth SIG specification`() {
        // CCCD UUID is 0x2902
        val expected = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        assertEquals(expected, CLIENT_CHARACTERISTIC_CONFIG_UUID)
    }

    @Test
    fun `all BLE UUIDs use standard Bluetooth base UUID`() {
        // All standard Bluetooth UUIDs should have the same base
        val baseUuidSuffix = "-0000-1000-8000-00805f9b34fb"

        listOf(
            HEART_RATE_SERVICE_UUID,
            RUNNING_SPEED_CADENCE_SERVICE_UUID,
            HEART_RATE_MEASUREMENT_UUID,
            RSC_MEASUREMENT_UUID,
            CLIENT_CHARACTERISTIC_CONFIG_UUID
        ).forEach { uuid ->
            val uuidString = uuid.toString()
            assert(uuidString.endsWith(baseUuidSuffix)) {
                "UUID $uuid does not use standard Bluetooth base UUID"
            }
        }
    }

    // ========================================================================
    // Sensor Type Detection Tests
    // ========================================================================

    @Test
    fun `detectSensorTypeFromName returns null for null input`() {
        val result = detectSensorTypeFromName(null)
        assertNull(result)
    }

    @Test
    fun `detectSensorTypeFromName returns null for empty string`() {
        val result = detectSensorTypeFromName("")
        assertNull(result)
    }

    @Test
    fun `detectSensorTypeFromName returns null for unknown device`() {
        val result = detectSensorTypeFromName("Random Bluetooth Device")
        assertNull(result)
    }

    // Polar heart rate monitors
    @Test
    fun `detectSensorTypeFromName detects Polar H10`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("Polar H10 12345678"))
    }

    @Test
    fun `detectSensorTypeFromName detects Polar H9`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("Polar H9"))
    }

    @Test
    fun `detectSensorTypeFromName detects Polar H7`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("Polar H7 ABCD1234"))
    }

    @Test
    fun `detectSensorTypeFromName detects Polar OH1`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("Polar OH1"))
    }

    @Test
    fun `detectSensorTypeFromName detects Polar Verity Sense`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("Polar Verity Sense"))
    }

    // Wahoo heart rate monitors
    @Test
    fun `detectSensorTypeFromName detects Wahoo TICKR`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("TICKR 1234"))
    }

    @Test
    fun `detectSensorTypeFromName detects Wahoo device`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("Wahoo HR Monitor"))
    }

    // Garmin heart rate monitors
    @Test
    fun `detectSensorTypeFromName detects Garmin HRM`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("Garmin HRM-Dual"))
    }

    @Test
    fun `detectSensorTypeFromName detects generic HRM`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("HRM-Pro"))
    }

    // Coospo heart rate monitors
    @Test
    fun `detectSensorTypeFromName detects Coospo`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("CooSpo H808S"))
    }

    // Magene heart rate monitors
    @Test
    fun `detectSensorTypeFromName detects Magene`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("Magene H64"))
    }

    // Generic heart rate
    @Test
    fun `detectSensorTypeFromName detects generic Heart Rate`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("Heart Rate Monitor"))
    }

    @Test
    fun `detectSensorTypeFromName detects HR Sensor`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("HR Sensor"))
    }

    // Running/step sensors
    @Test
    fun `detectSensorTypeFromName detects Stryd`() {
        assertEquals(SensorType.RUNNING_SPEED_CADENCE, detectSensorTypeFromName("Stryd"))
    }

    @Test
    fun `detectSensorTypeFromName detects Zwift Runpod`() {
        assertEquals(SensorType.RUNNING_SPEED_CADENCE, detectSensorTypeFromName("Zwift Runpod"))
    }

    @Test
    fun `detectSensorTypeFromName detects generic Footpod`() {
        assertEquals(SensorType.RUNNING_SPEED_CADENCE, detectSensorTypeFromName("Footpod Sensor"))
    }

    @Test
    fun `detectSensorTypeFromName detects Milestone Pod`() {
        assertEquals(SensorType.RUNNING_SPEED_CADENCE, detectSensorTypeFromName("Milestone Pod"))
    }

    @Test
    fun `detectSensorTypeFromName detects Runn sensor`() {
        assertEquals(SensorType.RUNNING_SPEED_CADENCE, detectSensorTypeFromName("Runn Smart Treadmill"))
    }

    @Test
    fun `detectSensorTypeFromName detects Speed sensor`() {
        assertEquals(SensorType.RUNNING_SPEED_CADENCE, detectSensorTypeFromName("Speed Sensor 2"))
    }

    @Test
    fun `detectSensorTypeFromName detects Cadence sensor`() {
        assertEquals(SensorType.RUNNING_SPEED_CADENCE, detectSensorTypeFromName("Cadence Sensor"))
    }

    // Case insensitivity
    @Test
    fun `detectSensorTypeFromName is case insensitive for uppercase`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("POLAR H10"))
    }

    @Test
    fun `detectSensorTypeFromName is case insensitive for mixed case`() {
        assertEquals(SensorType.HEART_RATE, detectSensorTypeFromName("PoLaR h10"))
    }

    @Test
    fun `detectSensorTypeFromName is case insensitive for lowercase`() {
        assertEquals(SensorType.RUNNING_SPEED_CADENCE, detectSensorTypeFromName("zwift runpod"))
    }

    // Pattern list coverage
    @Test
    fun `HR_MONITOR_NAME_PATTERNS contains expected patterns`() {
        val expectedPatterns = listOf(
            "polar", "h10", "h9", "h7", "oh1", "verity",
            "wahoo", "tickr",
            "garmin", "hrm",
            "coospo", "csc",
            "magene",
            "heart rate", "hr sensor"
        )

        expectedPatterns.forEach { pattern ->
            assert(HR_MONITOR_NAME_PATTERNS.contains(pattern)) {
                "HR_MONITOR_NAME_PATTERNS should contain '$pattern'"
            }
        }
    }

    @Test
    fun `STEP_SENSOR_NAME_PATTERNS contains expected patterns`() {
        val expectedPatterns = listOf(
            "stryd", "runpod", "zwift", "footpod",
            "milestone", "runn", "speed", "cadence"
        )

        expectedPatterns.forEach { pattern ->
            assert(STEP_SENSOR_NAME_PATTERNS.contains(pattern)) {
                "STEP_SENSOR_NAME_PATTERNS should contain '$pattern'"
            }
        }
    }
}
