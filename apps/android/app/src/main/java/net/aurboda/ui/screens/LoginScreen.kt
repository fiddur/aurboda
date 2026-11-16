package net.aurboda.ui.screens

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.AutofillNode
import androidx.compose.ui.autofill.AutofillType
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalAutofill
import androidx.compose.ui.platform.LocalAutofillTree
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.aurboda.AuthApi
import net.aurboda.LoginResult
import net.aurboda.OIDC_NO_BROWSER_MESSAGE
import net.aurboda.OIDC_NOT_STARTED_MESSAGE
import net.aurboda.OidcCallback
import net.aurboda.OidcExchangeResult
import net.aurboda.OidcLogin
import net.aurboda.OidcStartResult
import net.aurboda.PasskeyApi
import net.aurboda.PasskeyLoginResult
import net.aurboda.R
import net.aurboda.api.models.OidcPreset
import net.aurboda.api.models.OidcPublicProvider
import net.aurboda.oidcErrorMessage

private const val TAG = "LoginScreen"

/**
 * Opens [url] in a Custom Tab (Google refuses OAuth inside a WebView), else in any browser.
 * False when nothing can open it.
 */
private fun openInBrowser(
  context: Context,
  url: String,
): Boolean {
  val uri = Uri.parse(url)
  try {
    CustomTabsIntent.Builder().build().launchUrl(context, uri)
    return true
  } catch (e: ActivityNotFoundException) {
    Log.d(TAG, "No Custom Tabs browser: ${e.message}")
  }
  return try {
    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
    true
  } catch (e: ActivityNotFoundException) {
    Log.w(TAG, "No browser: ${e.message}")
    false
  }
}

