package net.aurboda

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.ktor.client.HttpClient
import java.util.concurrent.TimeUnit

/**
 * Periodic background poll that shows the server's push notifications
 * (`GET /notifications?push_only=true`): the server decides which kinds are pushed,
 * this worker only fetches, picks the new ones ([decideCentralNotifications]) and
 * posts them. Against a server without `/notifications` it falls back to the
 * timeline-based post notifier ([legacyPoll], deciding with [decideNotifications]).
 */
class NotificationWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        if (!isPostNotificationsEnabled(ctx)) return Result.success()

        val credentials = CredentialsManager.getCredentials(ctx) ?: return Result.success()

        val httpClient = syncHttpClient()
        try {
            val highWater = initialCentralHighWater(getCentralNotifyHighWater(ctx), getNotifyHighWater(ctx))
            return when (val fetch = fetchPushNotifications(httpClient, credentials.apiUrl, credentials.authToken, highWater)) {
                PushFetch.Unsupported -> legacyPoll(ctx, httpClient, credentials.apiUrl, credentials.authToken)
                PushFetch.Failed -> Result.retry()
                is PushFetch.Ok -> {
                    val decision = decideCentralNotifications(fetch.page.notifications, highWater)
                    if (decision.toNotify.isNotEmpty()) {
                        val types = fetchNotificationTypes(httpClient, credentials.apiUrl, credentials.authToken)
                            ?.types ?: emptyList()
                        decision.toNotify.takeLast(MAX_PER_RUN).forEach { postServerNotification(ctx, it, types) }
                    }
                    decision.newHighWater?.let { setCentralNotifyHighWater(ctx, it) }
                    Result.success()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Notification poll failed: ${e.message}")
            return Result.retry()
        } finally {
            httpClient.close()
        }
    }

    private suspend fun legacyPoll(ctx: Context, httpClient: HttpClient, apiUrl: String, authToken: String): Result {
        val following = fetchFollowingList(httpClient, apiUrl, authToken)
            ?: return Result.retry()
        val timeline = fetchTimelinePage(httpClient, apiUrl, authToken)
            ?: return Result.retry()

        val notifyActors = following.following.filter { it.notifyOnPost }.map { it.actorUri }.toSet()
        val decision = decideNotifications(timeline.entries, notifyActors, getNotifyHighWater(ctx))

        if (decision.toNotify.isNotEmpty()) {
            ensureChannel(ctx)
            decision.toNotify.takeLast(MAX_PER_RUN).forEach { postNotification(ctx, it) }
        }
        decision.newHighWater?.let { setNotifyHighWater(ctx, it) }
        return Result.success()
    }

    private fun postServerNotification(ctx: Context, notification: ServerNotification, types: List<NotificationTypeLite>) {
        val manager = NotificationManagerCompat.from(ctx)
        if (!manager.areNotificationsEnabled()) return

        val channel = notificationChannelFor(notification.type, types)
        ensureCentralChannel(ctx, channel)
        val notifyId = androidNotificationId(notification.id)

        val builder = NotificationCompat.Builder(ctx, channel.id)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(notification.title)
            .setAutoCancel(true)
            .setContentIntent(tapIntent(ctx, notifyId, notification.link, notification.id))
        notification.body?.let { body ->
            builder.setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body))
        }
        notification.actions.forEach { action ->
            val actionIntent = Intent(ctx, NotificationActionReceiver::class.java).apply {
                putExtra(NotificationActionReceiver.EXTRA_SERVER_ID, notification.id)
                putExtra(NotificationActionReceiver.EXTRA_ACTION_KEY, action.key)
                putExtra(NotificationActionReceiver.EXTRA_ANDROID_ID, notifyId)
                putExtra(NotificationActionReceiver.EXTRA_CHANNEL_ID, channel.id)
                putExtra(NotificationActionReceiver.EXTRA_TITLE, notification.title)
            }
            val pendingAction = PendingIntent.getBroadcast(
                ctx,
                "${notification.id}:${action.key}".hashCode(),
                actionIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            builder.addAction(0, action.label, pendingAction)
        }

        try {
            manager.notify(notifyId, builder.build())
        } catch (e: SecurityException) {
            Log.w(TAG, "notify() denied: ${e.message}")
        }
    }

    private fun postNotification(ctx: Context, entry: TimelineEntry) {
        // areNotificationsEnabled covers the runtime POST_NOTIFICATIONS grant on
        // 13+ and the user muting the channel/app — skip quietly if off.
        val manager = NotificationManagerCompat.from(ctx)
        if (!manager.areNotificationsEnabled()) return

        val openIntent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_OPEN_TAB, MainActivity.TAB_FEED)
        }
        val pendingIntent = PendingIntent.getActivity(
            ctx,
            entry.objectUri.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(entry.authorLabel)
            .setContentText(htmlToSnippet(entry.content))
            .setStyle(NotificationCompat.BigTextStyle().bigText(htmlToSnippet(entry.content, maxLength = 400)))
            .setAutoCancel(true)
            .setGroup(GROUP_KEY)
            .setContentIntent(pendingIntent)
            .build()

        try {
            manager.notify(entry.objectUri.hashCode(), notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "notify() denied: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "NotificationWorker"
        private const val WORK_NAME = "post_notifications_poll"
        private const val CHECK_SOON_WORK_NAME = "notifications_check_soon"
        private const val CHANNEL_ID = "post_notifications"
        private const val GROUP_KEY = "net.aurboda.POSTS"
        private const val MAX_PER_RUN = 8

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val channel = NotificationChannel(
                CHANNEL_ID,
                "New posts",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = "Posts from accounts you follow" }
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }

        fun ensureCentralChannel(context: Context, spec: ChannelSpec) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val channel = NotificationChannel(spec.id, spec.name, NotificationManager.IMPORTANCE_DEFAULT)
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }

        /**
         * Opens [link] (see [notificationTapTarget]); with [serverId] the tap also marks that
         * notification read.
         */
        fun tapIntent(context: Context, requestCode: Int, link: String?, serverId: String?): PendingIntent {
            val target = notificationTapTarget(link)
            val openIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(MainActivity.EXTRA_OPEN_TAB, target.tab)
                target.morePath?.let { putExtra(MainActivity.EXTRA_MORE_PATH, it) }
                serverId?.let { putExtra(MainActivity.EXTRA_NOTIFICATION_ID, it) }
            }
            return PendingIntent.getActivity(
                context,
                requestCode,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        fun schedule(context: Context) {
            ensureChannel(context)
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<NotificationWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
            Log.d(TAG, "Post-notification poll scheduled")
        }

        /** One extra poll shortly, e.g. after a sync that may have raised an auto-share notification. */
        fun checkSoon(context: Context, delaySeconds: Long = 60) {
            if (!isPostNotificationsEnabled(context)) return
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = OneTimeWorkRequestBuilder<NotificationWorker>()
                .setConstraints(constraints)
                .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(CHECK_SOON_WORK_NAME, ExistingWorkPolicy.REPLACE, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.d(TAG, "Post-notification poll cancelled")
        }
    }
}
