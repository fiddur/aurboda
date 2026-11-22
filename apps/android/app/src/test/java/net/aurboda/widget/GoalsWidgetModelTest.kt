package net.aurboda.widget

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GoalsWidgetModelTest {
    @Test
    fun `a max goal at zero is kept with no minimum or a minimum of zero`() {
        assertTrue(isGoalKeptAtZero(min = null, max = 2.0, current = 0.0))
        assertTrue(isGoalKeptAtZero(min = 0.0, max = 2.0, current = 0.0))
    }

    @Test
    fun `a value above zero or a minimum above zero or no maximum is not`() {
        assertFalse(isGoalKeptAtZero(min = null, max = 2.0, current = 1.0))
        assertFalse(isGoalKeptAtZero(min = 1.0, max = 2.0, current = 0.0))
        assertFalse(isGoalKeptAtZero(min = 1.0, max = null, current = 0.0))
    }
}
