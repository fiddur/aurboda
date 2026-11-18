package net.aurboda

import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException

/** How long after a reminder's time the extra poll runs, so the server's five-minute tick has raised it. */
const val REMINDER_POLL_GRACE_SECONDS = 60L

/**
 * Seconds from [now] until one extra notification poll just after [nextDueAt] (`next_due_at` from
 * `GET /reminders`), never negative; null when there is no next reminder or the time cannot be read.
 */
fun reminderPollDelaySeconds(nextDueAt: String?, now: Instant): Long? {
    if (nextDueAt == null) return null
    val due = try {
        Instant.parse(nextDueAt)
    } catch (e: DateTimeParseException) {
        return null
    }
    return maxOf(0L, Duration.between(now, due).seconds + REMINDER_POLL_GRACE_SECONDS)
}
