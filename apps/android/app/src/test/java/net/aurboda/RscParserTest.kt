package net.aurboda

import net.aurboda.ble.parseRscMeasurement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RscParserTest {

    // Note: Raw cadence from sensor is multiplied by 2 to convert stride rate to step rate
    // So raw value 60 becomes 120 SPM, raw 90 becomes 180 SPM, etc.

    @Test
    fun `parse basic RSC measurement without optional fields`() {
        // Flags: 0x00 = no stride length, no total distance, walking
        // Speed: 0x0100 = 256 raw = 1.0 m/s (little-endian: 0x00, 0x01)
        // Raw cadence: 60 (stride rate) -> 120 spm (step rate)
        val data = byteArrayOf(0x00, 0x00, 0x01, 60)

        val sample = parseRscMeasurement(data)

        assertNotNull(sample)
        assertEquals(120, sample!!.cadence)  // 60 * 2 = 120 steps/min
        assertEquals(1.0f, sample.speed!!, 0.01f)
        assertNull(sample.strideLengthCm)
        assertNull(sample.totalDistanceMeters)
        assertFalse(sample.isRunning)
    }

    @Test
    fun `parse RSC measurement with running flag`() {
        // Flags: 0x04 = running
        // Speed: 0x0200 = 512 raw = 2.0 m/s
        // Raw cadence: 90 -> 180 spm
        val data = byteArrayOf(0x04, 0x00, 0x02, 90)

        val sample = parseRscMeasurement(data)

        assertNotNull(sample)
        assertEquals(180, sample!!.cadence)  // 90 * 2 = 180 steps/min
        assertEquals(2.0f, sample.speed!!, 0.01f)
        assertTrue(sample.isRunning)
    }

    @Test
    fun `parse RSC measurement with stride length`() {
        // Flags: 0x01 = stride length present
        // Speed: 0x0180 = 384 raw = 1.5 m/s
        // Raw cadence: 80 -> 160 spm
        // Stride length: 0x0064 = 100 cm
        val data = byteArrayOf(0x01, 0x80.toByte(), 0x01, 80, 0x64, 0x00)

        val sample = parseRscMeasurement(data)

        assertNotNull(sample)
        assertEquals(160, sample!!.cadence)  // 80 * 2 = 160 steps/min
        assertEquals(1.5f, sample.speed!!, 0.01f)
        assertEquals(100, sample.strideLengthCm)
        assertNull(sample.totalDistanceMeters)
    }

    @Test
    fun `parse RSC measurement with total distance`() {
        // Flags: 0x02 = total distance present
        // Speed: 0x0100 = 256 raw = 1.0 m/s
        // Raw cadence: 60 -> 120 spm
        // Total distance: 0x000003E8 = 1000 raw = 100.0 meters (little-endian)
        val data = byteArrayOf(0x02, 0x00, 0x01, 60, 0xE8.toByte(), 0x03, 0x00, 0x00)

        val sample = parseRscMeasurement(data)

        assertNotNull(sample)
        assertEquals(120, sample!!.cadence)  // 60 * 2 = 120 steps/min
        assertEquals(100.0f, sample.totalDistanceMeters!!, 0.01f)
    }

    @Test
    fun `parse RSC measurement with all optional fields`() {
        // Flags: 0x07 = stride length + total distance + running
        // Speed: 0x0280 = 640 raw = 2.5 m/s
        // Raw cadence: 88 -> 176 spm (close to 175, adjusted for integer math)
        // Stride length: 0x0078 = 120 cm
        // Total distance: 0x00001388 = 5000 raw = 500.0 meters
        val data = byteArrayOf(
            0x07,
            0x80.toByte(), 0x02,  // speed
            88,                   // raw cadence -> 176 spm
            0x78, 0x00,           // stride length
            0x88.toByte(), 0x13, 0x00, 0x00  // total distance
        )

        val sample = parseRscMeasurement(data)

        assertNotNull(sample)
        assertEquals(176, sample!!.cadence)  // 88 * 2 = 176 steps/min
        assertEquals(2.5f, sample.speed!!, 0.01f)
        assertEquals(120, sample.strideLengthCm)
        assertEquals(500.0f, sample.totalDistanceMeters!!, 0.01f)
        assertTrue(sample.isRunning)
    }

    @Test
    fun `parse zero speed returns null speed`() {
        // Speed of 0 should return null (stationary)
        // Raw cadence: 30 -> 60 spm
        val data = byteArrayOf(0x00, 0x00, 0x00, 30)

        val sample = parseRscMeasurement(data)

        assertNotNull(sample)
        assertEquals(60, sample!!.cadence)  // 30 * 2 = 60 steps/min
        assertNull(sample.speed)
    }

    @Test
    fun `parse empty data returns null`() {
        val data = byteArrayOf()

        val sample = parseRscMeasurement(data)

        assertNull(sample)
    }

    @Test
    fun `parse truncated data returns null`() {
        // Only 3 bytes when minimum is 4 (flags + speed(2) + cadence(1))
        val data = byteArrayOf(0x00, 0x00, 0x01)

        val sample = parseRscMeasurement(data)

        assertNull(sample)
    }

    @Test
    fun `parse typical footpod data`() {
        // Typical footpod running data
        // Flags: 0x05 = stride length + running
        // Speed: ~3.5 m/s (fast run)
        // Raw cadence: 92 -> 184 spm (typical fast running cadence)
        // Stride length: 115 cm
        val data = byteArrayOf(
            0x05,
            0x80.toByte(), 0x03,  // speed: 896/256 = 3.5 m/s
            92,                   // raw cadence -> 184 spm
            0x73, 0x00            // stride length: 115 cm
        )

        val sample = parseRscMeasurement(data)

        assertNotNull(sample)
        assertEquals(184, sample!!.cadence)  // 92 * 2 = 184 steps/min
        assertEquals(3.5f, sample.speed!!, 0.01f)
        assertEquals(115, sample.strideLengthCm)
        assertTrue(sample.isRunning)
    }

    @Test
    fun `cadence is doubled from raw stride rate to step rate`() {
        // Verify the stride-to-step conversion explicitly
        // Walking at 55 strides/min should show as 110 steps/min
        val data = byteArrayOf(0x00, 0x00, 0x01, 55)

        val sample = parseRscMeasurement(data)

        assertNotNull(sample)
        assertEquals(110, sample!!.cadence)  // 55 strides * 2 = 110 steps
    }
}