@Composable
private fun OidcProviderButton(
  provider: OidcPublicProvider,
  enabled: Boolean,
  loading: Boolean,
  onClick: () -> Unit,
) {
  OutlinedButton(
    onClick = onClick,
    modifier = Modifier.fillMaxWidth(),
    enabled = enabled,
  ) {
    if (loading) {
      CircularProgressIndicator(
        modifier = Modifier.size(20.dp),
        strokeWidth = 2.dp,
      )
    } else if (provider.preset == OidcPreset.google) {
      Image(
        painter = painterResource(R.drawable.ic_google_g),
        contentDescription = null,
        modifier = Modifier.size(18.dp),
      )
      Spacer(modifier = Modifier.width(12.dp))
      Text("Sign in with Google")
    } else {
      Text("Continue with ${provider.displayName}")
    }
  }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun LoginScreen(
  initialServerUrl: String? = null,
  notice: String? = null,
  authApi: AuthApi = remember { AuthApi.create() },
  passkeyApi: PasskeyApi = remember { PasskeyApi.create() },
  onSaveCredentials: (serverUrl: String, username: String, token: String) -> Unit = { _, _, _ ->
    throw IllegalStateException("onSaveCredentials must be provided")
  },
  onLoginSuccess: () -> Unit,
) {
  val scope = rememberCoroutineScope()
  val context = LocalContext.current
  val autofill = LocalAutofill.current
  val autofillTree = LocalAutofillTree.current
  val uriHandler = LocalUriHandler.current

  var serverUrl by remember { mutableStateOf(initialServerUrl ?: "https://aurboda.net") }
  var username by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var isLoading by remember { mutableStateOf(false) }
  var isPasskeyLoading by remember { mutableStateOf(false) }
  var errorMessage by remember { mutableStateOf<String?>(null) }
  var emailEnabled by remember { mutableStateOf(false) }
  var oidcProviders by remember { mutableStateOf<List<OidcPublicProvider>>(emptyList()) }
  var oidcLoadingId by remember { mutableStateOf<String?>(null) }
  // Not a delegated var: it is read only above the effect that sets it, which the compiler reports as never read.
  val oidcExchanging = remember { mutableStateOf(false) }
  val isBusy = isLoading || isPasskeyLoading || oidcLoadingId != null || oidcExchanging.value
  val saveCredentials by rememberUpdatedState(onSaveCredentials)
  val loginSucceeded by rememberUpdatedState(onLoginSuccess)

  LaunchedEffect(serverUrl) {
    emailEnabled = false
    oidcProviders = emptyList()
    if (serverUrl.isBlank()) return@LaunchedEffect
    delay(500)
    val normalizedUrl = serverUrl.trimEnd('/')
    emailEnabled =
      try {
        authApi.isEmailEnabled(normalizedUrl)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        false
      }
    oidcProviders =
      try {
        authApi.oidcProviders(normalizedUrl)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        emptyList()
      }
  }

  // Collected rather than keyed on: consuming the callback must not cancel the exchange it starts.
  LaunchedEffect(Unit) {
    OidcLogin.callback.collect { callback ->
      if (callback == null) return@collect
      OidcLogin.consumeCallback()
      val pending = OidcLogin.pending.take()
      when (callback) {
        is OidcCallback.Failure -> {
          errorMessage = oidcErrorMessage(callback.error)
        }
        is OidcCallback.Code -> {
          if (pending == null) {
            errorMessage = OIDC_NOT_STARTED_MESSAGE
          } else {
            oidcExchanging.value = true
            errorMessage = null
            when (val result = authApi.oidcExchange(pending.serverUrl, callback.code, pending.verifier)) {
              is OidcExchangeResult.Success -> {
                saveCredentials(pending.serverUrl, result.username, result.token)
                loginSucceeded()
              }
              is OidcExchangeResult.Error -> {
                errorMessage = result.message
              }
            }
            oidcExchanging.value = false
          }
        }
      }
    }
  }

  val usernameAutofillNode =
    remember {
      AutofillNode(
        autofillTypes = listOf(AutofillType.Username),
        onFill = { username = it },
      )
    }
  val passwordAutofillNode =
    remember {
      AutofillNode(
        autofillTypes = listOf(AutofillType.Password),
        onFill = { password = it },
      )
    }
  autofillTree += usernameAutofillNode
  autofillTree += passwordAutofillNode

  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(24.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    Text(
      text = "Aurboda",
      style = MaterialTheme.typography.headlineLarge,
    )

    if (notice != null) {
      Spacer(modifier = Modifier.height(16.dp))
      Text(
        text = notice,
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodyMedium,
      )
    }

    Spacer(modifier = Modifier.height(32.dp))

    OutlinedTextField(
      value = serverUrl,
      onValueChange = { serverUrl = it },
      label = { Text("Server URL") },
      placeholder = { Text("https://aurboda.net") },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
      enabled = !isBusy,
    )

    Spacer(modifier = Modifier.height(16.dp))

    OutlinedButton(
      onClick = {
        scope.launch {
          isPasskeyLoading = true
          errorMessage = null
          val normalizedUrl = serverUrl.trimEnd('/')
          when (val result = passkeyApi.login(context, normalizedUrl)) {
            is PasskeyLoginResult.Success -> {
              onSaveCredentials(normalizedUrl, result.username, result.token)
              onLoginSuccess()
            }
            is PasskeyLoginResult.Error -> {
              errorMessage = result.message
            }
          }
          isPasskeyLoading = false
        }
      },
      modifier = Modifier.fillMaxWidth(),
      enabled = !isBusy && serverUrl.isNotBlank(),
    ) {
      if (isPasskeyLoading) {
        CircularProgressIndicator(
          modifier = Modifier.size(20.dp),
          strokeWidth = 2.dp,
        )
      } else {
        Text("Sign in with passkey")
      }
    }

    for (provider in oidcProviders) {
      Spacer(modifier = Modifier.height(8.dp))
      OidcProviderButton(
        provider = provider,
        enabled = !isBusy && serverUrl.isNotBlank(),
        loading = oidcLoadingId == provider.id,
        onClick = {
          scope.launch {
            oidcLoadingId = provider.id
            errorMessage = null
            val normalizedUrl = serverUrl.trimEnd('/')
            when (val result = authApi.oidcStart(normalizedUrl, provider.id)) {
              is OidcStartResult.Success -> {
                OidcLogin.pending.start(normalizedUrl, result.verifier)
                if (!openInBrowser(context, result.authorizationUrl)) {
                  OidcLogin.pending.take()
                  errorMessage = OIDC_NO_BROWSER_MESSAGE
                }
              }
              is OidcStartResult.Error -> {
                errorMessage = result.message
              }
            }
            oidcLoadingId = null
          }
        },
      )
    }

    Spacer(modifier = Modifier.height(16.dp))

    OutlinedTextField(
      value = username,
      onValueChange = { username = it },
      label = { Text("Username") },
      modifier =
        Modifier
          .fillMaxWidth()
          .onGloballyPositioned { coordinates ->
            usernameAutofillNode.boundingBox = coordinates.boundsInWindow()
          }.onFocusChanged { focusState ->
            if (focusState.isFocused) {
              autofill?.requestAutofillForNode(usernameAutofillNode)
            } else {
              autofill?.cancelAutofillForNode(usernameAutofillNode)
            }
          },
      singleLine = true,
      enabled = !isBusy,
    )

    Spacer(modifier = Modifier.height(16.dp))

    OutlinedTextField(
      value = password,
      onValueChange = { password = it },
      label = { Text("Password") },
      modifier =
        Modifier
          .fillMaxWidth()
          .onGloballyPositioned { coordinates ->
            passwordAutofillNode.boundingBox = coordinates.boundsInWindow()
          }.onFocusChanged { focusState ->
            if (focusState.isFocused) {
              autofill?.requestAutofillForNode(passwordAutofillNode)
            } else {
              autofill?.cancelAutofillForNode(passwordAutofillNode)
            }
          },
      singleLine = true,
      visualTransformation = PasswordVisualTransformation(),
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
      enabled = !isBusy,
    )

    if (errorMessage != null) {
      Spacer(modifier = Modifier.height(8.dp))
      Text(
        text = errorMessage!!,
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall,
      )
    }

    Spacer(modifier = Modifier.height(24.dp))

    Button(
      onClick = {
        scope.launch {
          isLoading = true
          errorMessage = null

          val normalizedUrl = serverUrl.trimEnd('/')
          val trimmedUsername = username.trim()

          when (val result = authApi.login(normalizedUrl, trimmedUsername, password)) {
            is LoginResult.Success -> {
              onSaveCredentials(normalizedUrl, trimmedUsername, result.token)
              onLoginSuccess()
            }
            is LoginResult.Error -> {
              errorMessage = result.message
            }
          }
          isLoading = false
        }
      },
      modifier = Modifier.fillMaxWidth(),
      enabled =
        !isBusy &&
          serverUrl.isNotBlank() &&
          username.isNotBlank() &&
          password.isNotBlank(),
    ) {
      if (isLoading) {
        CircularProgressIndicator(
          modifier = Modifier.size(20.dp),
          strokeWidth = 2.dp,
        )
      } else {
        Text("Login")
      }
    }

    if (emailEnabled) {
      Spacer(modifier = Modifier.height(8.dp))
      TextButton(
        onClick = { uriHandler.openUri("${serverUrl.trimEnd('/')}/recover-request") },
        enabled = !isBusy,
      ) {
        Text("Forgot your password or lost your passkey?")
      }
    }
  }
}
