package net.aurboda.ui.screens

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebLinkTest {

    @Test
    fun `same host is internal`() {
        assertFalse(isExternalLink("https://aurboda.net", "https://aurboda.net/timeline"))
    }

    @Test
    fun `different host is external`() {
        assertTrue(isExternalLink("https://aurboda.net", "https://www.strava.com/activities/1"))
    }

    @Test
    fun `subdomain is external`() {
        assertTrue(isExternalLink("https://aurboda.net", "https://blog.aurboda.net/post"))
    }

    @Test
    fun `non-http scheme is external`() {
        assertTrue(isExternalLink("https://aurboda.net", "mailto:hi@aurboda.net"))
        assertTrue(isExternalLink("https://aurboda.net", "tel:+123456789"))
    }

    @Test
    fun `relative path stays internal`() {
        assertFalse(isExternalLink("https://aurboda.net", "/timeline"))
    }

    @Test
    fun `host comparison ignores case`() {
        assertFalse(isExternalLink("https://Aurboda.net", "https://aurboda.NET/feed"))
    }

    @Test
    fun `same host different port stays internal`() {
        assertFalse(isExternalLink("http://192.168.1.5:3000", "http://192.168.1.5:8080/feed"))
    }
}
