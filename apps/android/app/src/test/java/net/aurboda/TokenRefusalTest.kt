package net.aurboda

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TokenRefusalTest {
  private fun client(status: HttpStatusCode, refused: MutableList<String>): HttpClient =
    HttpClient(MockEngine { respond(content = "{}", status = status) }) {
      install(tokenRefusalPlugin { refused += it })
    }

  @Test
  fun `a 401 to a bearer request reports the refused token`() =
    runTest {
      val refused = mutableListOf<String>()
      client(HttpStatusCode.Unauthorized, refused).get("https://aurboda.net/api/sync/outbound") {
        headers { append(HttpHeaders.Authorization, "Bearer tok-1") }
      }
      assertEquals(listOf("tok-1"), refused)
    }

  @Test
  fun `a 401 to a request without a bearer token reports nothing`() =
    runTest {
      val refused = mutableListOf<String>()
      client(HttpStatusCode.Unauthorized, refused).get("https://aurboda.net/api/login")
      assertTrue(refused.isEmpty())
    }

  @Test
  fun `other answers report nothing`() =
    runTest {
      for (status in listOf(HttpStatusCode.OK, HttpStatusCode.PaymentRequired, HttpStatusCode.Forbidden, HttpStatusCode.InternalServerError)) {
        val refused = mutableListOf<String>()
        client(status, refused).get("https://aurboda.net/api/user/settings") {
          headers { append(HttpHeaders.Authorization, "Bearer tok-1") }
        }
        assertTrue("$status", refused.isEmpty())
      }
    }

  @Test
  fun `bearerToken takes the token out of a Bearer header only`() {
    assertEquals("abc", bearerToken("Bearer abc"))
    assertNull(bearerToken("Bearer "))
    assertNull(bearerToken("Basic abc"))
    assertNull(bearerToken(null))
  }

  @Test
  fun `only the stored token being refused counts`() {
    assertTrue(isStoredTokenRefused("tok-1", "tok-1"))
    assertFalse(isStoredTokenRefused("tok-2", "tok-1"))
    assertFalse(isStoredTokenRefused(null, "tok-1"))
  }
}
