package net.aurboda.ui.screens

import java.net.URI

/**
 * Whether [target] points outside the origin of [base] and should therefore open
 * in the external browser instead of the embedded WebView.
 *
 * A different host is external; non-http(s) schemes (mailto:, tel:, intent:) are
 * external too. Relative or unparseable targets have no host of their own and
 * stay in the WebView. Host comparison ignores case and port.
 */
fun isExternalLink(base: String, target: String): Boolean {
    val baseHost = runCatching { URI(base).host }.getOrNull() ?: return false
    val targetUri = runCatching { URI(target) }.getOrNull() ?: return false
    val scheme = targetUri.scheme?.lowercase()
    if (scheme != null && scheme != "http" && scheme != "https") return true
    val targetHost = targetUri.host ?: return false
    return !targetHost.equals(baseHost, ignoreCase = true)
}
