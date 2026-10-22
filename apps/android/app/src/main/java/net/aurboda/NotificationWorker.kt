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
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Periodic background poll that notifies the user when accounts they follow post
 * to their home timeline. Runs only while the user has enabled post
 * notifications; per-account muting is honoured server-side via each follow's
 * `notify_on_post` flag. The which-posts-to-notify decision is the pure
 * [decideNotifications]; this worker is just the I/O + notification plumbing.
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
            val following = fetchFollowingList(httpClient, credentials.apiUrl, credentials.authToken)
                ?: return Result.retry()
            val timeline = fetchTimelinePage(httpClient, credentials.apiUrl, credentials.authToken)
                ?: return Result.retry()

            val notifyActors = following.following.filter { it.notifyOnPost }.map { it.actorUri }.toSet()
            val decision = decideNotifications(timeline.entries, notifyActors, getNotifyHighWater(ctx))

            if (decision.toNotify.isNotEmpty()) {
                ensureChannel(ctx)
                decision.toNotify.takeLast(MAX_PER_RUN).forEach { postNotification(ctx, it) }
            }
            decision.newHighWater?.let { setNotifyHighWater(ctx, it) }
            return Result.success()
        } catch (e: Exception) {
            Log.w(TAG, "Notification poll failed: ${e.message}")
            return Result.retry()
        } finally {
            httpClient.close()
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

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.d(TAG, "Post-notification poll cancelled")
        }
    }
}
