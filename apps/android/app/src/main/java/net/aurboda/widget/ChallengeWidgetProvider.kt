package net.aurboda.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.util.SizeF
import android.widget.RemoteViews
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import android.graphics.Typeface
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StyleSpan
import android.view.View
import io.ktor.client.HttpClient
import kotlinx.coroutines.CancellationException
import net.aurboda.CredentialsManager
import net.aurboda.DataResult
import net.aurboda.MainActivity
import net.aurboda.R
import net.aurboda.api.models.ChallengeStanding
import net.aurboda.api.models.DiscoveredChallenge
import net.aurboda.parseChallengeUrl
import net.aurboda.syncHttpClient

private const val TAG = "ChallengeWidget"

/**
 * Home-screen widget showing one challenge: its race chart and leaderboard, tap
 * to open that challenge in the app. Which challenge is chosen per widget in
 * [ChallengeWidgetConfigActivity]; a day after it ends the widget moves on by
 * itself to another challenge of the user's, or suggests one to join (see
 * [widgetTarget]). All rendering — including the network fetch — happens in
 * [ChallengeWidgetWorker]; the receiver itself only enqueues it, so a slow
 * server can't hit the broadcast timeout.
 */
class ChallengeWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        Log.d(TAG, "onUpdate for ${appWidgetIds.size} widgets")
        ChallengeWidgetWorker.enqueue(context)
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle,
    ) {
        // A resize changes how many leaderboard rows fit and the chart bitmap size.
        ChallengeWidgetWorker.enqueue(context)
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        clearChallengeWidgetConfig(context, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_UPDATE_WIDGETS) ChallengeWidgetWorker.enqueue(context)
    }

    companion object {
        const val ACTION_UPDATE_WIDGETS = "net.aurboda.ACTION_UPDATE_CHALLENGE_WIDGETS"

        /** Refresh every challenge widget — called after a sync lands new data. */
        fun triggerUpdate(context: Context) {
            val intent = Intent(context, ChallengeWidgetProvider::class.java).apply { action = ACTION_UPDATE_WIDGETS }
            context.sendBroadcast(intent)
        }
    }
}

/**
 * Renders all challenge widgets: fetches each one's standings and pushes the
 * RemoteViews. Enqueued (unique, appended) from the provider, the configuration
 * screen and after background sync.
 */
class ChallengeWidgetWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val manager = AppWidgetManager.getInstance(applicationContext)
        val ids = manager.getAppWidgetIds(ComponentName(applicationContext, ChallengeWidgetProvider::class.java))
        if (ids.isEmpty()) return Result.success()
        val credentials = CredentialsManager.getCredentials(applicationContext)
        val httpClient: HttpClient = syncHttpClient()
        try {
            // The user's own challenges are the same for every widget: one round-trip per refresh.
            val lists = credentials?.let { fetchChallengeWidgetLists(httpClient, it) }
            for (id in ids) {
                try {
                    renderChallengeWidget(applicationContext, manager, id, httpClient, credentials, lists)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // One broken widget must not stop the others from refreshing.
                    Log.e(TAG, "Rendering widget $id failed", e)
                }
            }
        } finally {
            httpClient.close()
        }
        return Result.success()
    }

    companion object {
        private const val WORK_NAME = "challenge_widget_refresh"

        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<ChallengeWidgetWorker>().build()
            // APPEND_OR_REPLACE: a refresh requested while one is running (e.g. a widget
            // was just configured) runs after it instead of being dropped or cutting it short.
            WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }
    }
}

/**
 * Decide what one widget shows (see [widgetTarget]), fetch it and push the views
 * (or an explanatory state) to the launcher. [lists] is the user's hosted +
 * joined challenges, fetched once by the worker for all widgets; null when
 * signed out.
 */
