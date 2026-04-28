package net.aurboda

import android.content.Context
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BasalBodyTemperatureRecord
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.BodyTemperatureRecord
import androidx.health.connect.client.records.BodyWaterMassRecord
import androidx.health.connect.client.records.BoneMassRecord
import androidx.health.connect.client.records.CervicalMucusRecord
import androidx.health.connect.client.records.CyclingPedalingCadenceRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ElevationGainedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.HeightRecord
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.IntermenstrualBleedingRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.MenstruationFlowRecord
import androidx.health.connect.client.records.MenstruationPeriodRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.OvulationTestRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.PowerRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SexualActivityRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.SpeedRecord
import androidx.health.connect.client.records.StepsCadenceRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.WheelchairPushesRecord
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
  /** Timestamp of the data currently in flight; powers the "Syncing data from N days ago" hint. */
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

  /** Report the timestamp of the data currently being processed (drives "from N days ago"). */
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
 * Extract a representative timestamp from a Health Connect record.
 * The HC base interfaces (IntervalRecord/InstantaneousRecord) are internal in 1.2.0-alpha01,
 * so we dispatch on the concrete classes we actually serialize.
 */
fun Record.eventInstant(): Instant? =
  when (this) {
    is ActiveCaloriesBurnedRecord -> startTime
    is BasalBodyTemperatureRecord -> time
    is BasalMetabolicRateRecord -> time
    is BloodGlucoseRecord -> time
    is BloodPressureRecord -> time
    is BodyFatRecord -> time
    is BodyTemperatureRecord -> time
    is BodyWaterMassRecord -> time
    is BoneMassRecord -> time
    is CervicalMucusRecord -> time
    is CyclingPedalingCadenceRecord -> startTime
    is DistanceRecord -> startTime
    is ElevationGainedRecord -> startTime
    is ExerciseSessionRecord -> startTime
    is FloorsClimbedRecord -> startTime
    is HeartRateRecord -> startTime
    is HeartRateVariabilityRmssdRecord -> time
    is HeightRecord -> time
    is HydrationRecord -> startTime
    is IntermenstrualBleedingRecord -> time
    is LeanBodyMassRecord -> time
    is MenstruationFlowRecord -> time
    is MenstruationPeriodRecord -> startTime
    is NutritionRecord -> startTime
    is OvulationTestRecord -> time
    is OxygenSaturationRecord -> time
    is PowerRecord -> startTime
    is RespiratoryRateRecord -> time
    is RestingHeartRateRecord -> time
    is SexualActivityRecord -> time
    is SleepSessionRecord -> startTime
    is SpeedRecord -> startTime
    is StepsCadenceRecord -> startTime
    is StepsRecord -> startTime
    is TotalCaloriesBurnedRecord -> startTime
    is Vo2MaxRecord -> time
    is WeightRecord -> time
    is WheelchairPushesRecord -> startTime
    else -> null
  }

/** Earliest [eventInstant] across a record list, or null when no record exposes one. */
fun List<Record>.oldestEventInstant(): Instant? = mapNotNull { it.eventInstant() }.minOrNull()
