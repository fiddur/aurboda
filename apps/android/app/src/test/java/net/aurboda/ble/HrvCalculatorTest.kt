package net.aurboda.ble

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.sqrt

class HrvCalculatorTest {

    // --- filterRrIntervals tests ---

    @Test
    fun `filterRrIntervals returns empty for empty input`() {
        val result = filterRrIntervals(emptyList())
        assertTrue(result.isEmpty())
    }

    @Test
    fun `filterRrIntervals filters out intervals below minimum`() {
        val intervals = listOf(800, 200, 850, 250, 900)
        val result = filterRrIntervals(intervals, minMs = 300)
        // 200 and 250 are below minimum, should be filtered
        assertEquals(listOf(800, 850, 900), result)
    }

    @Test
    fun `filterRrIntervals filters out intervals above maximum`() {
        val intervals = listOf(800, 2500, 850, 3000, 900)
        val result = filterRrIntervals(intervals, maxMs = 2000)
        // 2500 and 3000 are above maximum, should be filtered
        assertEquals(listOf(800, 850, 900), result)
    }

    @Test
    fun `filterRrIntervals filters out large successive differences`() {
        // At 20% threshold, jumping from 800ms to 1100ms (37.5% change) should be filtered
        val intervals = listOf(800, 850, 1100, 900)
        val result = filterRrIntervals(intervals, maxSuccessiveDiffPercent = 0.20)
        // 1100 is >20% change from 850 (threshold = 170ms, diff = 250ms)
        // 900 is also >20% change from 850 if we skipped 1100
        // But if 1100 is rejected, we compare 900 to 850, which is 50ms (5.9% change) - OK
        assertEquals(listOf(800, 850, 900), result)
    }

    @Test
    fun `filterRrIntervals accepts intervals within successive difference threshold`() {
        // Normal variation within 20%
        val intervals = listOf(800, 840, 810, 850, 830)
        val result = filterRrIntervals(intervals, maxSuccessiveDiffPercent = 0.20)
        assertEquals(intervals, result)
    }

    @Test
    fun `filterRrIntervals keeps first valid interval even if previous was filtered`() {
        val intervals = listOf(200, 800, 850)  // 200 is below min
        val result = filterRrIntervals(intervals, minMs = 300)
        // 200 is filtered, 800 is first valid, 850 compared to 800 (6.25% change)
        assertEquals(listOf(800, 850), result)
    }

    // --- calculateRmssd tests ---

    @Test
    fun `calculateRmssd returns null for empty list`() {
        val result = calculateRmssd(emptyList())
        assertNull(result)
    }

    @Test
    fun `calculateRmssd returns null for single interval`() {
        val result = calculateRmssd(listOf(800))
        assertNull(result)
    }

    @Test
    fun `calculateRmssd calculates correctly for known values`() {
        // RR intervals: 800, 810, 830, 820, 840
        // Successive differences: 10, 20, -10, 20
        // Squared differences: 100, 400, 100, 400
        // Mean of squared: 1000/4 = 250
        // RMSSD = sqrt(250) ≈ 15.81
        val intervals = listOf(800, 810, 830, 820, 840)
        val result = calculateRmssd(intervals)
        assertNotNull(result)
        assertEquals(sqrt(250.0), result!!, 0.01)
    }

    @Test
    fun `calculateRmssd with constant intervals returns zero`() {
        // All intervals are the same, so all differences are 0
        val intervals = listOf(800, 800, 800, 800, 800)
        val result = calculateRmssd(intervals)
        assertNotNull(result)
        assertEquals(0.0, result!!, 0.001)
    }

    @Test
    fun `calculateRmssd with two intervals returns absolute difference`() {
        // With just two intervals, RMSSD = |diff|
        val intervals = listOf(800, 850)
        val result = calculateRmssd(intervals)
        assertNotNull(result)
        assertEquals(50.0, result!!, 0.001)
    }

    // --- calculateHrv tests ---

    @Test
    fun `calculateHrv returns null rmssd for empty input`() {
        val result = calculateHrv(emptyList())
        assertNull(result.rmssd)
        assertEquals(0, result.validIntervals)
        assertEquals(0, result.artifactCount)
        assertFalse(result.isReliable)
    }

