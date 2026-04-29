package net.aurboda

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
import androidx.health.connect.client.records.ExerciseLap
import androidx.health.connect.client.records.ExerciseRoute
import androidx.health.connect.client.records.ExerciseRouteResult
import androidx.health.connect.client.records.ExerciseSegment
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
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.WheelchairPushesRecord
import androidx.health.connect.client.records.metadata.Metadata
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.reflect.KClass

// Global JSON configuration instance
val appJson =
  Json {
    prettyPrint = true
    isLenient = true
    ignoreUnknownKeys = true
    encodeDefaults = true // Important if you have default values and want them in the JSON
    explicitNulls = false // Omit null fields from JSON; null means "not provided", not "set to null"
  }

// Generic wrapper for POST requests
@Serializable
data class PostWrapper<T>(
  val data: List<T>,
)

// --- Base Metadata and Device for Serializable Records ---
@Serializable
data class DeviceSerializable(
  val manufacturer: String?,
  val model: String?,
  val type: Int,
)

@Serializable
data class HealthConnectRecordMetadata(
  val id: String,
  val dataOrigin: String, // package name
  val lastModifiedTime: String,
  val clientRecordId: String?,
  val clientRecordVersion: Long,
  val device: DeviceSerializable?,
  val recordingMethod: Int,
)

