package net.aurboda

import android.content.Context
import androidx.health.connect.client.records.Record
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.time.Instant

enum class SyncStageStatus { Idle, Active, Done, Failed, Skipped }

/** High-level sync stages, displayed as one row each in the UI. */
enum class SyncStage(
  val title: String,
) {
  PendingData("Pending uploads"),
  DailyAggregates("Daily aggregates"),
  HealthConnect("Health Connect data"),
  Outbound("Write back to Health Connect"),
  ActivityWatch("ActivityWatch"),
}

data class SyncStageInfo(
  val stage: SyncStage,
  val status: SyncStageStatus = SyncStageStatus.Idle,
  val message: String? = null,
  val sentRecords: Int = 0,
  val sentDeletions: Int = 0,
  val currentPage: Int? = null,
  val totalPages: Int? = null,
  val errorMessage: String? = null,
)

/** Per-record-type progress nested under [SyncStage.HealthConnect]. */
data class SyncRecordTypeInfo(
  val recordType: String,
  val status: SyncStageStatus = SyncStageStatus.Idle,
  val sentRecords: Int = 0,
  val currentChunk: Int? = null,
  val totalChunks: Int? = null,
  val errorMessage: String? = null,
)

data class SyncProgressState(
  val isRunning: Boolean = false,
  val startedAt: Instant? = null,
  val finishedAt: Instant? = null,
  val stages: Map<SyncStage, SyncStageInfo> = emptyMap(),
  val recordTypes: Map<String, SyncRecordTypeInfo> = emptyMap(),
  /**
   * Oldest `lastModifiedTime` among records currently in flight; powers the
   * "Syncing data updated N ago" hint, i.e. how stale this batch is.
   */
  val currentDataInstant: Instant? = null,
  val lastError: String? = null,
)

/**
 * Sync workers and UI talk to this single state object. Default and no-op implementations
 * are provided; production code uses [DefaultSyncProgressReporter] held on the Application.
 */
interface SyncProgressReporter {
  val state: StateFlow<SyncProgressState>

  fun begin()

  fun end(error: String? = null)

  fun updateStage(
    stage: SyncStage,
    transform: (SyncStageInfo) -> SyncStageInfo,
  )

  fun updateRecordType(
    recordType: String,
    transform: (SyncRecordTypeInfo) -> SyncRecordTypeInfo,
  )

  /** Report the oldest `lastModifiedTime` of records being processed (drives "updated N ago"). */
  fun reportDataInstant(time: Instant?)
}

class DefaultSyncProgressReporter : SyncProgressReporter {
  private val mutableState = MutableStateFlow(SyncProgressState())
  override val state: StateFlow<SyncProgressState> = mutableState.asStateFlow()

  override fun begin() {
    mutableState.update {
      SyncProgressState(
        isRunning = true,
        startedAt = Instant.now(),
      )
    }
  }

  override fun end(error: String?) {
    mutableState.update {
      it.copy(
        isRunning = false,
        finishedAt = Instant.now(),
        lastError = error ?: it.lastError,
      )
    }
  }

  override fun updateStage(
    stage: SyncStage,
    transform: (SyncStageInfo) -> SyncStageInfo,
  ) {
    mutableState.update { current ->
      val existing = current.stages[stage] ?: SyncStageInfo(stage)
      current.copy(stages = current.stages + (stage to transform(existing)))
    }
  }

  override fun updateRecordType(
    recordType: String,
    transform: (SyncRecordTypeInfo) -> SyncRecordTypeInfo,
  ) {
    mutableState.update { current ->
      val existing = current.recordTypes[recordType] ?: SyncRecordTypeInfo(recordType)
      current.copy(recordTypes = current.recordTypes + (recordType to transform(existing)))
    }
  }

  override fun reportDataInstant(time: Instant?) {
    if (time == null) return
    mutableState.update { it.copy(currentDataInstant = time) }
  }
}

/** No-op for tests and code paths where progress reporting is irrelevant. */
object NoOpSyncProgressReporter : SyncProgressReporter {
  override val state: StateFlow<SyncProgressState> = MutableStateFlow(SyncProgressState()).asStateFlow()

  override fun begin() {}

  override fun end(error: String?) {}

  override fun updateStage(
    stage: SyncStage,
    transform: (SyncStageInfo) -> SyncStageInfo,
  ) {}

  override fun updateRecordType(
    recordType: String,
    transform: (SyncRecordTypeInfo) -> SyncRecordTypeInfo,
  ) {}

  override fun reportDataInstant(time: Instant?) {}
}

/** Fetch the process-wide [SyncProgressReporter] held on the Application instance. */
fun Context.syncProgressReporter(): SyncProgressReporter =
  (applicationContext as? AurbodaApplication)?.syncProgress ?: NoOpSyncProgressReporter

/**
 * Earliest Health Connect `lastModifiedTime` across a record list. Drives the
 * "Syncing data updated N ago" hint — i.e. how stale the freshest record we're
 * about to upload looks against wall-clock now. Using lastModifiedTime instead
 * of the record's event time means a sleep session that started 8h ago but was
 * just written by the source app shows as "minutes ago", not "hours ago".
 */
fun List<Record>.oldestModifiedTime(): Instant? = minOfOrNull { it.metadata.lastModifiedTime }
