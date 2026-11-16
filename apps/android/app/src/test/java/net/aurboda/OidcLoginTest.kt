package net.aurboda

import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class OidcLoginTest {
    @Test
    fun `a callback with a code is a Code`() {
        assertEquals(
            OidcCallback.Code("abc-123_x"),
            parseOidcCallback(Uri.parse("net.aurboda.oidc://callback?code=abc-123_x")),
        )
    }

    @Test
    fun `a callback with an error is a Failure`() {
        assertEquals(
            OidcCallback.Failure("not_linked"),
            parseOidcCallback(Uri.parse("net.aurboda.oidc://callback?error=not_linked")),
        )
    }

    @Test
    fun `a callback with neither parameter is null`() {
        assertNull(parseOidcCallback(Uri.parse("net.aurboda.oidc://callback")))
        assertNull(parseOidcCallback(Uri.parse("net.aurboda.oidc://callback?code=")))
        assertTrue(isOidcCallbackUri(Uri.parse("net.aurboda.oidc://callback")))
    }

    @Test
    fun `another scheme or host is not a callback`() {
        for (uri in listOf(
            "https://callback?code=abc",
            "https://aurboda.net/login/oidc?code=abc",
            "net.aurboda.oidc://other?code=abc",
            "net.aurboda.other://callback?code=abc",
            "mailto:someone@example.com",
        )) {
            assertNull(uri, parseOidcCallback(Uri.parse(uri)))
            assertFalse(uri, isOidcCallbackUri(Uri.parse(uri)))
        }
    }

    @Test
    fun `every error code has the web login page's sentence, and not_linked the app's`() {
        assertEquals(
            "That sign-in is already linked to another account here.",
            oidcErrorMessage("already_linked"),
        )
        assertEquals(
            "That account is not allowed here: its email is not verified, or not in a domain this server accepts.",
            oidcErrorMessage("domain_not_allowed"),
        )
        assertEquals(
            "The sign-in took too long or was already used. Please try again.",
            oidcErrorMessage("expired"),
        )
        assertEquals("The sign-in did not succeed. Please try again.", oidcErrorMessage("failed"))
        assertEquals(
            "No Aurboda account is linked to this sign-in. Sign in another way and link it under Settings " +
                "on the web, or create the account on the web.",
            oidcErrorMessage("not_linked"),
        )
        assertEquals(
            "No account is linked to that sign-in, and new accounts cannot be created here right now.",
            oidcErrorMessage("signup_closed"),
        )
    }

    @Test
    fun `an unknown error code falls back to the failed sentence`() {
        assertEquals("The sign-in did not succeed. Please try again.", oidcErrorMessage("something_new"))
    }

    @Test
    fun `the pending login is taken once`() {
        val holder = PendingOidcLoginHolder(now = { 1_000L })
        assertNull(holder.take())
        holder.start("https://aurboda.example", "verifier")
        assertEquals(PendingOidcLogin("https://aurboda.example", "verifier", 1_000L), holder.take())
        assertNull(holder.take())
    }

    @Test
    fun `the pending login expires after ten minutes`() {
        var clock = 0L
        val holder = PendingOidcLoginHolder(now = { clock })

        holder.start("https://aurboda.example", "verifier")
        clock = OIDC_PENDING_TTL_MS
        assertEquals("verifier", holder.take()?.verifier)

        holder.start("https://aurboda.example", "verifier")
        clock += OIDC_PENDING_TTL_MS + 1
        assertNull(holder.take())
    }

    @Test
    fun `a newer start replaces the pending login`() {
        val holder = PendingOidcLoginHolder(now = { 0L })
        holder.start("https://one.example", "first")
        holder.start("https://two.example", "second")
        assertEquals(PendingOidcLogin("https://two.example", "second", 0L), holder.take())
    }
}
