package net.aurboda.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ChallengeChartTest {
    private val start = parseInstantMillis("2026-07-31T22:00:00Z")
    private val end = parseInstantMillis("2026-08-31T22:00:00Z")

    @Test
    fun `draws a bitmap of the requested size, capped to the RemoteViews-safe maximum`() {
        val bmp = drawRaceChart(300, 120, 2f, emptyList(), start, end)
        assertEquals(300, bmp.width)
        assertEquals(120, bmp.height)

        val huge = drawRaceChart(5000, 3000, 3f, emptyList(), start, end)
        assertEquals(800, huge.width)
        assertEquals(800, huge.height)
    }

    @Test
    fun `paints a member's line in its colour`() {
        val color = 0xFF10B981.toInt()
        val series =
            RaceSeries(
                color,
                listOf(RacePoint(start, 0.0), RacePoint(start + DAY_MILLIS * 10, 50_000.0), RacePoint(start + DAY_MILLIS * 17, 120_055.0)),
            )
        val bmp = drawRaceChart(310, 100, 1f, listOf(series), start, end)
        // Somewhere along the line a pixel is (close to) the series colour; the far right, past
        // the last point, is untouched apart from the baseline.
        var found = false
        for (x in 0 until bmp.width) for (y in 0 until bmp.height) {
            if (bmp.getPixel(x, y) == color) found = true
        }
        assertEquals(true, found)
        assertNotEquals(color, bmp.getPixel(bmp.width - 3, 10))
    }
}
