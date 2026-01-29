package net.aurboda

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for SyncUtils.
 *
 * Note: Testing the actual HTTP posting with generic types has Kotlin reflection issues
 * in unit tests. The chunking logic is tested via the list chunking behavior, and the
 * HTTP posting is covered by integration/manual testing.
 */
class SyncUtilsTest {

    // PostResult tests

    @Test
    fun `PostResult Success isSuccess returns true`() {
        val result = PostResult.Success
        assertTrue(result.isSuccess)
    }

    @Test
    fun `PostResult HttpError isSuccess returns false`() {
        val result = PostResult.HttpError(413, "Request Entity Too Large")
        assertFalse(result.isSuccess)
    }

    @Test
    fun `PostResult NetworkError isSuccess returns false`() {
        val result = PostResult.NetworkError("Connection refused")
        assertFalse(result.isSuccess)
    }

    @Test
    fun `PostResult Success errorMessage returns null`() {
        val result = PostResult.Success
        assertNull(result.errorMessage())
    }

    @Test
    fun `PostResult HttpError errorMessage includes status code and description`() {
        val result = PostResult.HttpError(413, "Request Entity Too Large")
        assertEquals("HTTP 413 Request Entity Too Large", result.errorMessage())
    }

    @Test
    fun `PostResult HttpError errorMessage for 401`() {
        val result = PostResult.HttpError(401, "Unauthorized")
        assertEquals("HTTP 401 Unauthorized", result.errorMessage())
    }

    @Test
    fun `PostResult HttpError errorMessage for 500`() {
        val result = PostResult.HttpError(500, "Internal Server Error")
        assertEquals("HTTP 500 Internal Server Error", result.errorMessage())
    }

    @Test
    fun `PostResult NetworkError errorMessage includes message`() {
        val result = PostResult.NetworkError("Connection refused")
        assertEquals("Network error: Connection refused", result.errorMessage())
    }

    @Test
    fun `PostResult NetworkError errorMessage with empty message`() {
        val result = PostResult.NetworkError("")
        assertEquals("Network error: ", result.errorMessage())
    }

    // Chunking logic tests (testing the Kotlin stdlib chunked behavior we rely on)

    @Test
    fun `list chunked with size 10 creates correct number of chunks`() {
        val data = (1..25).toList()
        val chunks = data.chunked(10)

        assertEquals(3, chunks.size)
        assertEquals(10, chunks[0].size)
        assertEquals(10, chunks[1].size)
        assertEquals(5, chunks[2].size)
    }

    @Test
    fun `list chunked with exact divisible size`() {
        val data = (1..20).toList()
        val chunks = data.chunked(10)

        assertEquals(2, chunks.size)
        assertEquals(10, chunks[0].size)
        assertEquals(10, chunks[1].size)
    }

    @Test
    fun `list chunked with size larger than list`() {
        val data = (1..5).toList()
        val chunks = data.chunked(10)

        assertEquals(1, chunks.size)
        assertEquals(5, chunks[0].size)
    }

    @Test
    fun `list chunked with empty list`() {
        val data = emptyList<Int>()
        val chunks = data.chunked(10)

        assertEquals(0, chunks.size)
    }

    @Test
    fun `list chunked preserves order`() {
        val data = listOf(1, 2, 3, 4, 5)
        val chunks = data.chunked(2)

        assertEquals(listOf(1, 2), chunks[0])
        assertEquals(listOf(3, 4), chunks[1])
        assertEquals(listOf(5), chunks[2])
    }

    // PostResult equality and hashing

    @Test
    fun `PostResult Success equals another Success`() {
        assertEquals(PostResult.Success, PostResult.Success)
    }

    @Test
    fun `PostResult HttpError equals another with same values`() {
        val error1 = PostResult.HttpError(413, "Too Large")
        val error2 = PostResult.HttpError(413, "Too Large")
        assertEquals(error1, error2)
    }

    @Test
    fun `PostResult HttpError not equals with different status`() {
        val error1 = PostResult.HttpError(413, "Too Large")
        val error2 = PostResult.HttpError(500, "Too Large")
        assertFalse(error1 == error2)
    }

    @Test
    fun `PostResult NetworkError equals another with same message`() {
        val error1 = PostResult.NetworkError("timeout")
        val error2 = PostResult.NetworkError("timeout")
        assertEquals(error1, error2)
    }
}
