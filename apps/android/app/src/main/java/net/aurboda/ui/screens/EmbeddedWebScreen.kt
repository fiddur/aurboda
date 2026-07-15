package net.aurboda.ui.screens

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.view.ContextThemeWrapper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
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
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import net.aurboda.R
import org.json.JSONObject

/**
 * Fallback bridge exposed to the embedded web app as `window.AurbodaNative` on
 * WebViews that lack document-start script support (see [installAuthBridge]).
 * The web app reads [getAuth] at startup to share the native app's bearer token
 * instead of prompting for a second login (see apps/web/src/embed.ts).
 *
 * Security: added via `addJavascriptInterface`, [getAuth] is reachable from
 * every frame the WebView loads, including cross-origin iframes. That is
 * acceptable because the feed sanitiser strips `<iframe>`/`<script>` and
 * external navigation is punted to the browser, so no untrusted origin renders
 * here. The preferred path ([installAuthBridge] via `WebViewCompat`) avoids the
 * cross-origin exposure by scoping injection to the trusted origin.
 */
private class AuthBridge(private val authJson: String) {
    @JavascriptInterface
    fun getAuth(): String = authJson
}

/**
 * Install the auth bridge (`window.AurbodaNative.getAuth()`) the embedded web
 * app reads at startup.
 *
 * Preferred path: a document-start script scoped to [origin] via `WebViewCompat`
 * so the token reaches only the trusted origin's frames (a cross-origin iframe
 * never receives it) and is present before the page's own scripts run. Falls
 * back to `addJavascriptInterface` when the WebView lacks document-start-script
 * support or [origin] is unknown; that path injects into all frames, which is
 * safe because the feed sanitiser strips `<iframe>`/`<script>` and external
 * navigation opens in the browser.
 */
private fun installAuthBridge(webView: WebView, authJson: String, origin: String?) {
    if (origin != null && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
        val script = "window.AurbodaNative={getAuth:function(){return ${JSONObject.quote(authJson)};}};"
        val installed = runCatching {
            WebViewCompat.addDocumentStartJavaScript(webView, script, setOf(origin))
        }.isSuccess
        if (installed) return
    }
    webView.addJavascriptInterface(AuthBridge(authJson), "AurbodaNative")
}

/**
 * Hosts a page of the web app inside a WebView so native and web share one
 * implementation. The native app supplies navigation, the web app renders in
 * embed mode (chrome hidden). Auth is shared through an origin-scoped bridge
 * ([installAuthBridge]); links to other domains open in the external browser,
 * same-origin links stay in the WebView.
 *
 * @param url the web page to load (already carrying `?embed=1`)
 * @param baseUrl the server origin, used to decide which links are external and
 *   to scope the auth bridge to the trusted origin
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
                // Build the WebView against a day/night-themed context so its
                // `isLightTheme` (and thus the page's `prefers-color-scheme`)
                // follows the system dark-mode setting, even though the native
                // app UI stays on the light Theme.Aurboda.
                val webViewContext = ContextThemeWrapper(ctx, R.style.Theme_Aurboda_WebView)
                WebView(webViewContext).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    // Establish a proper layout viewport from the page's
                    // `<meta viewport>` (width=device-width, initial-scale=1).
                    // Without this the WebView doesn't give viewport-height /
                    // flex-fill layouts a stable height, collapsing full-height
                    // pages like the timeline (scale stays 1:1 either way).
                    settings.useWideViewPort = true
                    settings.loadWithOverviewMode = true
                    // Let the embedded web app's own dark styles apply when the
                    // system is in dark mode (the page declares color-scheme
                    // support, so WebView uses its CSS rather than auto-inverting).
                    if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                        WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, true)
                    }
                    installAuthBridge(this, authJson, originOf(baseUrl))
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

                        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                            // The embedded app is a client-side SPA: in-app
                            // navigation happens via pushState, which does not
                            // fire onPageFinished. Refresh here too so the back
                            // gesture walks WebView history instead of leaving.
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

                        override fun onReceivedHttpError(
                            view: WebView,
                            request: WebResourceRequest,
                            errorResponse: WebResourceResponse,
                        ) {
                            // A main-frame HTTP error (e.g. a 5xx or 404 on the
                            // page shell) would otherwise render the server's
                            // error body; show the native retry state instead.
                            // (Token-expiry 401s hit client-side fetches to
                            // /api, not the main-frame load, so not this branch.)
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
