package net.aurboda.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivityTypeMatchTest {

    private data class Type(val name: String, val displayName: String)

    private val types = listOf(
        Type("running", "Running"),
        Type("trail_running", "Trail Running"),
        Type("yoga", "Yoga"),
        Type("journaling", "Morning pages"),
    )

    private fun match(query: String) = matchActivityTypes(types, query, { it.name }, { it.displayName })

    @Test
    fun `trailing space still finds the type`() {
        val result = match("Yoga ")
        assertEquals(listOf("yoga"), result.filtered.map { it.name })
        assertFalse(result.isNewType)
    }

    @Test
    fun `leading space still finds the type`() {
        val result = match(" running")
        assertEquals(listOf("running", "trail_running"), result.filtered.map { it.name })
        assertFalse(result.isNewType)
    }

    @Test
    fun `exact display name match comes first and is not offered as new`() {
        val result = match("morning pages ")
        assertEquals(listOf("journaling"), result.filtered.map { it.name })
        assertFalse(result.isNewType)
    }

    @Test
    fun `new name offers create with the trimmed snake case name`() {
        val result = match(" Rock climbing ")
        assertTrue(result.filtered.isEmpty())
        assertTrue(result.isNewType)
        assertEquals("rock_climbing", result.snakeInput)
    }

    @Test
    fun `blank query lists everything and offers nothing new`() {
        val result = match("   ")
        assertEquals(types, result.filtered)
        assertFalse(result.isNewType)
    }
}
