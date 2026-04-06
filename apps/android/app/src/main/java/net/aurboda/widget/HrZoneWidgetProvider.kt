package net.aurboda.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.widget.RemoteViews
import net.aurboda.MainActivity
import net.aurboda.R

private const val TAG = "HrZoneWidgetProvider"

class HrZoneWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    Log.d(TAG, "onUpdate called for ${appWidgetIds.size} widgets")
    for (appWidgetId in appWidgetIds) {
      updateWidget(context, appWidgetManager, appWidgetId)
    }
  }

  override fun onReceive(
    context: Context,
    intent: Intent,
  ) {
    super.onReceive(context, intent)
    if (intent.action == ACTION_UPDATE_WIDGETS) {
      Log.d(TAG, "Received update broadcast")
      val appWidgetManager = AppWidgetManager.getInstance(context)
      val componentName = ComponentName(context, HrZoneWidgetProvider::class.java)
      val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)

      // Notify the ListView adapter to refresh data
      @Suppress("DEPRECATION")
      appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.goals_list)
    }
  }

  private fun updateWidget(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
  ) {
    val views = RemoteViews(context.packageName, R.layout.widget_hr_zones)

    // Set up click handler to open the app on the Data tab
    val openAppIntent =
      Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra(MainActivity.EXTRA_OPEN_TAB, MainActivity.TAB_DATA)
      }
    val pendingIntent =
      PendingIntent.getActivity(
        context,
        appWidgetId,
        openAppIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    views.setPendingIntentTemplate(R.id.goals_list, pendingIntent)
    views.setOnClickPendingIntent(R.id.widget_container, pendingIntent)

    // Set up the RemoteViews adapter for the ListView
    val serviceIntent =
      Intent(context, GoalsWidgetService::class.java).apply {
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
        // Unique data URI to ensure fresh adapter per widget
        data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
      }
    @Suppress("DEPRECATION")
    views.setRemoteAdapter(R.id.goals_list, serviceIntent)

    // Set empty view
    views.setEmptyView(R.id.goals_list, R.id.empty_view)

    appWidgetManager.updateAppWidget(appWidgetId, views)

    // Trigger data refresh
    @Suppress("DEPRECATION")
    appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.goals_list)
  }

  companion object {
    const val ACTION_UPDATE_WIDGETS = "net.aurboda.ACTION_UPDATE_HR_ZONE_WIDGETS"

    /**
     * Trigger an update of all HR Zone widgets.
     * Call this after background sync completes.
     */
    fun triggerUpdate(context: Context) {
      val intent =
        Intent(context, HrZoneWidgetProvider::class.java).apply {
          action = ACTION_UPDATE_WIDGETS
        }
      context.sendBroadcast(intent)
    }
  }
}