suspend fun renderChallengeWidget(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    httpClient: HttpClient,
    credentials: CredentialsManager.Credentials?,
    lists: DataResult<ChallengeWidgetLists>?,
) {
    val config = loadChallengeWidgetConfig(context, appWidgetId)
    if (config == null) {
        appWidgetManager.updateAppWidget(appWidgetId, unconfiguredViews(context, appWidgetId, "Tap to choose a challenge"))
        return
    }
    if (credentials == null || lists == null) {
        appWidgetManager.updateAppWidget(
            appWidgetId,
            statusViews(context, appWidgetId, config, serverUrl = null, "Sign in to Aurboda to see standings"),
        )
        return
    }
    val loaded =
        when (lists) {
            is DataResult.Error -> {
                Log.w(TAG, "Widget $appWidgetId: ${lists.message}")
                appWidgetManager.updateAppWidget(
                    appWidgetId,
                    statusViews(context, appWidgetId, config, credentials.serverUrl, lists.message),
                )
                return
            }
            is DataResult.Success -> lists.data
        }
    val nowMillis = System.currentTimeMillis()
    val picks = challengePicks(loaded.hosted, loaded.joined)
    val views =
        when (val target = widgetTarget(config.url, picks, nowMillis)) {
            is WidgetTarget.Keep -> {
                // Refresh the cached name so a rename shows up in the loading/error states too.
                if (target.pick.name != config.name) {
                    saveChallengeWidgetConfig(context, appWidgetId, config.copy(name = target.pick.name))
                }
                standingsViews(context, appWidgetManager, appWidgetId, httpClient, credentials, target.pick)
            }
            is WidgetTarget.Advance -> {
                Log.i(TAG, "Widget $appWidgetId: moving on from \"${config.name}\" to \"${target.pick.name}\"")
                saveChallengeWidgetConfig(context, appWidgetId, ChallengeWidgetConfig(target.pick.url, target.pick.name))
                standingsViews(context, appWidgetManager, appWidgetId, httpClient, credentials, target.pick)
            }
            is WidgetTarget.Suggest -> {
                val suggestion = fetchWidgetSuggestion(httpClient, credentials)
                when {
                    suggestion != null -> suggestionViews(context, appWidgetId, suggestion, credentials.serverUrl, nowMillis)
                    target.fallback != null ->
                        standingsViews(context, appWidgetManager, appWidgetId, httpClient, credentials, target.fallback)
                    else -> unconfiguredViews(context, appWidgetId, "No open challenges — tap to pick one")
                }
            }
        }
    appWidgetManager.updateAppWidget(appWidgetId, views)
}

/** The race chart + leaderboard of [pick], or a status line when its standings can't be loaded. */
private suspend fun standingsViews(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    httpClient: HttpClient,
    credentials: CredentialsManager.Credentials,
    pick: ChallengePick,
): RemoteViews =
    when (val data = loadChallengeWidgetData(httpClient, credentials, pick.summary())) {
        is DataResult.Error -> {
            Log.w(TAG, "Widget $appWidgetId: ${data.message}")
            statusViews(context, appWidgetId, ChallengeWidgetConfig(pick.url, pick.name), credentials.serverUrl, data.message)
        }
        is DataResult.Success -> challengeViews(context, appWidgetManager, appWidgetId, credentials, data.data)
    }

/** The sizes the launcher may show this widget at (portrait/landscape), in dp. */
fun widgetSizes(appWidgetManager: AppWidgetManager, appWidgetId: Int): List<SizeF> {
    val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
    val sizes = options.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES, SizeF::class.java)
    if (!sizes.isNullOrEmpty()) return sizes.take(16)
    val minW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
    val minH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
    return listOf(SizeF(if (minW > 0) minW.toFloat() else 110f, if (minH > 0) minH.toFloat() else 110f))
}

