package net.aurboda

import android.app.Application
import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow

private const val TAG = "AurbodaApplication"
private const val PREFS_NAME = "AurbodaAppPrefs"
private const val BACKGROUND_SYNC_ENABLED_KEY = "backgroundSyncEnabled"

class AurbodaApplication : Application() {
  val syncProgress: SyncProgressReporter = DefaultSyncProgressReporter()
  val backgroundSyncStatus: MutableStateFlow<BackgroundSyncStatus> = MutableStateFlow(BackgroundSyncStatus())

  override fun onCreate() {
    super.onCreate()

    backgroundSyncStatus.value = loadBackgroundSyncStatus(this)

    // Schedule background sync if it was previously enabled
    // This ensures sync continues after app restarts, device reboots, etc.
    if (isBackgroundSyncEnabled(this)) {
      Log.d(TAG, "Background sync was previously enabled, scheduling worker")
      SyncWorker.schedule(this)
    } else {
      Log.d(TAG, "Background sync is not enabled")
    }
  }

  private fun isBackgroundSyncEnabled(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getBoolean(BACKGROUND_SYNC_ENABLED_KEY, false)
  }
}
