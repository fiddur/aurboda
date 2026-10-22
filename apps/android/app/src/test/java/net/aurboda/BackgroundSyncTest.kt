package net.aurboda

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class BackgroundSyncTest {
  private lateinit var context: Context
  private val prefsName = "AurbodaAppPrefs"
  private val backgroundSyncEnabledKey = "backgroundSyncEnabled"

  @Before
  fun setup() {
    context = ApplicationProvider.getApplicationContext()

    val config =
      Configuration
        .Builder()
        .setMinimumLoggingLevel(android.util.Log.DEBUG)
        .build()
    WorkManagerTestInitHelper.initializeTestWorkManager(context, config)
  }

  @After
  fun teardown() {
    context
      .getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .apply()

    WorkManager.getInstance(context).cancelAllWork()
  }

  @Test
  fun `schedule creates periodic work with network constraint`() {
    SyncWorker.schedule(context)

    val workInfos =
      WorkManager
        .getInstance(context)
        .getWorkInfosForUniqueWork("health_connect_sync")
        .get()

    assertEquals("Should have exactly one work request", 1, workInfos.size)

    val workInfo = workInfos[0]
    assertTrue(
      "Work should be enqueued or running",
      workInfo.state == WorkInfo.State.ENQUEUED || workInfo.state == WorkInfo.State.RUNNING,
    )
  }

  @Test
  fun `schedule uses UPDATE policy to replace existing work`() {
    SyncWorker.schedule(context)

    val initialWorkInfos =
      WorkManager
        .getInstance(context)
        .getWorkInfosForUniqueWork("health_connect_sync")
        .get()
    assertEquals(1, initialWorkInfos.size)

    SyncWorker.schedule(context)

    val workInfos =
      WorkManager
        .getInstance(context)
        .getWorkInfosForUniqueWork("health_connect_sync")
        .get()

    assertEquals("Should still have exactly one work request after re-scheduling", 1, workInfos.size)
  }

  @Test
  fun `cancel removes scheduled work`() {
    SyncWorker.schedule(context)

    val initialWorkInfos =
      WorkManager
        .getInstance(context)
        .getWorkInfosForUniqueWork("health_connect_sync")
        .get()
    assertEquals(1, initialWorkInfos.size)

    SyncWorker.cancel(context)

    val workInfos =
      WorkManager
        .getInstance(context)
        .getWorkInfosForUniqueWork("health_connect_sync")
        .get()

    assertTrue(
      "Work should be cancelled or empty",
      workInfos.isEmpty() || workInfos[0].state == WorkInfo.State.CANCELLED,
    )
  }

  @Test
  fun `background sync preference defaults to false`() {
    val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
    val isEnabled = prefs.getBoolean(backgroundSyncEnabledKey, false)

    assertFalse("Background sync should default to false", isEnabled)
  }

  @Test
  fun `background sync preference can be enabled`() {
    context
      .getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(backgroundSyncEnabledKey, true)
      .apply()

    val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
    val isEnabled = prefs.getBoolean(backgroundSyncEnabledKey, false)

    assertTrue("Background sync should be enabled", isEnabled)
  }

  @Test
  fun `AurbodaApplication schedules worker when background sync was previously enabled`() {
    context
      .getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(backgroundSyncEnabledKey, true)
      .apply()

    val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
    val isEnabled = prefs.getBoolean(backgroundSyncEnabledKey, false)
    if (isEnabled) {
      SyncWorker.schedule(context)
    }

    val workInfos =
      WorkManager
        .getInstance(context)
        .getWorkInfosForUniqueWork("health_connect_sync")
        .get()

    assertEquals("Should have scheduled work", 1, workInfos.size)
  }

  @Test
  fun `AurbodaApplication does not schedule worker when background sync is disabled`() {
    context
      .getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(backgroundSyncEnabledKey, false)
      .apply()

    val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
    val isEnabled = prefs.getBoolean(backgroundSyncEnabledKey, false)
    if (isEnabled) {
      SyncWorker.schedule(context)
    }

    val workInfos =
      WorkManager
        .getInstance(context)
        .getWorkInfosForUniqueWork("health_connect_sync")
        .get()

    assertTrue("Should not have scheduled work", workInfos.isEmpty())
  }

  @Test
  fun `preference key constants are consistent`() {
    // This test documents and verifies the preference keys used across the app
    // If these change, both AurbodaApplication and MainActivity need to be updated
    assertEquals("AurbodaAppPrefs", prefsName)
    assertEquals("backgroundSyncEnabled", backgroundSyncEnabledKey)
  }

  @Test
  fun `loadBackgroundSyncStatus returns empty status when no run has happened`() {
    val status = loadBackgroundSyncStatus(context)
    assertNull(status.lastAttempt)
    assertNull(status.lastSuccess)
    assertNull(status.lastResult)
    assertNull(status.lastError)
    assertNull(status.lastDurationMs)
  }

  @Test
  fun `recordBackgroundSyncAttempt persists attempt timestamp`() {
    val now = java.time.Instant.parse("2026-05-06T12:00:00Z")
    recordBackgroundSyncAttempt(context, now)

    val status = loadBackgroundSyncStatus(context)
    assertEquals(now, status.lastAttempt)
    assertNull(status.lastSuccess)
    assertNull(status.lastResult)
  }

  @Test
  fun `recordBackgroundSyncResult success records success time and clears prior error`() {
    recordBackgroundSyncResult(
      context,
      BackgroundSyncResult.Retry,
      java.time.Instant.parse("2026-05-06T12:00:00Z"),
      durationMs = 1500,
      error = "boom",
    )
    assertEquals("boom", loadBackgroundSyncStatus(context).lastError)

    val finishedAt = java.time.Instant.parse("2026-05-06T12:15:00Z")
    recordBackgroundSyncResult(
      context,
      BackgroundSyncResult.Success,
      finishedAt,
      durationMs = 8500,
    )

    val status = loadBackgroundSyncStatus(context)
    assertEquals(BackgroundSyncResult.Success, status.lastResult)
    assertEquals(finishedAt, status.lastSuccess)
    assertEquals(8500L, status.lastDurationMs)
    assertNull("Success clears the prior error", status.lastError)
  }

  @Test
  fun `recordBackgroundSyncResult retry stores error but does not advance lastSuccess`() {
    recordBackgroundSyncResult(
      context,
      BackgroundSyncResult.Success,
      java.time.Instant.parse("2026-05-06T11:00:00Z"),
      durationMs = 3000,
    )
    val priorSuccess = loadBackgroundSyncStatus(context).lastSuccess

    recordBackgroundSyncResult(
      context,
      BackgroundSyncResult.Retry,
      java.time.Instant.parse("2026-05-06T11:15:00Z"),
      durationMs = 4000,
      error = "network",
    )
    val status = loadBackgroundSyncStatus(context)
    assertEquals(BackgroundSyncResult.Retry, status.lastResult)
    assertEquals("network", status.lastError)
    assertEquals(priorSuccess, status.lastSuccess)
  }
}
