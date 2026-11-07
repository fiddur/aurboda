package net.aurboda.ui.screens

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.view.View
import android.view.WindowManager
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import java.util.concurrent.atomic.AtomicReference

typealias WebFileChooser = (ValueCallback<Array<Uri>>, WebChromeClient.FileChooserParams) -> Boolean

/**
 * The [WebChromeClient] for [EmbeddedWebScreen]. Without one, WebView suppresses
 * every JavaScript dialog (`confirm()` returns false, `prompt()` null, `alert()`
 * shows nothing) and every `<input type="file">`, so the web app's dialogs and
 * file inputs are shown natively here instead.
 *
 * @param activityContext the composition's context (an Activity): dialogs need an
 *   Activity window token, which the WebView's themed wrapper context does not carry
 */
fun embeddedWebChromeClient(activityContext: Context, showFileChooser: WebFileChooser): WebChromeClient =
    object : WebChromeClient() {
        override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            showJsDialog(
                context = activityContext,
                message = message,
                withCancel = false,
                onConfirm = { result.confirm() },
                onDismiss = { result.confirm() },
            )
            return true
        }

        override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            showJsDialog(
                context = activityContext,
                message = message,
                onConfirm = { result.confirm() },
                onDismiss = { result.cancel() },
            )
            return true
        }

        override fun onJsPrompt(
            view: WebView,
            url: String?,
            message: String?,
            defaultValue: String?,
            result: JsPromptResult,
        ): Boolean {
            val input = EditText(activityContext).apply {
                setSingleLine()
                setText(defaultValue.orEmpty())
                selectAll()
            }
            val padding = (20 * activityContext.resources.displayMetrics.density).toInt()
            val content = FrameLayout(activityContext).apply {
                setPadding(padding, 0, padding, 0)
                addView(input)
            }
            showJsDialog(
                context = activityContext,
                message = message,
                content = content,
                onConfirm = { result.confirm(input.text.toString()) },
                onDismiss = { result.cancel() },
                beforeShow = { dialog ->
                    dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
                    input.requestFocus()
                },
            )
            return true
        }

        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams,
        ): Boolean = showFileChooser(filePathCallback, fileChooserParams)
    }

/**
 * Show a JS dialog and settle its result exactly once, whichever way it closes:
 * OK runs [onConfirm]; Cancel, back, an outside tap or any other dismissal runs
 * [onDismiss]. When the Activity cannot host a window (finishing, destroyed, or
 * the show fails) [onDismiss] runs at once, so the page's script never hangs.
 */
private fun showJsDialog(
    context: Context,
    message: String?,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    withCancel: Boolean = true,
    content: View? = null,
    beforeShow: (AlertDialog) -> Unit = {},
) {
    var settled = false
    fun settle(action: () -> Unit) {
        if (!settled) {
            settled = true
            action()
        }
    }

    if (!canHostDialog(context)) {
        settle(onDismiss)
        return
    }
    val builder = AlertDialog.Builder(context)
        .setMessage(message)
        .setPositiveButton(android.R.string.ok) { _, _ -> settle(onConfirm) }
        .setOnCancelListener { settle(onDismiss) }
        .setOnDismissListener { settle(onDismiss) }
    if (withCancel) builder.setNegativeButton(android.R.string.cancel) { _, _ -> settle(onDismiss) }
    if (content != null) builder.setView(content)
    val dialog = builder.create()
    beforeShow(dialog)
    runCatching { dialog.show() }.onFailure { settle(onDismiss) }
}

private fun canHostDialog(context: Context): Boolean {
    val activity = context.findActivity() ?: return false
    return !activity.isFinishing && !activity.isDestroyed
}

private fun Context.findActivity(): Activity? {
    var current: Context = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}

/**
 * The URIs a file picker returned, or null when it was cancelled or returned
 * nothing (what `ValueCallback.onReceiveValue` expects on cancel). A multi-select
 * picker returns its picks in `clipData`; a single pick comes back as `data`.
 */
internal fun fileChooserResultUris(resultCode: Int, data: Intent?): Array<Uri>? {
    if (resultCode != Activity.RESULT_OK || data == null) return null
    val clip = data.clipData
    if (clip != null) {
        val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
        if (uris.isNotEmpty()) return uris.toTypedArray()
    }
    return data.data?.let { arrayOf(it) }
}

/**
 * Backs `<input type="file">` in the embedded page with the system picker. The
 * page's callback is settled exactly once: with the picks, or null on cancel, on
 * a superseding request, when no picker app exists, or when the screen leaves.
 */
@Composable
fun rememberWebFileChooser(): WebFileChooser {
    val pending = remember { AtomicReference<ValueCallback<Array<Uri>>?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        pending.getAndSet(null)?.onReceiveValue(fileChooserResultUris(result.resultCode, result.data))
    }
    DisposableEffect(Unit) {
        onDispose { pending.getAndSet(null)?.onReceiveValue(null) }
    }
    return remember<WebFileChooser>(launcher) {
        { callback, params ->
            pending.getAndSet(callback)?.onReceiveValue(null)
            val intent = params.createIntent()
            if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            try {
                launcher.launch(intent)
            } catch (e: ActivityNotFoundException) {
                pending.getAndSet(null)?.onReceiveValue(null)
            }
            true
        }
    }
}
