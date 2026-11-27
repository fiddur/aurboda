package net.aurboda.ui.screens

import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive

/**
 * Reads `window.aurbodaLeaveGuard` (see apps/web), the page's request to confirm
 * before native navigation leaves it. Evaluates to the message, or null.
 */
const val LEAVE_GUARD_JS =
    "(function(){try{var g=window.aurbodaLeaveGuard;var m=typeof g==='function'?g():null;" +
        "return typeof m==='string'&&m?m:null}catch(e){return null}})()"

/** Decodes the JSON value `WebView.evaluateJavascript` hands back for [LEAVE_GUARD_JS]. */
fun parseLeaveGuardResult(raw: String?): String? {
    if (raw.isNullOrBlank()) return null
    val element = runCatching { Json.parseToJsonElement(raw) }.getOrNull()
    val primitive = element as? JsonPrimitive ?: return null
    if (!primitive.isString) return null
    return primitive.content.ifEmpty { null }
}

/**
 * Lets native navigation ask the embedded web page showing now whether it may be
 * left. [ask] is set by that page's `EmbeddedWebScreen`; [confirm] by the app,
 * which shows the dialog.
 */
class WebLeaveGuard {
    var ask: ((onAnswer: (String?) -> Unit) -> Unit)? = null
    var confirm: ((message: String, proceed: () -> Unit) -> Unit)? = null

    fun check(onAnswer: (String?) -> Unit) {
        val current = ask
        if (current == null) onAnswer(null) else current(onAnswer)
    }

    fun confirmThen(proceed: () -> Unit) {
        check { message ->
            val showConfirm = confirm
            if (message == null || showConfirm == null) proceed() else showConfirm(message, proceed)
        }
    }
}

val LocalWebLeaveGuard = staticCompositionLocalOf<WebLeaveGuard?> { null }
