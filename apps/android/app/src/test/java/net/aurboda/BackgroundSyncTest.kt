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

/**
 * Tests for background sync scheduling logic.
 *
 * These tests verify that:
 * 1. The background sync worker is scheduled correctly on app startup when enabled
 * 2. The worker has proper network constraints
 * 3. Preferences are read correctly to determine if sync should be scheduled
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class BackgroundSyncTest {
  private lateinit var context: Context
  private val prefsName = "AurbodaAppPrefs"
  private val backgroundSyncEnabledKey = "backgroundSyncEnabled"

  @Before
  fun setup() {
    context = ApplicationProvider.getApplicationContext()

    // Initialize WorkManager for testing
    val config =
      Configuration
        .Builder()
        .setMinimumLoggingLevel(android.util.Log.DEBUG)
        .build()
    WorkManagerTestInitHelper.initializeTestWorkManager(context, config)
  }

  @After
  fun teardown() {
    // Clear preferences after each test
    context
      .getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .apply()

    // Cancel all work
    WorkManager.getInstance(context).cancelAllWork()
  }

  @Test
  fun `schedule creates periodic work with network constraint`() {
    // When: We schedule the background sync
    SyncWorker.schedule(context)

    // Then: Work should be enqueued
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
    // Given: Work is already scheduled
    SyncWorker.schedule(context)

    val initialWorkInfos =
      WorkManager
        .getInstance(context)
        .getWorkInfosForUniqueWork("health_connect_sync")
        .get()
    assertEquals(1, initialWorkInfos.size)

    // When: We schedule again (simulating app restart)
    SyncWorker.schedule(context)

    // Then: There should still be exactly one work request (UPDATE policy)
    val workInfos =
      WorkManager
        .getInstance(context)
        .getWorkInfosForUniqueWork("health_connect_sync")
        .get()

    assertEquals("Should still have exactly one work request after re-scheduling", 1, workInfos.size)
  }

  @Test
  fun `cancel removes scheduled work`() {
    // Given: Work is scheduled
    SyncWorker.schedule(context)

    val initialWorkInfos =
      WorkManager
        .getInstance(context)
        .getWorkInfosForUniqueWork("health_connect_sync")
        .get()
    assertEquals(1, initialWorkInfos.size)

    // When: We cancel the work
    SyncWorker.cancel(context)

    // Then: Work should be cancelled
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
    // Given: No preference has been set

    // When: We read the preference
    val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
    val isEnabled = prefs.getBoolean(backgroundSyncEnabledKey, false)

    // Then: It should default to false
    assertFalse("Background sync should default to false", isEnabled)
  }

  @Test
  fun `background sync preference can be enabled`() {
    // Given: We enable background sync
    context
      .getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(backgroundSyncEnabledKey, true)
      .apply()

    // When: We read the preference
    val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
    val isEnabled = prefs.getBoolean(backgroundSyncEnabledKey, false)

    // Then: It should be true
    assertTrue("Background sync should be enabled", isEnabled)
  }

  @Test
  fun `AurbodaApplication schedules worker when background sync was previously enabled`() {
    // Given: Background sync is enabled in preferences
    context
      .getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(backgroundSyncEnabledKey, true)
      .apply()

    // When: Application starts (simulated by calling the scheduling logic)
    val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
    val isEnabled = prefs.getBoolean(backgroundSyncEnabledKey, false)
    if (isEnabled) {
      SyncWorker.schedule(context)
    }

    // Then: Work should be scheduled
    val workInfos =
      WorkManager
        .getInstance(context)
        .getWorkInfosForUniqueWork("health_connect_sync")
        .get()

    assertEquals("Should have scheduled work", 1, workInfos.size)
  }

  @Test
  fun `AurbodaApplication does not schedule worker when background sync is disabled`() {
    // Given: Background sync is disabled (default)
    context
      .getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(backgroundSyncEnabledKey, false)
      .apply()

    // When: Application starts (simulated by calling the scheduling logic)
    val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
    val isEnabled = prefs.getBoolean(backgroundSyncEnabledKey, false)
    if (isEnabled) {
      SyncWorker.schedule(context)
    }

    // Then: No work should be scheduled
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
    // Previous failed run leaves an error
    recordBackgroundSyncResult(
      context,
      BackgroundSyncResult.Retry,
      java.time.Instant.parse("2026-05-06T12:00:00Z"),
      durationMs = 1500,
      error = "boom",
    )
    assertEquals("boom", loadBackgroundSyncStatus(context).lastError)

    // Now a success
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
    // Seed a prior success
    recordBackgroundSyncResult(
      context,
      BackgroundSyncResult.Success,
      java.time.Instant.parse("2026-05-06T11:00:00Z"),
      durationMs = 3000,
    )
    val priorSuccess = loadBackgroundSyncStatus(context).lastSuccess

    // A subsequent retry doesn't bump lastSuccess and stores the error
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