    @Test
    fun `calculateHrv returns unreliable for insufficient intervals`() {
        // Only 5 intervals, minimum required is 30
        val intervals = listOf(800, 810, 820, 830, 840)
        val result = calculateHrv(intervals, minValidIntervals = 30)
        assertNotNull(result.rmssd)
        assertEquals(5, result.validIntervals)
        assertEquals(0, result.artifactCount)
        assertFalse(result.isReliable)
    }

    @Test
    fun `calculateHrv returns reliable for sufficient valid intervals`() {
        // Create 50 normal intervals with small variation
        val intervals = (0 until 50).map { 800 + (it % 5) * 10 }
        val result = calculateHrv(intervals, minValidIntervals = 30)
        assertNotNull(result.rmssd)
        assertEquals(50, result.validIntervals)
        assertEquals(0, result.artifactCount)
        assertEquals(0.0, result.artifactPercentage, 0.001)
        assertTrue(result.isReliable)
    }

    @Test
    fun `calculateHrv marks unreliable when artifact percentage too high`() {
        // Mix of valid and artifact intervals
        val validIntervals = (0 until 40).map { 800 + (it % 3) * 10 }
        val artifacts = listOf(100, 100, 100, 100, 100, 3000, 3000, 3000, 3000, 3000)
        val intervals = validIntervals + artifacts

        val result = calculateHrv(intervals, minValidIntervals = 30, maxArtifactPercent = 10.0)

        assertEquals(40, result.validIntervals)
        assertEquals(10, result.artifactCount)
        assertEquals(20.0, result.artifactPercentage, 0.1)
        assertFalse(result.isReliable)  // 20% artifacts > 10% max
    }

    @Test
    fun `calculateHrv marks reliable when artifact percentage acceptable`() {
        // 45 valid + 5 artifacts = 10% artifact rate
        val validIntervals = (0 until 45).map { 800 + (it % 3) * 10 }
        val artifacts = listOf(100, 100, 3000, 3000, 3000)
        val intervals = validIntervals + artifacts

        val result = calculateHrv(intervals, minValidIntervals = 30, maxArtifactPercent = 10.0)

        assertEquals(45, result.validIntervals)
        assertEquals(5, result.artifactCount)
        assertEquals(10.0, result.artifactPercentage, 0.1)
        assertTrue(result.isReliable)  // 10% artifacts == 10% max, still acceptable
    }

    @Test
    fun `calculateHrv handles all intervals being filtered`() {
        // All intervals are artifacts
        val intervals = listOf(100, 100, 3000, 3000)
        val result = calculateHrv(intervals)
        assertNull(result.rmssd)
        assertEquals(0, result.validIntervals)
        assertEquals(4, result.artifactCount)
        assertEquals(100.0, result.artifactPercentage, 0.001)
        assertFalse(result.isReliable)
    }

    @Test
    fun `calculateHrv produces realistic RMSSD values for resting heart rate`() {
        // Simulating resting HR of ~60bpm with typical HRV variation
        // RR intervals around 1000ms with 20-40ms variation
        val intervals = mutableListOf<Int>()
        var rr = 1000
        repeat(60) {
            rr += (-20..20).random()
            rr = rr.coerceIn(900, 1100)
            intervals.add(rr)
        }

        val result = calculateHrv(intervals)

        // RMSSD at rest is typically 20-100ms for healthy adults
        assertNotNull(result.rmssd)
        assertTrue("RMSSD ${result.rmssd} should be in realistic range 5-150ms",
            result.rmssd!! in 5.0..150.0)
        assertTrue(result.isReliable)
    }

    @Test
    fun `calculateHrv handles successive difference filtering in artifact count`() {
        // Intervals where some pass bounds but fail successive diff check
        val intervals = listOf(
            800, 810, 820,  // Normal
            1200,          // >20% jump from 820 (threshold 164ms, diff 380ms)
            830, 840, 850  // These might be filtered too due to diff from 1200
        )

        val result = calculateHrv(intervals)

        // 1200 should be filtered due to successive diff
        // After 1200 is skipped, 830 vs 820 is ~1.2% change, OK
        assertTrue(result.validIntervals >= 5)
        assertTrue(result.artifactCount >= 1)
    }
}
