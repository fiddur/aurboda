package net.aurboda.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WebLeaveGuardTest {

    @Test
    fun `no result is no guard`() {
        assertNull(parseLeaveGuardResult(null))
        assertNull(parseLeaveGuardResult(""))
        assertNull(parseLeaveGuardResult("null"))
    }

    @Test
    fun `string literal is the message`() {
        assertEquals("Leave?", parseLeaveGuardResult("\"Leave?\""))
    }

    @Test
    fun `escaped quotes and unicode are decoded`() {
        assertEquals(
            "Leave \"Squat\" — set 3?",
            parseLeaveGuardResult("\"Leave \\\"Squat\\\" \\u2014 set 3?\""),
        )
    }

    @Test
    fun `non-string values are no guard`() {
        assertNull(parseLeaveGuardResult("42"))
        assertNull(parseLeaveGuardResult("true"))
        assertNull(parseLeaveGuardResult("{\"a\":1}"))
    }

    @Test
    fun `empty string literal is no guard`() {
        assertNull(parseLeaveGuardResult("\"\""))
    }

    @Test
    fun `malformed json is no guard`() {
        assertNull(parseLeaveGuardResult("\"unterminated"))
    }

    @Test
    fun `check answers null without a registered page`() {
        var answered = false
        var answer: String? = "unset"
        WebLeaveGuard().check {
            answered = true
            answer = it
        }
        assertTrue(answered)
        assertNull(answer)
    }

    @Test
    fun `check asks the registered page`() {
        val guard = WebLeaveGuard()
        guard.ask = { onAnswer -> onAnswer("Leave?") }
        var answer: String? = null
        guard.check { answer = it }
        assertEquals("Leave?", answer)
    }

    @Test
    fun `confirmThen proceeds at once when the page has no guard`() {
        val guard = WebLeaveGuard()
        guard.ask = { onAnswer -> onAnswer(null) }
        guard.confirm = { _, _ -> throw AssertionError("should not confirm") }
        var proceeded = false
        guard.confirmThen { proceeded = true }
        assertTrue(proceeded)
    }

    @Test
    fun `confirmThen asks for confirmation when the page has a guard`() {
        val guard = WebLeaveGuard()
        guard.ask = { onAnswer -> onAnswer("Leave?") }
        var shown: String? = null
        var pending: (() -> Unit)? = null
        guard.confirm = { message, proceed ->
            shown = message
            pending = proceed
        }
        var proceeded = false
        guard.confirmThen { proceeded = true }
        assertEquals("Leave?", shown)
        assertFalse(proceeded)
        pending?.invoke()
        assertTrue(proceeded)
    }
}
