package net.aurboda

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class PendingActivitySendTest {
  private val payload = PendingActivityPayload(
    activity_type = "walk",
    start_time = "2026-11-01T08:00:00Z",
    people = listOf("p1"),
  )

  private val created = DataResult.Success(
    AddActivityResponse(
      success = true,
      data = AddedActivity(id = "a1", activityType = "walk", startTime = "2026-11-01T08:00:00Z"),
    ),
  )

  private class Calls {
    val activities = mutableListOf<AddActivityBody>()
    val comments = mutableListOf<Pair<String, String>>()
    val saved = mutableListOf<String>()
  }

  private suspend fun send(
    payload: PendingActivityPayload,
    calls: Calls,
    activityResult: DataResult<AddActivityResponse> = created,
    commentResult: DataResult<Unit> = DataResult.Success(Unit),
  ): PendingActivityOutcome =
    sendPendingActivity(
      payload = payload,
      types = emptyList(),
      sendActivity = { body ->
        calls.activities += body
        activityResult
      },
      sendComment = { activityId, content ->
        calls.comments += activityId to content
        commentResult
      },
      saveActivityId = { calls.saved += it },
    )

  @Test
  fun `an activity without a comment is posted once with its people`() = runTest {
    val calls = Calls()
    assertEquals(PendingActivityOutcome.Sent, send(payload, calls))
    assertEquals(listOf(listOf("p1")), calls.activities.map { it.people })
    assertEquals(emptyList<Pair<String, String>>(), calls.comments)
    assertEquals(emptyList<String>(), calls.saved)
  }

  @Test
  fun `an activity with a comment posts the comment on the created activity`() = runTest {
    val calls = Calls()
    assertEquals(PendingActivityOutcome.Sent, send(payload.copy(comment = " Nice walk "), calls))
    assertEquals(1, calls.activities.size)
    assertEquals(listOf("a1" to "Nice walk"), calls.comments)
    assertEquals(listOf("a1"), calls.saved)
  }

  @Test
  fun `a failed comment is retried alone, never with a second activity`() = runTest {
    val calls = Calls()
    val failure = DataResult.Error("Server returned 500", 500)
    val first = send(payload.copy(comment = "Nice walk"), calls, commentResult = failure)
    assertEquals(PendingActivityOutcome.CommentFailed(failure), first)
    assertEquals(listOf("a1"), calls.saved)

    val retried = payload.copy(comment = "Nice walk", created_activity_id = calls.saved.single())
    assertEquals(PendingActivityOutcome.Sent, send(retried, calls))
    assertEquals(1, calls.activities.size)
    assertEquals(listOf("a1" to "Nice walk", "a1" to "Nice walk"), calls.comments)
    assertEquals(listOf("a1"), calls.saved)
  }

  @Test
  fun `a failed activity posts no comment`() = runTest {
    val calls = Calls()
    val failure = DataResult.Error("Server returned 400", 400)
    val outcome = send(payload.copy(comment = "Nice walk"), calls, activityResult = failure)
    assertEquals(PendingActivityOutcome.ActivityFailed(failure), outcome)
    assertEquals(emptyList<Pair<String, String>>(), calls.comments)
    assertEquals(emptyList<String>(), calls.saved)
  }

  @Test
  fun `a stored entry gets the created activity's id`() {
    val entry = PendingEntry(id = "e1", data = PendingPayload.Activity(payload), created_at = "2026-11-01T08:00:00Z")
    val updated = entry.withCreatedActivityId("a1")
    assertEquals("a1", (updated.data as PendingPayload.Activity).payload.created_activity_id)
  }
}
