package net.aurboda.ui.screens

import android.Manifest
import android.webkit.PermissionRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WebCaptureResourcesTest {

    @Test
    fun `video capture needs the camera and audio capture the microphone`() {
        assertEquals(
            mapOf(
                PermissionRequest.RESOURCE_VIDEO_CAPTURE to Manifest.permission.CAMERA,
                PermissionRequest.RESOURCE_AUDIO_CAPTURE to Manifest.permission.RECORD_AUDIO,
            ),
            captureResources(
                arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE, PermissionRequest.RESOURCE_AUDIO_CAPTURE),
            ),
        )
    }

    @Test
    fun `other resources are never granted`() {
        assertTrue(
            captureResources(
                arrayOf(PermissionRequest.RESOURCE_MIDI_SYSEX, PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID),
            ).isEmpty(),
        )
    }

    @Test
    fun `a microphone-only request asks for the microphone only`() {
        assertEquals(
            mapOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE to Manifest.permission.RECORD_AUDIO),
            captureResources(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)),
        )
    }
}
