package net.aurboda

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Runs a notification's action button on the server (`POST /notifications/{id}/actions/{key}`). */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        val serverId = intent.getStringExtra(EXTRA_SERVER_ID)
        val key = intent.getStringExtra(EXTRA_ACTION_KEY)
        if (serverId == null || key == null || !isValidNotificationId(serverId) || !isValidActionKey(key)) {
            Log.w(TAG, "Ignoring an action with an invalid id or key")
            return
        }
        val notifyId = intent.getIntExtra(EXTRA_ANDROID_ID, androidNotificationId(serverId))
        val channelId = intent.getStringExtra(EXTRA_CHANNEL_ID)
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Aurboda"
        val appContext = context.applicationContext
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val httpClient = syncHttpClient()
            try {
                val credentials = CredentialsManager.getCredentials(appContext)
                // A receiver kept alive by goAsync has about ten seconds before the system gives up on it.
                val ok = credentials != null &&
                    withTimeoutOrNull(ACTION_TIMEOUT_MS) {
                        runNotificationAction(httpClient, credentials.apiUrl, credentials.authToken, serverId, key)
                    } == true
                if (ok) {
                    NotificationManagerCompat.from(appContext).cancel(notifyId)
                } else {
                    showFailure(appContext, notifyId, channelId, title)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Notification action failed: ${e.message}")
                showFailure(appContext, notifyId, channelId, title)
            } finally {
                httpClient.close()
                pending.finish()
            }
        }
    }

    private fun showFailure(context: Context, notifyId: Int, channelId: String?, title: String) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        val channel = channelId ?: OTHER_NOTIFICATION_CHANNEL.id
        if (channelId == null) NotificationWorker.ensureCentralChannel(context, OTHER_NOTIFICATION_CHANNEL)
        val text = "Could not do that. Open Aurboda to try again."
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(NotificationWorker.tapIntent(context, notifyId, null, null))
            .build()
        try {
            manager.notify(notifyId, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "notify() denied: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "NotificationAction"
        private const val ACTION_TIMEOUT_MS = 8_000L
        const val EXTRA_SERVER_ID = "net.aurboda.notification_server_id"
        const val EXTRA_ACTION_KEY = "net.aurboda.notification_action_key"
        const val EXTRA_ANDROID_ID = "net.aurboda.notification_android_id"
        const val EXTRA_CHANNEL_ID = "net.aurboda.notification_channel_id"
        const val EXTRA_TITLE = "net.aurboda.notification_title"
    }
}
