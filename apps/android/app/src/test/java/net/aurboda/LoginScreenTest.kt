package net.aurboda

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import net.aurboda.ui.screens.LoginScreen
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class LoginScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun `login screen displays all fields`() {
        composeTestRule.setContent {
            LoginScreen(
                onSaveCredentials = { _, _, _ -> },
                onLoginSuccess = {}
            )
        }

        composeTestRule.onNodeWithText("Aurboda").assertIsDisplayed()
        composeTestRule.onNodeWithText("Server URL").assertIsDisplayed()
        composeTestRule.onNodeWithText("Username").performScrollTo().assertIsDisplayed()
        composeTestRule.onNodeWithText("Password").performScrollTo().assertIsDisplayed()
        composeTestRule.onNodeWithText("Login").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `login screen shows default server URL`() {
        composeTestRule.setContent {
            LoginScreen(
                onSaveCredentials = { _, _, _ -> },
                onLoginSuccess = {}
            )
        }

        composeTestRule.onNodeWithText("https://aurboda.net").assertIsDisplayed()
    }

    @Test
    fun `login screen shows custom initial server URL`() {
        composeTestRule.setContent {
            LoginScreen(
                initialServerUrl = "https://custom.example.com",
                onSaveCredentials = { _, _, _ -> },
                onLoginSuccess = {}
            )
        }

        composeTestRule.onNodeWithText("https://custom.example.com").assertIsDisplayed()
    }

    @Test
    fun `login button is disabled when fields are empty`() {
        composeTestRule.setContent {
            LoginScreen(
                onSaveCredentials = { _, _, _ -> },
                onLoginSuccess = {}
            )
        }

        composeTestRule.onNodeWithText("Login").assertIsNotEnabled()
    }

    @Test
    fun `login button is disabled when only username is filled`() {
        composeTestRule.setContent {
            LoginScreen(
                onSaveCredentials = { _, _, _ -> },
                onLoginSuccess = {}
            )
        }

        composeTestRule.onNodeWithText("Username").performTextInput("testuser")
        composeTestRule.onNodeWithText("Login").assertIsNotEnabled()
    }

    @Test
    fun `login button is disabled when only password is filled`() {
        composeTestRule.setContent {
            LoginScreen(
                onSaveCredentials = { _, _, _ -> },
                onLoginSuccess = {}
            )
        }

        composeTestRule.onNodeWithText("Password").performTextInput("testpass")
        composeTestRule.onNodeWithText("Login").assertIsNotEnabled()
    }

    @Test
    fun `login button is enabled when all fields are filled`() {
        composeTestRule.setContent {
            LoginScreen(
                onSaveCredentials = { _, _, _ -> },
                onLoginSuccess = {}
            )
        }

        composeTestRule.onNodeWithText("Username").performTextInput("testuser")
        composeTestRule.onNodeWithText("Password").performTextInput("testpass")
        composeTestRule.onNodeWithText("Login").assertIsEnabled()
    }

    @Test
    fun `login button is disabled when server URL is cleared`() {
        composeTestRule.setContent {
            LoginScreen(
                onSaveCredentials = { _, _, _ -> },
                onLoginSuccess = {}
            )
        }

        composeTestRule.onNodeWithText("Username").performTextInput("testuser")
        composeTestRule.onNodeWithText("Password").performTextInput("testpass")
        composeTestRule.onNodeWithText("https://aurboda.net").performTextClearance()
        composeTestRule.onNodeWithText("Login").assertIsNotEnabled()
    }

    @Test
    fun `successful login calls onSaveCredentials and onLoginSuccess`() = runTest {
        val mockAuthApi = mockk<AuthApi>()
        var savedServerUrl: String? = null
        var savedUsername: String? = null
        var savedToken: String? = null
        var loginSuccessCalled = false

        coEvery { mockAuthApi.login(any(), any(), any()) } returns
            LoginResult.Success("test-token")

        composeTestRule.setContent {
            LoginScreen(
                authApi = mockAuthApi,
                onSaveCredentials = { serverUrl, username, token ->
                    savedServerUrl = serverUrl
                    savedUsername = username
                    savedToken = token
                },
                onLoginSuccess = { loginSuccessCalled = true }
            )
        }

        composeTestRule.onNodeWithText("Username").performScrollTo().performTextInput("testuser")
        composeTestRule.onNodeWithText("Password").performScrollTo().performTextInput("testpass")
        composeTestRule.onNodeWithText("Login").performScrollTo().performClick()

        composeTestRule.waitForIdle()

        coVerify { mockAuthApi.login("https://aurboda.net", "testuser", "testpass") }
        assertEquals("https://aurboda.net", savedServerUrl)
        assertEquals("testuser", savedUsername)
        assertEquals("test-token", savedToken)
        assertTrue(loginSuccessCalled)
    }

    @Test
    fun `failed login shows error message`() = runTest {
        val mockAuthApi = mockk<AuthApi>()

        coEvery { mockAuthApi.login(any(), any(), any()) } returns
            LoginResult.Error("Invalid credentials")

        composeTestRule.setContent {
            LoginScreen(
                authApi = mockAuthApi,
                onSaveCredentials = { _, _, _ -> },
                onLoginSuccess = {}
            )
        }

        composeTestRule.onNodeWithText("Username").performTextInput("testuser")
        composeTestRule.onNodeWithText("Password").performTextInput("wrongpass")
        composeTestRule.onNodeWithText("Login").performClick()

        composeTestRule.waitForIdle()

        composeTestRule.onNodeWithText("Invalid credentials").assertIsDisplayed()
    }

    @Test
    fun `failed login does not call onLoginSuccess`() = runTest {
        val mockAuthApi = mockk<AuthApi>()
        var loginSuccessCalled = false

        coEvery { mockAuthApi.login(any(), any(), any()) } returns
            LoginResult.Error("Network error")

        composeTestRule.setContent {
            LoginScreen(
                authApi = mockAuthApi,
                onSaveCredentials = { _, _, _ -> },
                onLoginSuccess = { loginSuccessCalled = true }
            )
        }

        composeTestRule.onNodeWithText("Username").performScrollTo().performTextInput("testuser")
        composeTestRule.onNodeWithText("Password").performScrollTo().performTextInput("testpass")
        composeTestRule.onNodeWithText("Login").performScrollTo().performClick()

        composeTestRule.waitForIdle()

        assertFalse(loginSuccessCalled)
    }

    @Test
    fun `server URL trailing slash is normalized`() = runTest {
        val mockAuthApi = mockk<AuthApi>()

        coEvery { mockAuthApi.login(any(), any(), any()) } returns
            LoginResult.Success("token")

        composeTestRule.setContent {
            LoginScreen(
                initialServerUrl = "https://example.com/",
                authApi = mockAuthApi,
                onSaveCredentials = { _, _, _ -> },
                onLoginSuccess = {}
            )
        }

        composeTestRule.onNodeWithText("Username").performScrollTo().performTextInput("testuser")
        composeTestRule.onNodeWithText("Password").performScrollTo().performTextInput("testpass")
        composeTestRule.onNodeWithText("Login").performScrollTo().performClick()

        composeTestRule.waitForIdle()

        coVerify { mockAuthApi.login("https://example.com", "testuser", "testpass") }
    }
}