private fun openChallengeIntent(
    context: Context,
    appWidgetId: Int,
    config: ChallengeWidgetConfig,
    serverUrl: String?,
): PendingIntent {
    val path = challengeDeepLinkPath(serverUrl, config.url)
    val intent =
        Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_OPEN_TAB, MainActivity.TAB_MORE)
            putExtra(MainActivity.EXTRA_MORE_PATH, path)
        }
    return PendingIntent.getActivity(
        context,
        appWidgetId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

private fun configureIntent(context: Context, appWidgetId: Int): PendingIntent {
    val intent =
        Intent(context, ChallengeWidgetConfigActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
        }
    return PendingIntent.getActivity(
        context,
        appWidgetId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

/**
 * The More-tab path the widget deep-links to: a site-relative `/u/<owner>/<slug>`
 * for a challenge on the user's own instance, or the absolute URL when the
 * challenge is hosted elsewhere (the embedded page then loads cross-instance).
 */
fun challengeDeepLinkPath(serverUrl: String?, challengeUrl: String): String {
    val parsed = parseChallengeUrl(challengeUrl) ?: return challengeUrl
    if (serverUrl != null && parsed.base.trimEnd('/') == serverUrl.trimEnd('/')) {
        return "/u/${parsed.username}/${parsed.slug}"
    }
    return challengeUrl
}

/** Nothing to show: [message] explains why, and a tap opens the picker. */
private fun unconfiguredViews(context: Context, appWidgetId: Int, message: String): RemoteViews =
    RemoteViews(context.packageName, R.layout.widget_challenge).apply {
        setTextViewText(R.id.challenge_title, "Challenge")
        setTextViewText(R.id.challenge_meta, "")
        setViewVisibility(R.id.challenge_body, View.GONE)
        setViewVisibility(R.id.challenge_status, View.VISIBLE)
        setTextViewText(R.id.challenge_status, message)
        setOnClickPendingIntent(R.id.widget_root, configureIntent(context, appWidgetId))
    }

/**
 * A challenge to join instead of one to follow: hosted by someone the user
 * follows, open, not yet joined. A tap opens its page, where the Join button is.
 */
private fun suggestionViews(
    context: Context,
    appWidgetId: Int,
    suggestion: DiscoveredChallenge,
    serverUrl: String,
    nowMillis: Long,
): RemoteViews =
    RemoteViews(context.packageName, R.layout.widget_challenge).apply {
        setTextViewText(R.id.challenge_title, "Join a challenge?")
        setTextViewText(
            R.id.challenge_meta,
            challengeMetaLine(
                suggestion.spec.unit,
                parseInstantMillis(suggestion.startTs),
                parseInstantMillis(suggestion.endTs),
                nowMillis,
            ),
        )
        setViewVisibility(R.id.challenge_body, View.GONE)
        setViewVisibility(R.id.challenge_status, View.VISIBLE)
        setTextViewText(R.id.challenge_status, challengeSuggestionText(suggestion.name, discoveredHostLabel(suggestion)))
        val target = ChallengeWidgetConfig(url = suggestion.shareUrl, name = suggestion.name)
        setOnClickPendingIntent(R.id.widget_root, openChallengeIntent(context, appWidgetId, target, serverUrl))
    }

private fun statusViews(
    context: Context,
    appWidgetId: Int,
    config: ChallengeWidgetConfig,
    serverUrl: String?,
    message: String,
): RemoteViews =
    RemoteViews(context.packageName, R.layout.widget_challenge).apply {
        setTextViewText(R.id.challenge_title, config.name.ifEmpty { "Challenge" })
        setTextViewText(R.id.challenge_meta, "")
        setViewVisibility(R.id.challenge_body, View.GONE)
        setViewVisibility(R.id.challenge_status, View.VISIBLE)
        setTextViewText(R.id.challenge_status, message)
        setOnClickPendingIntent(R.id.widget_root, openChallengeIntent(context, appWidgetId, config, serverUrl))
    }

/** One RemoteViews per launcher size (the launcher picks the closest), all sharing the same click. */
private fun challengeViews(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    credentials: CredentialsManager.Credentials,
    data: ChallengeWidgetData,
): RemoteViews {
    val config = ChallengeWidgetConfig(url = data.summary.url, name = data.summary.name)
    val click = openChallengeIntent(context, appWidgetId, config, credentials.serverUrl)
    val nowMillis = System.currentTimeMillis()
    val density = context.resources.displayMetrics.density
    val rows = leaderboard(data.standings, myIdentityUrl(credentials.serverUrl, credentials.username))
    // Over: final standings — medal the podium and say who won (and where you finished).
    val ended = nowMillis >= data.summary.endMillis
    val banner = challengeResultBanner(rows, ended, data.summary.unit)
    val bucketEnd = bucketEndFunction(data.effectiveBucketSize, data.summary.timezone, data.standings)
    val series =
        data.standings
            .filter { it.status == ChallengeStanding.Status.active }
            .mapIndexed { i, s -> cumulativeSeries(s, challengeMemberColor(i), data.summary.startMillis, bucketEnd) }

    val perSize =
        widgetSizes(appWidgetManager, appWidgetId).associateWith { size ->
            val layout = planChallengeWidgetLayout(size.width, size.height, rows.size, showResult = banner != null)
            RemoteViews(context.packageName, R.layout.widget_challenge).apply {
                setTextViewText(R.id.challenge_title, data.summary.name)
                setTextViewText(
                    R.id.challenge_meta,
                    challengeMetaLine(data.summary.unit, data.summary.startMillis, data.summary.endMillis, nowMillis),
                )
                setViewVisibility(R.id.challenge_status, View.GONE)
                setViewVisibility(R.id.challenge_body, View.VISIBLE)
                setViewVisibility(R.id.challenge_result, if (banner != null) View.VISIBLE else View.GONE)
                if (banner != null) {
                    setTextViewText(R.id.result_emoji, banner.emoji)
                    setTextViewText(R.id.result_headline, banner.headline)
                    setTextViewText(R.id.result_detail, banner.detail)
                }
                setViewVisibility(R.id.race_chart, if (layout.showChart) View.VISIBLE else View.GONE)
                if (layout.showChart) {
                    setImageViewBitmap(
                        R.id.race_chart,
                        drawRaceChart(
                            widthPx = (layout.chartWidthDp * density).toInt(),
                            heightPx = (layout.chartHeightDp * density).toInt(),
                            density = density,
                            series = series,
                            startMillis = data.summary.startMillis,
                            endMillis = data.summary.endMillis,
                        ),
                    )
                }
                removeAllViews(R.id.leaderboard)
                val visible = visibleRows(rows, layout.rowCount)
                setViewVisibility(
                    R.id.leaderboard_empty,
                    if (rows.isEmpty()) View.VISIBLE else View.GONE,
                )
                val substituted = hasSubstitutedMeRow(visible, rows)
                for (row in visible) addView(R.id.leaderboard, rowViews(context, row, layout.showRank, ended, substituted))
                setOnClickPendingIntent(R.id.widget_root, click)
            }
        }
    return if (perSize.size == 1) perSize.values.first() else RemoteViews(perSize)
}

private fun rowViews(
    context: Context,
    row: LeaderboardRow,
    showRank: Boolean,
    ended: Boolean,
    substituted: Boolean,
): RemoteViews =
    RemoteViews(context.packageName, R.layout.widget_challenge_row).apply {
        val rank = rankCellText(row, showRank, ended, substituted)
        setTextViewText(R.id.member_rank, rank ?: "")
        setViewVisibility(R.id.member_rank, if (rank != null) View.VISIBLE else View.GONE)
        setInt(R.id.member_color, "setColorFilter", row.color)
        val name: CharSequence =
            if (row.isMe) {
                SpannableString(row.name).apply {
                    setSpan(
                        StyleSpan(Typeface.BOLD),
                        0,
                        length,
                        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                    )
                }
            } else {
                row.name
            }
        setTextViewText(R.id.member_name, name)
        setTextViewText(R.id.member_total, formatChallengeTotal(row.total))
    }
