package net.aurboda

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Renders the structured sync progress: a "Syncing data updated N ago" hint, a stage list with
 * inline status icons, and per-record-type chunk progress nested under the Health Connect stage.
 */
@Composable
fun SyncProgressView(
  state: SyncProgressState,
  permissionStatusMessage: String,
  activityWatchEnabled: Boolean,
) {
  val visibleStages =
    SyncStage.entries.filter { stage ->
      stage in state.stages || (state.isRunning && stage.alwaysShownWhileRunning(activityWatchEnabled))
    }

  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    // "Syncing data updated 5 min ago" — only while running and only when we know the freshness of the in-flight batch.
    if (state.isRunning && state.currentDataInstant != null) {
      RelativeAgoText(state.currentDataInstant)
    } else if (!state.isRunning && state.lastError != null) {
      Text(
        "Last error: ${state.lastError}",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.error,
      )
    } else if (!state.isRunning && state.stages.isEmpty()) {
      Text(
        permissionStatusMessage,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }

    if (visibleStages.isNotEmpty()) {
      visibleStages.forEach { stage ->
        val info = state.stages[stage] ?: SyncStageInfo(stage)
        StageRow(info)
        if (stage == SyncStage.HealthConnect) {
          val activeTypes =
            state.recordTypes.values
              .filter { it.status != SyncStageStatus.Idle }
              .sortedWith(compareBy({ it.status.sortKey() }, { it.recordType }))
          activeTypes.forEach { rt ->
            RecordTypeRow(rt)
          }
        }
      }
    }
  }
}

@Composable
private fun StageRow(info: SyncStageInfo) {
  Column(modifier = Modifier.fillMaxWidth()) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(info.status.icon(), style = MaterialTheme.typography.bodyMedium, color = info.status.iconColor())
      Text(
        info.stage.title,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.SemiBold,
      )
      info.pageProgressLabel()?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    val sub = info.errorMessage ?: info.message
    if (!sub.isNullOrBlank()) {
      Text(
        sub,
        style = MaterialTheme.typography.bodySmall,
        color = if (info.errorMessage != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 24.dp),
      )
    }
  }
}

@Composable
private fun RecordTypeRow(info: SyncRecordTypeInfo) {
  Column(modifier = Modifier.fillMaxWidth().padding(start = 24.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(info.status.icon(), style = MaterialTheme.typography.bodySmall, color = info.status.iconColor())
      Text(info.recordType, style = MaterialTheme.typography.bodySmall)
      info.chunkLabel()?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      if (info.sentRecords > 0 && info.status == SyncStageStatus.Done) {
        Text(
          "(${info.sentRecords} records)",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
    if (info.status == SyncStageStatus.Active && info.totalChunks != null && info.currentChunk != null && info.totalChunks > 1) {
      LinearProgressIndicator(
        progress = { (info.currentChunk.toFloat() / info.totalChunks).coerceIn(0f, 1f) },
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp, horizontal = 0.dp),
      )
    }
    info.errorMessage?.let {
      Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
  }
}

@Composable
private fun RelativeAgoText(target: Instant) {
  // Re-render every 30s so "5m ago" stays accurate without a tight loop.
  var now by remember { mutableStateOf(Instant.now()) }
  LaunchedEffect(target) {
    while (true) {
      now = Instant.now()
      delay(30_000)
    }
  }
  Text(
    "Syncing data updated ${formatRelative(target, now)}",
    style = MaterialTheme.typography.bodyMedium,
    fontWeight = FontWeight.Medium,
    color = MaterialTheme.colorScheme.primary,
    modifier = Modifier.padding(PaddingValues(0.dp)),
  )
}

private fun formatRelative(target: Instant, now: Instant): String {
  val seconds = ChronoUnit.SECONDS.between(target, now).coerceAtLeast(0)
  return when {
    seconds < 60 -> "just now"
    seconds < 3600 -> "${seconds / 60} min ago"
    seconds < 86_400 -> "${seconds / 3600}h ago"
    seconds < 86_400 * 2 -> "yesterday"
    else -> "${seconds / 86_400} days ago"
  }
}

@Composable
fun BackgroundSyncStatusRow(status: BackgroundSyncStatus) {
  // 30s tick keeps "ago" labels fresh.
  var now by remember { mutableStateOf(Instant.now()) }
  LaunchedEffect(status.lastAttempt, status.lastSuccess) {
    while (true) {
      now = Instant.now()
      delay(30_000)
    }
  }

  val attempt = status.lastAttempt
  if (attempt == null) {
    Text(
      "Background sync: not yet run",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    return
  }

  val durationLabel = status.lastDurationMs?.let { ms ->
    when {
      ms < 1000 -> "${ms}ms"
      ms < 60_000 -> "${ms / 1000}s"
      else -> "${ms / 60_000}m ${(ms % 60_000) / 1000}s"
    }
  }

  val outcomeLabel = when (status.lastResult) {
    BackgroundSyncResult.Success -> "success"
    BackgroundSyncResult.Retry -> "retry pending"
    BackgroundSyncResult.Skipped -> "skipped"
    null -> "running…"
  }

  val color = when (status.lastResult) {
    BackgroundSyncResult.Retry -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
  }

  val attemptText = "Background sync: ${formatRelative(attempt, now)} ($outcomeLabel${if (durationLabel != null) ", $durationLabel" else ""})"

  Column {
    Text(
      attemptText,
      style = MaterialTheme.typography.bodySmall,
      color = color,
    )
    val success = status.lastSuccess
    if (success != null && status.lastResult != BackgroundSyncResult.Success) {
      Text(
        "Last successful run: ${formatRelative(success, now)}",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
    val error = status.lastError
    if (error != null && status.lastResult != BackgroundSyncResult.Success) {
      Text(
        "Last error: $error",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.error,
      )
    }
  }
}

private fun SyncStageStatus.icon(): String =
  when (this) {
    SyncStageStatus.Idle -> "…" // …
    SyncStageStatus.Active -> "⟳" // ⟳
    SyncStageStatus.Done -> "✅" // ✅
    SyncStageStatus.Failed -> "⚠️" // ⚠️
    SyncStageStatus.Skipped -> "➖" // ➖
  }

@Composable
private fun SyncStageStatus.iconColor(): Color =
  when (this) {
    SyncStageStatus.Failed -> MaterialTheme.colorScheme.error
    SyncStageStatus.Active -> MaterialTheme.colorScheme.primary
    else -> MaterialTheme.colorScheme.onSurface
  }

private fun SyncStageStatus.sortKey(): Int =
  when (this) {
    SyncStageStatus.Active -> 0
    SyncStageStatus.Failed -> 1
    SyncStageStatus.Done -> 2
    SyncStageStatus.Skipped -> 3
    SyncStageStatus.Idle -> 4
  }

private fun SyncStageInfo.pageProgressLabel(): String? {
  val cur = currentPage ?: return null
  val total = totalPages
  return if (total != null && total >= cur) "page $cur / $total" else "page $cur"
}

private fun SyncRecordTypeInfo.chunkLabel(): String? {
  val cur = currentChunk ?: return null
  val total = totalChunks ?: return null
  if (total <= 1) return null
  return "chunk $cur / $total"
}

private fun SyncStage.alwaysShownWhileRunning(activityWatchEnabled: Boolean): Boolean =
  when (this) {
    SyncStage.PendingData, SyncStage.DailyAggregates, SyncStage.HealthConnect, SyncStage.Outbound -> true
    SyncStage.ActivityWatch -> activityWatchEnabled
  }
