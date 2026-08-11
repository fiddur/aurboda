package net.aurboda

import android.content.ComponentName
import android.view.WindowManager
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private val KEYBOARD_HEIGHT = 200.dp

/**
 * The soft keyboard must never cover a focused input, native or in an embedded
 * web page. Two independent mechanisms deliver that, one per API range, and
 * neither is visible in the screens themselves — hence these tests.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class KeyboardInsetsTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    /** API ≤ 34: the window still resizes itself, if the manifest asks it to. */
    // SOFT_INPUT_ADJUST_RESIZE is deprecated precisely because API 35+ ignores
    // it; it is still the mechanism on the API levels this app also supports.
    @Suppress("DEPRECATION")
    @Test
    fun `main activity asks the window to resize for the keyboard`() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        val activityInfo = context.packageManager.getActivityInfo(
            ComponentName(context, MainActivity::class.java),
            0,
        )

        assertEquals(
            WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE,
            activityInfo.softInputMode and WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST,
        )
    }

    /** API 35+: edge-to-edge is enforced, so the shell consumes the IME inset. */
    @Test
    fun `app shell shrinks its content by the keyboard height`() {
        composeTestRule.setContent {
            AurbodaAppShell(keyboardInsets = WindowInsets(bottom = KEYBOARD_HEIGHT)) {
                Box(modifier = Modifier.fillMaxSize().testTag("content"))
            }
        }

        val windowHeight = composeTestRule.onRoot().fetchSemanticsNode().size.height
        val contentHeight = composeTestRule.onNodeWithTag("content").fetchSemanticsNode().size.height

        assertEquals(
            windowHeight - with(composeTestRule.density) { KEYBOARD_HEIGHT.roundToPx() },
            contentHeight,
        )
    }
}
