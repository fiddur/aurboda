package net.aurboda.ui.screens

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONObject

/**
 * Bridge exposed to the embedded web app as `window.AurbodaNative`. The web app
 * reads [getAuth] at startup to share the native app's bearer token instead of
 * prompting for a second login (see apps/web/src/embed.ts).
 */
private class AuthBridge(private val authJson: String) {
    @JavascriptInterface
    fun getAuth(): String = authJson
}

/**
 * Hosts a page of the web app inside a WebView so native and web share one
 * implementation. The native app supplies navigation, the web app renders in
 * embed mode (chrome hidden). Links to other domains open in the external
 * browser; same-origin links stay in the WebView.
 *
 * @param url the web page to load (already carrying `?embed=1`)
 * @param baseUrl the server origin, used to decide which links are external
 */
@Suppress("ASSIGNED_VALUE_IS_NEVER_READ") // Compose state vars trigger false "assigned but never read" warnings
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EmbeddedWebScreen(
    url: String,
    baseUrl: String,
    username: String,
    authToken: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var loading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var canGoBack by remember { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    val authJson = remember(username, authToken) {
        JSONObject().put("user", username).put("token", authToken).toString()
    }

    // Let the WebView consume the system back gesture to walk its own history
    // before the back press falls through to leaving the screen.
    BackHandler(enabled = canGoBack) {
        webView?.goBack()
    }

    Box(modifier = modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    addJavascriptInterface(AuthBridge(authJson), "AurbodaNative")
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest,
                        ): Boolean {
                            if (isExternalLink(baseUrl, request.url.toString())) {
                                runCatching {
                                    context.startActivity(
                                        Intent(Intent.ACTION_VIEW, request.url)
                                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                                    )
                                }
                                return true
                            }
                            return false
                        }

                        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                            loading = true
                            errorMessage = null
                        }

                        override fun onPageFinished(view: WebView, url: String?) {
                            loading = false
                            canGoBack = view.canGoBack()
                        }

                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            error: WebResourceError,
                        ) {
                            // Only the main frame failing is a page load error;
                            // ignore failed sub-resources (images, tiles, etc.).
                            if (request.isForMainFrame) {
                                loading = false
                                errorMessage = "Could not load page"
                            }
                        }
                    }
                    webView = this
                    loadUrl(url)
                }
            },
            onRelease = { it.destroy() },
        )

        if (loading && errorMessage == null) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        }

        errorMessage?.let { message ->
            Column(
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(message)
                Button(
                    onClick = {
                        errorMessage = null
                        loading = true
                        webView?.reload()
                    },
                ) {
                    Text("Retry")
                }
            }
        }
    }
}
