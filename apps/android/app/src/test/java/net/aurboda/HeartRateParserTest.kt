package net.aurboda

import net.aurboda.ble.parseHeartRateMeasurement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class HeartRateParserTest {

    @Test
    fun `parse 8-bit heart rate without RR intervals`() {
        // Flags: 0x00 = 8-bit HR, no other fields
        // HR: 72 bpm
        val data = byteArrayOf(0x00, 72)

        val sample = parseHeartRateMeasurement(data)

        assertNotNull(sample)
        assertEquals(72, sample!!.bpm)
        assertNull(sample.rrIntervals)
    }

    @Test
    fun `parse 16-bit heart rate without RR intervals`() {
        // Flags: 0x01 = 16-bit HR
        // HR: 150 bpm (0x0096 in little-endian: 0x96, 0x00)
        val data = byteArrayOf(0x01, 0x96.toByte(), 0x00)

        val sample = parseHeartRateMeasurement(data)

        assertNotNull(sample)
        assertEquals(150, sample!!.bpm)
        assertNull(sample.rrIntervals)
    }

    @Test
    fun `parse 8-bit heart rate with RR intervals`() {
        // Flags: 0x10 = 8-bit HR + RR intervals present
        // HR: 85 bpm
        // RR interval: 0x02C8 (712 in units of 1/1024 sec = ~695 ms)
        val data = byteArrayOf(0x10, 85, 0xC8.toByte(), 0x02)

        val sample = parseHeartRateMeasurement(data)

        assertNotNull(sample)
        assertEquals(85, sample!!.bpm)
        assertNotNull(sample.rrIntervals)
        assertEquals(1, sample.rrIntervals!!.size)
        // (712 * 1000) / 1024 = 695.3125, truncated to 695
        assertEquals(695, sample.rrIntervals!![0])
    }

    @Test
    fun `parse heart rate with multiple RR intervals`() {
        // Flags: 0x10 = 8-bit HR + RR intervals present
        // HR: 80 bpm
        // Two RR intervals
        val data = byteArrayOf(
            0x10,
            80,
            0x00, 0x03,  // First RR: 768 units = 750 ms
            0x00, 0x04   // Second RR: 1024 units = 1000 ms
        )

        val sample = parseHeartRateMeasurement(data)

        assertNotNull(sample)
        assertEquals(80, sample!!.bpm)
        assertNotNull(sample.rrIntervals)
        assertEquals(2, sample.rrIntervals!!.size)
        assertEquals(750, sample.rrIntervals!![0])
        assertEquals(1000, sample.rrIntervals!![1])
    }

    @Test
    fun `parse heart rate with energy expended skipped`() {
        // Flags: 0x08 = energy expended present (but no RR)
        // HR: 100 bpm
        // Energy expended: 2 bytes (skipped in our parser)
        val data = byteArrayOf(0x08, 100, 0x50, 0x00)

        val sample = parseHeartRateMeasurement(data)

        assertNotNull(sample)
        assertEquals(100, sample!!.bpm)
        assertNull(sample.rrIntervals)
    }

    @Test
    fun `parse empty data returns null`() {
        val data = byteArrayOf()

        val sample = parseHeartRateMeasurement(data)

        assertNull(sample)
    }

    @Test
    fun `parse truncated 16-bit data returns null`() {
        // Flags indicate 16-bit but only 1 byte of HR data
        val data = byteArrayOf(0x01, 0x50)

        val sample = parseHeartRateMeasurement(data)

        assertNull(sample)
    }

    @Test
    fun `parse typical Polar H10 data`() {
        // Typical Polar H10 format: 8-bit HR with RR intervals
        // Flags: 0x16 = sensor contact supported & detected + RR intervals
        // HR: 65 bpm
        // RR: ~923 ms
        val data = byteArrayOf(0x16, 65, 0xB6.toByte(), 0x03)

        val sample = parseHeartRateMeasurement(data)

        assertNotNull(sample)
        assertEquals(65, sample!!.bpm)
        assertNotNull(sample.rrIntervals)
        // (950 * 1000) / 1024 = 927
        assertEquals(927, sample.rrIntervals!![0])
    }
}
