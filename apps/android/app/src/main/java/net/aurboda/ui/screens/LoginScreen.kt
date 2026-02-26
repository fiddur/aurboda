package net.aurboda.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import net.aurboda.AuthApi
import net.aurboda.LoginResult

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun LoginScreen(
  initialServerUrl: String? = null,
  authApi: AuthApi = remember { AuthApi.create() },
  onSaveCredentials: (serverUrl: String, username: String, token: String) -> Unit = { _, _, _ ->
    throw IllegalStateException("onSaveCredentials must be provided")
  },
  onLoginSuccess: () -> Unit,
) {
  val scope = rememberCoroutineScope()
  val autofill = LocalAutofill.current
  val autofillTree = LocalAutofillTree.current

  var serverUrl by remember { mutableStateOf(initialServerUrl ?: "https://aurboda.net") }
  var username by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var isLoading by remember { mutableStateOf(false) }
  var errorMessage by remember { mutableStateOf<String?>(null) }

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
        .padding(24.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    Text(
      text = "Aurboda",
      style = MaterialTheme.typography.headlineLarge,
    )

    Spacer(modifier = Modifier.height(32.dp))

    OutlinedTextField(
      value = serverUrl,
      onValueChange = { serverUrl = it },
      label = { Text("Server URL") },
      placeholder = { Text("https://aurboda.net") },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
      enabled = !isLoading,
    )

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
      enabled = !isLoading,
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
      enabled = !isLoading,
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

          // Normalize server URL
          val normalizedUrl = serverUrl.trimEnd('/')

          when (val result = authApi.login(normalizedUrl, username, password)) {
            is LoginResult.Success -> {
              onSaveCredentials(normalizedUrl, username, result.token)
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
        !isLoading &&
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
  }
}
