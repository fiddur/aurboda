package net.aurboda

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReminderPollTest {

    private val now = Instant.parse("2026-11-18T19:00:00Z")

    @Test
    fun `polls a minute after the next reminder`() {
        assertEquals(30 * 60L + 60L, reminderPollDelaySeconds("2026-11-18T19:30:00.000Z", now))
    }

    @Test
    fun `a reminder due now or just past polls within the minute, never with a negative delay`() {
        assertEquals(60L, reminderPollDelaySeconds("2026-11-18T19:00:00Z", now))
        assertEquals(0L, reminderPollDelaySeconds("2026-11-18T18:50:00Z", now))
    }

    @Test
    fun `no next reminder or an unreadable time schedules nothing`() {
        assertNull(reminderPollDelaySeconds(null, now))
        assertNull(reminderPollDelaySeconds("tonight", now))
    }
}
