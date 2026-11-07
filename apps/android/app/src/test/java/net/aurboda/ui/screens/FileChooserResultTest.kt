package net.aurboda.ui.screens

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class FileChooserResultTest {
    private val first = Uri.parse("content://media/external/images/1")
    private val second = Uri.parse("content://media/external/images/2")

    @Test
    fun `cancelled picker yields null`() {
        assertNull(fileChooserResultUris(Activity.RESULT_CANCELED, Intent().setData(first)))
    }

    @Test
    fun `ok without an intent yields null`() {
        assertNull(fileChooserResultUris(Activity.RESULT_OK, null))
    }

    @Test
    fun `ok with nothing picked yields null`() {
        assertNull(fileChooserResultUris(Activity.RESULT_OK, Intent()))
    }

    @Test
    fun `single pick comes from data`() {
        assertArrayEquals(arrayOf(first), fileChooserResultUris(Activity.RESULT_OK, Intent().setData(first)))
    }

    @Test
    fun `multiple picks come from clipData`() {
        val clip = ClipData.newRawUri("", first).apply { addItem(ClipData.Item(second)) }
        val intent = Intent().apply { clipData = clip }
        assertArrayEquals(arrayOf(first, second), fileChooserResultUris(Activity.RESULT_OK, intent))
    }
}
