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
val appJson = Json {
    prettyPrint = true
    isLenient = true
    ignoreUnknownKeys = true
    encodeDefaults = true // Important if you have default values and want them in the JSON
}

// Generic wrapper for POST requests
@Serializable
data class PostWrapper<T>(val data: List<T>)

// Daily aggregate for deduplicated cumulative metrics
@Serializable
data class DailyAggregate(
    val date: String,           // "2024-01-15"
    val metric: String,         // "steps", "distance", etc.
    val value: Double,
    val dataOrigins: List<String>  // Contributing app package names
)

// --- Base Metadata and Device for Serializable Records ---
@Serializable
data class DeviceSerializable(
    val manufacturer: String?,
    val model: String?,
    val type: Int
)

@Serializable
data class HealthConnectRecordMetadata(
    val id: String,
    val dataOrigin: String, // package name
    val lastModifiedTime: String,
    val clientRecordId: String?,
    val clientRecordVersion: Long,
    val device: DeviceSerializable?,
    val recordingMethod: Int
)

// --- Active Calories Burned Record ---
@Serializable
data class ActiveCaloriesBurnedRecordSerializable(
    val startTime: String,
    val endTime: String,
    val energyInKilocalories: Double,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<ActiveCaloriesBurnedRecordSerializable> {
            return classRecords.filterIsInstance<ActiveCaloriesBurnedRecord>().map { record ->
                ActiveCaloriesBurnedRecordSerializable(
                    startTime = record.startTime.toIsoString(),
                    endTime = record.endTime.toIsoString(),
                    energyInKilocalories = record.energy.inKilocalories,
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Body Fat Record ---
@Serializable
data class BodyFatRecordSerializable(
    val time: String,
    val percentage: Double,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<BodyFatRecordSerializable> {
            return classRecords.filterIsInstance<BodyFatRecord>().map { record ->
                BodyFatRecordSerializable(
                    time = record.time.toIsoString(),
                    percentage = record.percentage.value, // androidx.health.connect.client.units.Percentage.value is Double
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Body Water Mass Record ---
@Serializable
data class BodyWaterMassRecordSerializable(
    val time: String,
    val massInKilograms: Double,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<BodyWaterMassRecordSerializable> {
            return classRecords.filterIsInstance<BodyWaterMassRecord>().map { record ->
                BodyWaterMassRecordSerializable(
                    time = record.time.toIsoString(),
                    massInKilograms = record.mass.inKilograms,
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Bone Mass Record ---
@Serializable
data class BoneMassRecordSerializable(
    val time: String,
    val massInKilograms: Double,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<BoneMassRecordSerializable> {
            return classRecords.filterIsInstance<BoneMassRecord>().map { record ->
                BoneMassRecordSerializable(
                    time = record.time.toIsoString(),
                    massInKilograms = record.mass.inKilograms,
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Distance Record --- 
@Serializable
data class DistanceRecordSerializable(
    val startTime: String,
    val endTime: String,
    val distanceInMeters: Double?,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<DistanceRecordSerializable> {
            return classRecords.filterIsInstance<DistanceRecord>().map { record ->
                DistanceRecordSerializable(
                    startTime = record.startTime.toIsoString(),
                    endTime = record.endTime.toIsoString(),
                    distanceInMeters = record.distance.inMeters,
                    metadata = record.metadata.toSerializable()
                )
            }
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
    val lengthInMeters: Double?
)

@Serializable
data class ExerciseRouteLocationSerializable(
    val time: String,
    val latitude: Double,
    val longitude: Double,
    val horizontalAccuracyInMeters: Double?,
    val verticalAccuracyInMeters: Double?,
    val altitudeInMeters: Double?
)

@Serializable
data class ExerciseRouteSerializable(
    val route: List<ExerciseRouteLocationSerializable>
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
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<ExerciseSessionRecordSerializable> {
            return classRecords.filterIsInstance<ExerciseSessionRecord>().map { record: ExerciseSessionRecord ->
                ExerciseSessionRecordSerializable(
                    startTime = record.startTime.toIsoString(),
                    endTime = record.endTime.toIsoString(),
                    exerciseType = record.exerciseType,
                    title = record.title,
                    notes = record.notes,
                    segments = record.segments.map { segment: ExerciseSegment ->
                        ExerciseSegmentSerializable(
                            startTime = segment.startTime.toIsoString(),
                            endTime = segment.endTime.toIsoString(),
                            segmentType = segment.segmentType
                            // weightInKilograms = if (segment.weight != null) segment.weight!!.inKilograms else null // Enable if segment.weight is available
                        )
                    }.takeIf { it.isNotEmpty() },
                    laps = record.laps.map { lap: ExerciseLap ->
                        ExerciseLapSerializable(
                            startTime = lap.startTime.toIsoString(),
                            endTime = lap.endTime.toIsoString(),
                            lengthInMeters = lap.length?.inMeters
                        )
                    }.takeIf { it.isNotEmpty() },
                    route = if (record.exerciseRouteResult is ExerciseRouteResult.Data) {
                        (record.exerciseRouteResult as ExerciseRouteResult.Data).exerciseRoute?.let { sdkExerciseRoute: ExerciseRoute ->
                            ExerciseRouteSerializable(
                                route = sdkExerciseRoute.route.map { sdkLocation: ExerciseRoute.Location ->
                                    ExerciseRouteLocationSerializable(
                                        time = sdkLocation.time.toIsoString(),
                                        latitude = sdkLocation.latitude,
                                        longitude = sdkLocation.longitude,
                                        horizontalAccuracyInMeters = sdkLocation.horizontalAccuracy?.inMeters,
                                        verticalAccuracyInMeters = sdkLocation.verticalAccuracy?.inMeters,
                                        altitudeInMeters = sdkLocation.altitude?.inMeters
                                    )
                                }
                            )
                        }
                    } else {
                        null
                    },
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Heart Rate Record Helpers ---
@Serializable
data class HeartRateSampleSerializable(
    val time: String,
    val beatsPerMinute: Long
)

// --- Heart Rate Record ---
@Serializable
data class HeartRateRecordSerializable(
    val startTime: String,
    val endTime: String,
    val samples: List<HeartRateSampleSerializable>,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<HeartRateRecordSerializable> {
            return classRecords.filterIsInstance<HeartRateRecord>().map { record ->
                HeartRateRecordSerializable(
                    startTime = record.startTime.toIsoString(),
                    endTime = record.endTime.toIsoString(),
                    samples = record.samples.map {
                        HeartRateSampleSerializable(
                            time = it.time.toIsoString(),
                            beatsPerMinute = it.beatsPerMinute
                        )
                    },
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Heart Rate Variability Record ---
@Serializable
data class HrvRecordSerializable(
    val time: String,
    val hrvInMilliseconds: Double,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<HrvRecordSerializable> {
            return classRecords.filterIsInstance<HeartRateVariabilityRmssdRecord>().map { record ->
                HrvRecordSerializable(
                    time = record.time.toIsoString(),
                    hrvInMilliseconds = record.heartRateVariabilityMillis,
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Lean Body Mass Record ---
@Serializable
data class LeanBodyMassRecordSerializable(
    val time: String,
    val massInKilograms: Double,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<LeanBodyMassRecordSerializable> {
            return classRecords.filterIsInstance<LeanBodyMassRecord>().map { record ->
                LeanBodyMassRecordSerializable(
                    time = record.time.toIsoString(),
                    massInKilograms = record.mass.inKilograms,
                    metadata = record.metadata.toSerializable()
                )
            }
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
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<NutritionRecordSerializable> {
            return classRecords.filterIsInstance<NutritionRecord>().map { record ->
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
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Power Record Helpers ---
@Serializable
data class PowerSampleSerializable(
    val time: String,
    val powerInWatts: Double
)

// --- Power Record ---
@Serializable
data class PowerRecordSerializable(
    val startTime: String,
    val endTime: String,
    val samples: List<PowerSampleSerializable>,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<PowerRecordSerializable> {
            return classRecords.filterIsInstance<PowerRecord>().map { record ->
                PowerRecordSerializable(
                    startTime = record.startTime.toIsoString(),
                    endTime = record.endTime.toIsoString(),
                    samples = record.samples.map {
                        PowerSampleSerializable(
                            time = it.time.toIsoString(),
                            powerInWatts = it.power.inWatts
                        )
                    },
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Sleep Session Record Helpers ---
@Serializable
data class SleepStageSerializable(
    val startTime: String,
    val endTime: String,
    val stage: Int
)

// --- Sleep Session Record ---
@Serializable
data class SleepSessionRecordSerializable(
    val startTime: String,
    val endTime: String,
    val stages: List<SleepStageSerializable>,
    val title: String? = null,
    val notes: String? = null,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<SleepSessionRecordSerializable> {
            return classRecords.filterIsInstance<SleepSessionRecord>().map { record ->
                SleepSessionRecordSerializable(
                    startTime = record.startTime.toIsoString(),
                    endTime = record.endTime.toIsoString(),
                    stages = record.stages.map {
                        SleepStageSerializable(
                            startTime = it.startTime.toIsoString(),
                            endTime = it.endTime.toIsoString(),
                            stage = it.stage
                        )
                    },
                    title = record.title,
                    notes = record.notes,
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Speed Record Helpers ---
@Serializable
data class SpeedSampleSerializable(
    val time: String,
    val speedInMetersPerSecond: Double
)

// --- Speed Record ---
@Serializable
data class SpeedRecordSerializable(
    val startTime: String,
    val endTime: String,
    val samples: List<SpeedSampleSerializable>,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<SpeedRecordSerializable> {
            return classRecords.filterIsInstance<SpeedRecord>().map { record ->
                SpeedRecordSerializable(
                    startTime = record.startTime.toIsoString(),
                    endTime = record.endTime.toIsoString(),
                    samples = record.samples.map {
                        SpeedSampleSerializable(
                            time = it.time.toIsoString(),
                            speedInMetersPerSecond = it.speed.inMetersPerSecond
                        )
                    },
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Steps Record ---
@Serializable
data class StepsRecordSerializable(
    val startTime: String,
    val endTime: String,
    val count: Long,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<StepsRecordSerializable> {
            return classRecords.filterIsInstance<StepsRecord>().map { record ->
                StepsRecordSerializable(
                    startTime = record.startTime.toIsoString(),
                    endTime = record.endTime.toIsoString(),
                    count = record.count,
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Total Calories Burned Record ---
@Serializable
data class TotalCaloriesBurnedRecordSerializable(
    val startTime: String,
    val endTime: String,
    val energyInKilocalories: Double,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<TotalCaloriesBurnedRecordSerializable> {
            return classRecords.filterIsInstance<TotalCaloriesBurnedRecord>().map { record ->
                TotalCaloriesBurnedRecordSerializable(
                    startTime = record.startTime.toIsoString(),
                    endTime = record.endTime.toIsoString(),
                    energyInKilocalories = record.energy.inKilocalories,
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Weight Record ---
@Serializable
data class WeightRecordSerializable(
    val time: String,
    val weightInKilograms: Double,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<WeightRecordSerializable> {
            return classRecords.filterIsInstance<WeightRecord>().map { record ->
                WeightRecordSerializable(
                    time = record.time.toIsoString(),
                    weightInKilograms = record.weight.inKilograms,
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Height Record ---
@Serializable
data class HeightRecordSerializable(
    val time: String,
    val heightInMeters: Double,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<HeightRecordSerializable> {
            return classRecords.filterIsInstance<HeightRecord>().map { record ->
                HeightRecordSerializable(
                    time = record.time.toIsoString(),
                    heightInMeters = record.height.inMeters,
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// --- Resting Heart Rate Record ---
@Serializable
data class RestingHeartRateRecordSerializable(
    val time: String,
    val beatsPerMinute: Long,
    val metadata: HealthConnectRecordMetadata
) {
    companion object {
        fun fromRecordsList(classRecords: List<Record>): List<RestingHeartRateRecordSerializable> {
            return classRecords.filterIsInstance<RestingHeartRateRecord>().map { record ->
                RestingHeartRateRecordSerializable(
                    time = record.time.toIsoString(),
                    beatsPerMinute = record.beatsPerMinute,
                    metadata = record.metadata.toSerializable()
                )
            }
        }
    }
}

// Helper to format Instant to ISO 8601 String
fun Instant.toIsoString(): String {
    return this.atOffset(ZoneOffset.UTC).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
}

// Helper to convert Health Connect Metadata to Serializable Metadata
fun Metadata.toSerializable(): HealthConnectRecordMetadata {
    return HealthConnectRecordMetadata(
        id = this.id,
        dataOrigin = this.dataOrigin.packageName,
        lastModifiedTime = this.lastModifiedTime.toIsoString(),
        clientRecordId = this.clientRecordId,
        clientRecordVersion = this.clientRecordVersion,
        device = this.device?.let {
            DeviceSerializable(
                manufacturer = it.manufacturer,
                model = it.model,
                type = it.type
            )
        },
        recordingMethod = this.recordingMethod
    )
}

// Comprehensive list of all record KClass objects we want to read, sorted alphabetically
val allRecordTypes: List<KClass<out Record>> = listOf(
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
    WheelchairPushesRecord::class
)
