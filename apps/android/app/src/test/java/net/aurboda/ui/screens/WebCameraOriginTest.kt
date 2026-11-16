package net.aurboda.ui.screens

import android.net.Uri
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class WebCameraOriginTest {

    @Test
    fun `the server's own origin matches`() {
        assertTrue(isSameOrigin(Uri.parse("https://aurboda.net/"), "https://aurboda.net"))
        assertTrue(isSameOrigin(Uri.parse("https://aurboda.net"), "https://aurboda.net/food-items?embed=1"))
    }

    @Test
    fun `scheme and host ignore case`() {
        assertTrue(isSameOrigin(Uri.parse("HTTPS://Aurboda.NET/"), "https://aurboda.net"))
    }

    @Test
    fun `a default port matches no port`() {
        assertTrue(isSameOrigin(Uri.parse("https://aurboda.net:443/"), "https://aurboda.net"))
        assertTrue(isSameOrigin(Uri.parse("http://192.168.1.5/"), "http://192.168.1.5:80"))
    }

    @Test
    fun `an explicit port must match`() {
        assertTrue(isSameOrigin(Uri.parse("http://192.168.1.5:3000/"), "http://192.168.1.5:3000"))
        assertFalse(isSameOrigin(Uri.parse("http://192.168.1.5:8080/"), "http://192.168.1.5:3000"))
    }

    @Test
    fun `another host or a subdomain does not match`() {
        assertFalse(isSameOrigin(Uri.parse("https://evil.example/"), "https://aurboda.net"))
        assertFalse(isSameOrigin(Uri.parse("https://blog.aurboda.net/"), "https://aurboda.net"))
    }

    @Test
    fun `another scheme does not match`() {
        assertFalse(isSameOrigin(Uri.parse("http://aurboda.net/"), "https://aurboda.net"))
    }

    @Test
    fun `an unparseable base or an origin without a host does not match`() {
        assertFalse(isSameOrigin(Uri.parse("https://aurboda.net/"), "not a url"))
        assertFalse(isSameOrigin(Uri.parse("about:blank"), "https://aurboda.net"))
    }
}
