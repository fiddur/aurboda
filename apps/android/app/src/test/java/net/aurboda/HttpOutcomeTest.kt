package net.aurboda

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HttpOutcomeTest {
  @Test
  fun `classifyHttpStatus separates refused token, read-only, retryable and failed`() {
    assertEquals(HttpOutcome.Ok, classifyHttpStatus(200))
    assertEquals(HttpOutcome.Ok, classifyHttpStatus(201))
    assertEquals(HttpOutcome.Ok, classifyHttpStatus(204))
    assertEquals(HttpOutcome.Unauthorized, classifyHttpStatus(401))
    assertEquals(HttpOutcome.ReadOnly, classifyHttpStatus(402))
    assertEquals(HttpOutcome.Retryable, classifyHttpStatus(408))
    assertEquals(HttpOutcome.Retryable, classifyHttpStatus(429))
    assertEquals(HttpOutcome.Retryable, classifyHttpStatus(500))
    assertEquals(HttpOutcome.Retryable, classifyHttpStatus(503))
    assertEquals(HttpOutcome.Failed, classifyHttpStatus(400))
    assertEquals(HttpOutcome.Failed, classifyHttpStatus(403))
    assertEquals(HttpOutcome.Failed, classifyHttpStatus(404))
    assertEquals(HttpOutcome.Failed, classifyHttpStatus(413))
  }

  @Test
  fun `syncStopOf stops on 401 with the login message`() {
    assertEquals(SyncStop(HttpOutcome.Unauthorized, SESSION_REFUSED_MESSAGE), syncStopOf(401, "HTTP 401 Unauthorized"))
  }

  @Test
  fun `syncStopOf stops on 402 with the server's message, or the fallback`() {
    assertEquals(SyncStop(HttpOutcome.ReadOnly, "Renew to write"), syncStopOf(402, "Renew to write"))
    assertEquals(SyncStop(HttpOutcome.ReadOnly, READ_ONLY_FALLBACK_MESSAGE), syncStopOf(402))
  }

  @Test
  fun `syncStopOf does not stop on other answers`() {
    assertNull(syncStopOf(null))
    assertNull(syncStopOf(200))
    assertNull(syncStopOf(400))
    assertNull(syncStopOf(413))
    assertNull(syncStopOf(429))
    assertNull(syncStopOf(500))
  }

  @Test
  fun `readOnlyMessage reads the error of a 402 body`() {
    val body = """{"success":false,"error":"This account is read-only until the plan is renewed","payment_url":null}"""
    assertEquals("This account is read-only until the plan is renewed", readOnlyMessage(body))
  }

  @Test
  fun `readOnlyMessage falls back when the body has no usable error`() {
    assertEquals(READ_ONLY_FALLBACK_MESSAGE, readOnlyMessage(null))
    assertEquals(READ_ONLY_FALLBACK_MESSAGE, readOnlyMessage(""))
    assertEquals(READ_ONLY_FALLBACK_MESSAGE, readOnlyMessage("Payment Required"))
    assertEquals(READ_ONLY_FALLBACK_MESSAGE, readOnlyMessage("""{"success":false}"""))
    assertEquals(READ_ONLY_FALLBACK_MESSAGE, readOnlyMessage("""{"error":null}"""))
    assertEquals(READ_ONLY_FALLBACK_MESSAGE, readOnlyMessage("""{"error":"  "}"""))
    assertEquals(READ_ONLY_FALLBACK_MESSAGE, readOnlyMessage("""{"error":{"code":1}}"""))
    assertEquals(READ_ONLY_FALLBACK_MESSAGE, readOnlyMessage("""["error"]"""))
  }

  @Test
  fun `PostResult outcome and isTransient follow the classification`() {
    assertEquals(HttpOutcome.Ok, PostResult.Success.outcome)
    assertEquals(HttpOutcome.Retryable, PostResult.NetworkError("down").outcome)
    assertTrue(PostResult.NetworkError("down").isTransient)
    assertTrue(PostResult.HttpError(503, "Service Unavailable").isTransient)
    assertFalse(PostResult.HttpError(401, "Unauthorized").isTransient)
    assertFalse(PostResult.HttpError(402, "Payment Required").isTransient)
  }

  @Test
  fun `PostResult errorMessage prefers the server's read-only message`() {
    val readOnly = PostResult.HttpError(402, "Payment Required", serverMessage = "Renew to write")
    assertEquals("Renew to write", readOnly.errorMessage())
    assertEquals("HTTP 402 Payment Required", PostResult.HttpError(402, "Payment Required").errorMessage())
  }

  @Test
  fun `PostResult syncStop is set only for a refused token or a read-only account`() {
    assertEquals(SyncStop(HttpOutcome.Unauthorized, SESSION_REFUSED_MESSAGE), PostResult.HttpError(401, "Unauthorized").syncStop())
    assertEquals(
      SyncStop(HttpOutcome.ReadOnly, "Renew to write"),
      PostResult.HttpError(402, "Payment Required", serverMessage = "Renew to write").syncStop(),
    )
    assertNull(PostResult.HttpError(500, "Internal Server Error").syncStop())
    assertNull(PostResult.HttpError(400, "Bad Request").syncStop())
    assertNull(PostResult.NetworkError("down").syncStop())
    assertNull(PostResult.Success.syncStop())
  }

  private suspend fun errorFor(status: HttpStatusCode, body: String): PostResult.HttpError =
    httpErrorOf(HttpClient(MockEngine { respond(content = body, status = status) }).get("https://aurboda.net/api/metrics"))

  @Test
  fun `httpErrorOf reads the server's message out of a 402`() =
    runTest {
      val error = errorFor(HttpStatusCode.PaymentRequired, """{"success":false,"error":"Renew to write","payment_url":null}""")
      assertEquals(402, error.statusCode)
      assertEquals("Renew to write", error.serverMessage)
      assertEquals(SyncStop(HttpOutcome.ReadOnly, "Renew to write"), error.syncStop())
    }

  @Test
  fun `httpErrorOf keeps the plain status for other errors`() =
    runTest {
      val error = errorFor(HttpStatusCode.BadRequest, """{"success":false,"error":"bad"}""")
      assertNull(error.serverMessage)
      assertEquals("HTTP 400 Bad Request", error.errorMessage())
    }
}