// --- Active Calories Burned Record ---
@Serializable
data class ActiveCaloriesBurnedRecordSerializable(
  val startTime: String,
  val endTime: String,
  val energyInKilocalories: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<ActiveCaloriesBurnedRecordSerializable> =
      classRecords.filterIsInstance<ActiveCaloriesBurnedRecord>().map { record ->
        ActiveCaloriesBurnedRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          energyInKilocalories = record.energy.inKilocalories,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Body Fat Record ---
@Serializable
data class BodyFatRecordSerializable(
  val time: String,
  val percentage: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<BodyFatRecordSerializable> =
      classRecords.filterIsInstance<BodyFatRecord>().map { record ->
        BodyFatRecordSerializable(
          time = record.time.toIsoString(),
          percentage = record.percentage.value, // androidx.health.connect.client.units.Percentage.value is Double
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Body Water Mass Record ---
@Serializable
data class BodyWaterMassRecordSerializable(
  val time: String,
  val massInKilograms: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<BodyWaterMassRecordSerializable> =
      classRecords.filterIsInstance<BodyWaterMassRecord>().map { record ->
        BodyWaterMassRecordSerializable(
          time = record.time.toIsoString(),
          massInKilograms = record.mass.inKilograms,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Bone Mass Record ---
@Serializable
data class BoneMassRecordSerializable(
  val time: String,
  val massInKilograms: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<BoneMassRecordSerializable> =
      classRecords.filterIsInstance<BoneMassRecord>().map { record ->
        BoneMassRecordSerializable(
          time = record.time.toIsoString(),
          massInKilograms = record.mass.inKilograms,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Distance Record ---
@Serializable
data class DistanceRecordSerializable(
  val startTime: String,
  val endTime: String,
  val distanceInMeters: Double?,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<DistanceRecordSerializable> =
      classRecords.filterIsInstance<DistanceRecord>().map { record ->
        DistanceRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          distanceInMeters = record.distance.inMeters,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Exercise Session Record Helpers ---
@Serializable
data class ExerciseSegmentSerializable(
  val startTime: String,
  val endTime: String,
  val segmentType: Int,
  // val weightInKilograms: Double? = null, // Add if using a library version that supports segment.weight
)

@Serializable
data class ExerciseLapSerializable(
  val startTime: String,
  val endTime: String,
  val lengthInMeters: Double?,
)

@Serializable
data class ExerciseRouteLocationSerializable(
  val time: String,
  val latitude: Double,
  val longitude: Double,
  val horizontalAccuracyInMeters: Double?,
  val verticalAccuracyInMeters: Double?,
  val altitudeInMeters: Double?,
)

@Serializable
data class ExerciseRouteSerializable(
  val route: List<ExerciseRouteLocationSerializable>,
)

// --- Exercise Session Record ---
@Serializable
data class ExerciseSessionRecordSerializable(
  val startTime: String,
  val endTime: String,
  val exerciseType: Int,
  val title: String?,
  val notes: String?,
  val segments: List<ExerciseSegmentSerializable>? = null,
  val laps: List<ExerciseLapSerializable>? = null,
  val route: ExerciseRouteSerializable? = null,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<ExerciseSessionRecordSerializable> =
      classRecords.filterIsInstance<ExerciseSessionRecord>().map { record: ExerciseSessionRecord ->
        ExerciseSessionRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          exerciseType = record.exerciseType,
          title = record.title,
          notes = record.notes,
          segments =
            record.segments
              .map { segment: ExerciseSegment ->
                ExerciseSegmentSerializable(
                  startTime = segment.startTime.toIsoString(),
                  endTime = segment.endTime.toIsoString(),
                  segmentType = segment.segmentType,
                  // weightInKilograms = if (segment.weight != null) segment.weight!!.inKilograms else null // Enable if segment.weight is available
                )
              }.takeIf { it.isNotEmpty() },
          laps =
            record.laps
              .map { lap: ExerciseLap ->
                ExerciseLapSerializable(
                  startTime = lap.startTime.toIsoString(),
                  endTime = lap.endTime.toIsoString(),
                  lengthInMeters = lap.length?.inMeters,
                )
              }.takeIf { it.isNotEmpty() },
          route =
            if (record.exerciseRouteResult is ExerciseRouteResult.Data) {
              (record.exerciseRouteResult as ExerciseRouteResult.Data).exerciseRoute.let { sdkExerciseRoute: ExerciseRoute ->
                ExerciseRouteSerializable(
                  route =
                    sdkExerciseRoute.route.map { sdkLocation: ExerciseRoute.Location ->
                      ExerciseRouteLocationSerializable(
                        time = sdkLocation.time.toIsoString(),
                        latitude = sdkLocation.latitude,
                        longitude = sdkLocation.longitude,
                        horizontalAccuracyInMeters = sdkLocation.horizontalAccuracy?.inMeters,
                        verticalAccuracyInMeters = sdkLocation.verticalAccuracy?.inMeters,
                        altitudeInMeters = sdkLocation.altitude?.inMeters,
                      )
                    },
                )
              }
            } else {
              null
            },
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Heart Rate Record Helpers ---
@Serializable
data class HeartRateSampleSerializable(
  val time: String,
  val beatsPerMinute: Long,
)

// --- Heart Rate Record ---
@Serializable
data class HeartRateRecordSerializable(
  val startTime: String,
  val endTime: String,
  val samples: List<HeartRateSampleSerializable>,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<HeartRateRecordSerializable> =
      classRecords.filterIsInstance<HeartRateRecord>().map { record ->
        HeartRateRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          samples =
            record.samples.map {
              HeartRateSampleSerializable(
                time = it.time.toIsoString(),
                beatsPerMinute = it.beatsPerMinute,
              )
            },
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Heart Rate Variability Record ---
@Serializable
data class HrvRecordSerializable(
  val time: String,
  val heartRateVariabilityMillis: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<HrvRecordSerializable> =
      classRecords.filterIsInstance<HeartRateVariabilityRmssdRecord>().map { record ->
        HrvRecordSerializable(
          time = record.time.toIsoString(),
          heartRateVariabilityMillis = record.heartRateVariabilityMillis,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Lean Body Mass Record ---
@Serializable
data class LeanBodyMassRecordSerializable(
  val time: String,
  val massInKilograms: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<LeanBodyMassRecordSerializable> =
      classRecords.filterIsInstance<LeanBodyMassRecord>().map { record ->
        LeanBodyMassRecordSerializable(
          time = record.time.toIsoString(),
          massInKilograms = record.mass.inKilograms,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Nutrition Record ---
@Serializable
data class NutritionRecordSerializable(
  val startTime: String,
  val endTime: String,
  val biotinInGrams: Double? = null,
  val caffeineInGrams: Double? = null,
  val calciumInGrams: Double? = null,
  val energyInKilocalories: Double? = null,
  val energyFromFatInKilocalories: Double? = null,
  val chlorideInGrams: Double? = null,
  val cholesterolInGrams: Double? = null,
  val chromiumInGrams: Double? = null,
  val copperInGrams: Double? = null,
  val dietaryFiberInGrams: Double? = null,
  val folateInGrams: Double? = null,
  val folicAcidInGrams: Double? = null,
  val iodineInGrams: Double? = null,
  val ironInGrams: Double? = null,
  val magnesiumInGrams: Double? = null,
  val manganeseInGrams: Double? = null,
  val molybdenumInGrams: Double? = null,
  val monounsaturatedFatInGrams: Double? = null,
  val niacinInGrams: Double? = null,
  val pantothenicAcidInGrams: Double? = null,
  val phosphorusInGrams: Double? = null,
  val polyunsaturatedFatInGrams: Double? = null,
  val potassiumInGrams: Double? = null,
  val proteinInGrams: Double? = null,
  val riboflavinInGrams: Double? = null,
  val saturatedFatInGrams: Double? = null,
  val seleniumInGrams: Double? = null,
  val sodiumInGrams: Double? = null,
  val sugarInGrams: Double? = null,
  val thiaminInGrams: Double? = null,
  val totalCarbohydrateInGrams: Double? = null,
  val totalFatInGrams: Double? = null,
  val transFatInGrams: Double? = null,
  val unsaturatedFatInGrams: Double? = null,
  val vitaminAInGrams: Double? = null,
  val vitaminB12InGrams: Double? = null,
  val vitaminB6InGrams: Double? = null,
  val vitaminCInGrams: Double? = null,
  val vitaminDInGrams: Double? = null,
  val vitaminEInGrams: Double? = null,
  val vitaminKInGrams: Double? = null,
  val zincInGrams: Double? = null,
  val mealType: Int,
  val name: String? = null,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<NutritionRecordSerializable> =
      classRecords.filterIsInstance<NutritionRecord>().map { record ->
        NutritionRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          biotinInGrams = record.biotin?.inGrams,
          caffeineInGrams = record.caffeine?.inGrams,
          calciumInGrams = record.calcium?.inGrams,
          energyInKilocalories = record.energy?.inKilocalories,
          energyFromFatInKilocalories = record.energyFromFat?.inKilocalories,
          chlorideInGrams = record.chloride?.inGrams,
          cholesterolInGrams = record.cholesterol?.inGrams,
          chromiumInGrams = record.chromium?.inGrams,
          copperInGrams = record.copper?.inGrams,
          dietaryFiberInGrams = record.dietaryFiber?.inGrams,
          folateInGrams = record.folate?.inGrams,
          folicAcidInGrams = record.folicAcid?.inGrams,
          iodineInGrams = record.iodine?.inGrams,
          ironInGrams = record.iron?.inGrams,
          magnesiumInGrams = record.magnesium?.inGrams,
          manganeseInGrams = record.manganese?.inGrams,
          molybdenumInGrams = record.molybdenum?.inGrams,
          monounsaturatedFatInGrams = record.monounsaturatedFat?.inGrams,
          niacinInGrams = record.niacin?.inGrams,
          pantothenicAcidInGrams = record.pantothenicAcid?.inGrams,
          phosphorusInGrams = record.phosphorus?.inGrams,
          polyunsaturatedFatInGrams = record.polyunsaturatedFat?.inGrams,
          potassiumInGrams = record.potassium?.inGrams,
          proteinInGrams = record.protein?.inGrams,
          riboflavinInGrams = record.riboflavin?.inGrams,
          saturatedFatInGrams = record.saturatedFat?.inGrams,
          seleniumInGrams = record.selenium?.inGrams,
          sodiumInGrams = record.sodium?.inGrams,
          sugarInGrams = record.sugar?.inGrams,
          thiaminInGrams = record.thiamin?.inGrams,
          totalCarbohydrateInGrams = record.totalCarbohydrate?.inGrams,
          totalFatInGrams = record.totalFat?.inGrams,
          transFatInGrams = record.transFat?.inGrams,
          unsaturatedFatInGrams = record.unsaturatedFat?.inGrams,
          vitaminAInGrams = record.vitaminA?.inGrams,
          vitaminB12InGrams = record.vitaminB12?.inGrams,
          vitaminB6InGrams = record.vitaminB6?.inGrams,
          vitaminCInGrams = record.vitaminC?.inGrams,
          vitaminDInGrams = record.vitaminD?.inGrams,
          vitaminEInGrams = record.vitaminE?.inGrams,
          vitaminKInGrams = record.vitaminK?.inGrams,
          zincInGrams = record.zinc?.inGrams,
          mealType = record.mealType,
          name = record.name,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Power Record Helpers ---
@Serializable
data class PowerSampleSerializable(
  val time: String,
  val powerInWatts: Double,
)

// --- Power Record ---
@Serializable
data class PowerRecordSerializable(
  val startTime: String,
  val endTime: String,
  val samples: List<PowerSampleSerializable>,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<PowerRecordSerializable> =
      classRecords.filterIsInstance<PowerRecord>().map { record ->
        PowerRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          samples =
            record.samples.map {
              PowerSampleSerializable(
                time = it.time.toIsoString(),
                powerInWatts = it.power.inWatts,
              )
            },
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Sleep Session Record Helpers ---
@Serializable
data class SleepStageSerializable(
  val startTime: String,
  val endTime: String,
  val stage: Int,
)

// --- Sleep Session Record ---
@Serializable
data class SleepSessionRecordSerializable(
  val startTime: String,
  val endTime: String,
  val stages: List<SleepStageSerializable>,
  val title: String? = null,
  val notes: String? = null,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<SleepSessionRecordSerializable> =
      classRecords.filterIsInstance<SleepSessionRecord>().map { record ->
        SleepSessionRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          stages =
            record.stages.map {
              SleepStageSerializable(
                startTime = it.startTime.toIsoString(),
                endTime = it.endTime.toIsoString(),
                stage = it.stage,
              )
            },
          title = record.title,
          notes = record.notes,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Speed Record Helpers ---
@Serializable
data class SpeedSampleSerializable(
  val time: String,
  val speedInMetersPerSecond: Double,
)

// --- Speed Record ---
@Serializable
data class SpeedRecordSerializable(
  val startTime: String,
  val endTime: String,
  val samples: List<SpeedSampleSerializable>,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<SpeedRecordSerializable> =
      classRecords.filterIsInstance<SpeedRecord>().map { record ->
        SpeedRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          samples =
            record.samples.map {
              SpeedSampleSerializable(
                time = it.time.toIsoString(),
                speedInMetersPerSecond = it.speed.inMetersPerSecond,
              )
            },
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Floors Climbed Record ---
@Serializable
data class FloorsClimbedRecordSerializable(
  val startTime: String,
  val endTime: String,
  val floors: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<FloorsClimbedRecordSerializable> =
      classRecords.filterIsInstance<FloorsClimbedRecord>().map { record ->
        FloorsClimbedRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          floors = record.floors,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Steps Record ---
@Serializable
data class StepsRecordSerializable(
  val startTime: String,
  val endTime: String,
  val count: Long,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<StepsRecordSerializable> =
      classRecords.filterIsInstance<StepsRecord>().map { record ->
        StepsRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          count = record.count,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Total Calories Burned Record ---
@Serializable
data class TotalCaloriesBurnedRecordSerializable(
  val startTime: String,
  val endTime: String,
  val energyInKilocalories: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<TotalCaloriesBurnedRecordSerializable> =
      classRecords.filterIsInstance<TotalCaloriesBurnedRecord>().map { record ->
        TotalCaloriesBurnedRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          energyInKilocalories = record.energy.inKilocalories,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Weight Record ---
@Serializable
data class WeightRecordSerializable(
  val time: String,
  val weightInKilograms: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<WeightRecordSerializable> =
      classRecords.filterIsInstance<WeightRecord>().map { record ->
        WeightRecordSerializable(
          time = record.time.toIsoString(),
          weightInKilograms = record.weight.inKilograms,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Height Record ---
@Serializable
data class HeightRecordSerializable(
  val time: String,
  val heightInMeters: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<HeightRecordSerializable> =
      classRecords.filterIsInstance<HeightRecord>().map { record ->
        HeightRecordSerializable(
          time = record.time.toIsoString(),
          heightInMeters = record.height.inMeters,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Resting Heart Rate Record ---
@Serializable
data class RestingHeartRateRecordSerializable(
  val time: String,
  val beatsPerMinute: Long,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<RestingHeartRateRecordSerializable> =
      classRecords.filterIsInstance<RestingHeartRateRecord>().map { record ->
        RestingHeartRateRecordSerializable(
          time = record.time.toIsoString(),
          beatsPerMinute = record.beatsPerMinute,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- VO2 Max Record ---
@Serializable
data class Vo2MaxRecordSerializable(
  val time: String,
  val vo2MillilitersPerMinuteKilogram: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<Vo2MaxRecordSerializable> =
      classRecords.filterIsInstance<Vo2MaxRecord>().map { record ->
        Vo2MaxRecordSerializable(
          time = record.time.toIsoString(),
          vo2MillilitersPerMinuteKilogram = record.vo2MillilitersPerMinuteKilogram,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Basal Body Temperature Record ---
@Serializable
data class BasalBodyTemperatureRecordSerializable(
  val time: String,
  val temperatureInCelsius: Double,
  val measurementLocation: Int,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<BasalBodyTemperatureRecordSerializable> =
      classRecords.filterIsInstance<BasalBodyTemperatureRecord>().map { record ->
        BasalBodyTemperatureRecordSerializable(
          time = record.time.toIsoString(),
          temperatureInCelsius = record.temperature.inCelsius,
          measurementLocation = record.measurementLocation,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Basal Metabolic Rate Record ---
@Serializable
data class BasalMetabolicRateRecordSerializable(
  val time: String,
  val basalMetabolicRateInKcalPerDay: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<BasalMetabolicRateRecordSerializable> =
      classRecords.filterIsInstance<BasalMetabolicRateRecord>().map { record ->
        BasalMetabolicRateRecordSerializable(
          time = record.time.toIsoString(),
          basalMetabolicRateInKcalPerDay = record.basalMetabolicRate.inKilocaloriesPerDay,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Blood Glucose Record ---
@Serializable
data class BloodGlucoseRecordSerializable(
  val time: String,
  val levelInMmolPerL: Double,
  val specimenSource: Int,
  val mealType: Int,
  val relationToMeal: Int,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<BloodGlucoseRecordSerializable> =
      classRecords.filterIsInstance<BloodGlucoseRecord>().map { record ->
        BloodGlucoseRecordSerializable(
          time = record.time.toIsoString(),
          levelInMmolPerL = record.level.inMillimolesPerLiter,
          specimenSource = record.specimenSource,
          mealType = record.mealType,
          relationToMeal = record.relationToMeal,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Blood Pressure Record ---
@Serializable
data class BloodPressureRecordSerializable(
  val time: String,
  val systolicInMmHg: Double,
  val diastolicInMmHg: Double,
  val bodyPosition: Int,
  val measurementLocation: Int,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<BloodPressureRecordSerializable> =
      classRecords.filterIsInstance<BloodPressureRecord>().map { record ->
        BloodPressureRecordSerializable(
          time = record.time.toIsoString(),
          systolicInMmHg = record.systolic.inMillimetersOfMercury,
          diastolicInMmHg = record.diastolic.inMillimetersOfMercury,
          bodyPosition = record.bodyPosition,
          measurementLocation = record.measurementLocation,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Body Temperature Record ---
@Serializable
data class BodyTemperatureRecordSerializable(
  val time: String,
  val temperatureInCelsius: Double,
  val measurementLocation: Int,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<BodyTemperatureRecordSerializable> =
      classRecords.filterIsInstance<BodyTemperatureRecord>().map { record ->
        BodyTemperatureRecordSerializable(
          time = record.time.toIsoString(),
          temperatureInCelsius = record.temperature.inCelsius,
          measurementLocation = record.measurementLocation,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Cervical Mucus Record ---
@Serializable
data class CervicalMucusRecordSerializable(
  val time: String,
  val appearance: Int,
  val sensation: Int,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<CervicalMucusRecordSerializable> =
      classRecords.filterIsInstance<CervicalMucusRecord>().map { record ->
        CervicalMucusRecordSerializable(
          time = record.time.toIsoString(),
          appearance = record.appearance,
          sensation = record.sensation,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Cycling Pedaling Cadence Record Helpers ---
@Serializable
data class CyclingCadenceSampleSerializable(
  val time: String,
  val revolutionsPerMinute: Double,
)

// --- Cycling Pedaling Cadence Record ---
@Serializable
data class CyclingPedalingCadenceRecordSerializable(
  val startTime: String,
  val endTime: String,
  val samples: List<CyclingCadenceSampleSerializable>,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<CyclingPedalingCadenceRecordSerializable> =
      classRecords.filterIsInstance<CyclingPedalingCadenceRecord>().map { record ->
        CyclingPedalingCadenceRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          samples =
            record.samples.map {
              CyclingCadenceSampleSerializable(
                time = it.time.toIsoString(),
                revolutionsPerMinute = it.revolutionsPerMinute,
              )
            },
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Elevation Gained Record ---
@Serializable
data class ElevationGainedRecordSerializable(
  val startTime: String,
  val endTime: String,
  val elevationInMeters: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<ElevationGainedRecordSerializable> =
      classRecords.filterIsInstance<ElevationGainedRecord>().map { record ->
        ElevationGainedRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          elevationInMeters = record.elevation.inMeters,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Hydration Record ---
@Serializable
data class HydrationRecordSerializable(
  val startTime: String,
  val endTime: String,
  val volumeInLiters: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<HydrationRecordSerializable> =
      classRecords.filterIsInstance<HydrationRecord>().map { record ->
        HydrationRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          volumeInLiters = record.volume.inLiters,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Intermenstrual Bleeding Record ---
@Serializable
data class IntermenstrualBleedingRecordSerializable(
  val time: String,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<IntermenstrualBleedingRecordSerializable> =
      classRecords.filterIsInstance<IntermenstrualBleedingRecord>().map { record ->
        IntermenstrualBleedingRecordSerializable(
          time = record.time.toIsoString(),
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Menstruation Flow Record ---
@Serializable
data class MenstruationFlowRecordSerializable(
  val time: String,
  val flow: Int,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<MenstruationFlowRecordSerializable> =
      classRecords.filterIsInstance<MenstruationFlowRecord>().map { record ->
        MenstruationFlowRecordSerializable(
          time = record.time.toIsoString(),
          flow = record.flow,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Menstruation Period Record ---
@Serializable
data class MenstruationPeriodRecordSerializable(
  val startTime: String,
  val endTime: String,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<MenstruationPeriodRecordSerializable> =
      classRecords.filterIsInstance<MenstruationPeriodRecord>().map { record ->
        MenstruationPeriodRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Ovulation Test Record ---
@Serializable
data class OvulationTestRecordSerializable(
  val time: String,
  val result: Int,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<OvulationTestRecordSerializable> =
      classRecords.filterIsInstance<OvulationTestRecord>().map { record ->
        OvulationTestRecordSerializable(
          time = record.time.toIsoString(),
          result = record.result,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Oxygen Saturation Record ---
@Serializable
data class OxygenSaturationRecordSerializable(
  val time: String,
  val percentage: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<OxygenSaturationRecordSerializable> =
      classRecords.filterIsInstance<OxygenSaturationRecord>().map { record ->
        OxygenSaturationRecordSerializable(
          time = record.time.toIsoString(),
          percentage = record.percentage.value,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Respiratory Rate Record ---
@Serializable
data class RespiratoryRateRecordSerializable(
  val time: String,
  val rate: Double,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<RespiratoryRateRecordSerializable> =
      classRecords.filterIsInstance<RespiratoryRateRecord>().map { record ->
        RespiratoryRateRecordSerializable(
          time = record.time.toIsoString(),
          rate = record.rate,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Sexual Activity Record ---
@Serializable
data class SexualActivityRecordSerializable(
  val time: String,
  val protectionUsed: Int,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<SexualActivityRecordSerializable> =
      classRecords.filterIsInstance<SexualActivityRecord>().map { record ->
        SexualActivityRecordSerializable(
          time = record.time.toIsoString(),
          protectionUsed = record.protectionUsed,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// --- Wheelchair Pushes Record ---
@Serializable
data class WheelchairPushesRecordSerializable(
  val startTime: String,
  val endTime: String,
  val count: Long,
  val metadata: HealthConnectRecordMetadata,
) {
  companion object {
    fun fromRecordsList(classRecords: List<Record>): List<WheelchairPushesRecordSerializable> =
      classRecords.filterIsInstance<WheelchairPushesRecord>().map { record ->
        WheelchairPushesRecordSerializable(
          startTime = record.startTime.toIsoString(),
          endTime = record.endTime.toIsoString(),
          count = record.count,
          metadata = record.metadata.toSerializable(),
        )
      }
  }
}

// Helper to format Instant to ISO 8601 String
fun Instant.toIsoString(): String = this.atOffset(ZoneOffset.UTC).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

// Helper to convert Health Connect Metadata to Serializable Metadata
fun Metadata.toSerializable(): HealthConnectRecordMetadata =
  HealthConnectRecordMetadata(
    id = this.id,
    dataOrigin = this.dataOrigin.packageName,
    lastModifiedTime = this.lastModifiedTime.toIsoString(),
    clientRecordId = this.clientRecordId,
    clientRecordVersion = this.clientRecordVersion,
    device =
      this.device?.let {
        DeviceSerializable(
          manufacturer = it.manufacturer,
          model = it.model,
          type = it.type,
        )
      },
    recordingMethod = this.recordingMethod,
  )

/**
 * Record types for which we have WRITE permissions in the manifest.
 * These are the types used for outbound sync (backend → Health Connect).
 * Must match the WRITE_* permissions declared in AndroidManifest.xml.
 */
val writableRecordTypes: Set<KClass<out Record>> =
  setOf(
    ActiveCaloriesBurnedRecord::class,
    BodyFatRecord::class,
    BodyWaterMassRecord::class,
    BoneMassRecord::class,
    ExerciseSessionRecord::class,
    HeartRateRecord::class,
    HeartRateVariabilityRmssdRecord::class,
    HeightRecord::class,
    LeanBodyMassRecord::class,
    RestingHeartRateRecord::class,
    SleepSessionRecord::class,
    StepsRecord::class,
    WeightRecord::class,
  )

// Comprehensive list of all record KClass objects we want to read, sorted alphabetically
val allRecordTypes: List<KClass<out Record>> =
  listOf(
    ActiveCaloriesBurnedRecord::class,
    BasalBodyTemperatureRecord::class,
    BasalMetabolicRateRecord::class,
    BloodGlucoseRecord::class,
    BloodPressureRecord::class,
    BodyFatRecord::class,
    BodyTemperatureRecord::class,
    BodyWaterMassRecord::class,
    BoneMassRecord::class,
    CervicalMucusRecord::class,
    CyclingPedalingCadenceRecord::class,
    DistanceRecord::class,
    ElevationGainedRecord::class,
    ExerciseSessionRecord::class,
    FloorsClimbedRecord::class,
    HeartRateRecord::class,
    HeartRateVariabilityRmssdRecord::class,
    HeightRecord::class,
    HydrationRecord::class,
    IntermenstrualBleedingRecord::class,
    LeanBodyMassRecord::class,
    MenstruationFlowRecord::class,
    MenstruationPeriodRecord::class,
    // Note: MenstruationRecord is not an actual Health Connect SDK Record type for direct reading.
    // Permissions for MenstruationFlowRecord and MenstruationPeriodRecord cover this category.
    // If a general "MenstruationRecord::class" was intended, it should be reviewed as it's not standard.
    NutritionRecord::class,
    OvulationTestRecord::class,
    OxygenSaturationRecord::class,
    PowerRecord::class,
    RespiratoryRateRecord::class,
    RestingHeartRateRecord::class,
    SexualActivityRecord::class,
    SleepSessionRecord::class,
    SpeedRecord::class,
    StepsRecord::class,
    TotalCaloriesBurnedRecord::class,
    Vo2MaxRecord::class,
    WeightRecord::class,
    WheelchairPushesRecord::class,
  )
