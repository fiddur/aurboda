package net.aurboda

import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import kotlin.reflect.KClass

/**
 * Permission required to read Health Connect data while Aurboda is not in the
 * foreground. Health Connect only grants this after the user has granted at
 * least one foreground read permission. Without it, [SyncWorker]'s periodic
 * job throws HealthConnectException when reading.
 */
const val HC_BACKGROUND_READ_PERMISSION: String =
    "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"

/**
 * A user-friendly grouping of Health Connect record types into categories.
 */
data class HealthDataCategory(
    val name: String,
    val recordTypes: List<KClass<out Record>>,
    val description: String
)

/**
 * Permission status for a single category.
 */
data class CategoryPermissionStatus(
    val category: HealthDataCategory,
    val grantedCount: Int,
    val totalCount: Int
) {
    val allGranted: Boolean get() = grantedCount == totalCount
    val noneGranted: Boolean get() = grantedCount == 0
    val partiallyGranted: Boolean get() = grantedCount in 1 until totalCount
}

val healthDataCategories: List<HealthDataCategory> = listOf(
    HealthDataCategory(
        name = "Activity & Exercise",
        recordTypes = listOf(
            StepsRecord::class,
            DistanceRecord::class,
            ActiveCaloriesBurnedRecord::class,
            TotalCaloriesBurnedRecord::class,
            ExerciseSessionRecord::class,
            SpeedRecord::class,
            PowerRecord::class,
            FloorsClimbedRecord::class,
            CyclingPedalingCadenceRecord::class,
            ElevationGainedRecord::class,
            Vo2MaxRecord::class,
            WheelchairPushesRecord::class
        ),
        description = "Steps, distance, calories, exercise sessions, and more"
    ),
    HealthDataCategory(
        name = "Heart & Vitals",
        recordTypes = listOf(
            HeartRateRecord::class,
            HeartRateVariabilityRmssdRecord::class,
            RestingHeartRateRecord::class,
            BloodPressureRecord::class,
            OxygenSaturationRecord::class,
            RespiratoryRateRecord::class,
            BloodGlucoseRecord::class,
            BasalMetabolicRateRecord::class
        ),
        description = "Heart rate, HRV, blood pressure, SpO2, and more"
    ),
    HealthDataCategory(
        name = "Body Measurements",
        recordTypes = listOf(
            WeightRecord::class,
            HeightRecord::class,
            BodyFatRecord::class,
            LeanBodyMassRecord::class,
            BoneMassRecord::class,
            BodyWaterMassRecord::class,
            BodyTemperatureRecord::class,
            BasalBodyTemperatureRecord::class
        ),
        description = "Weight, height, body composition, and temperature"
    ),
    HealthDataCategory(
        name = "Sleep",
        recordTypes = listOf(
            SleepSessionRecord::class
        ),
        description = "Sleep sessions and stages"
    ),
    HealthDataCategory(
        name = "Nutrition & Hydration",
        recordTypes = listOf(
            NutritionRecord::class,
            HydrationRecord::class
        ),
        description = "Food intake and hydration"
    ),
    HealthDataCategory(
        name = "Reproductive Health",
        recordTypes = listOf(
            CervicalMucusRecord::class,
            IntermenstrualBleedingRecord::class,
            MenstruationFlowRecord::class,
            MenstruationPeriodRecord::class,
            OvulationTestRecord::class,
            SexualActivityRecord::class
        ),
        description = "Menstrual cycle, ovulation, and related data"
    )
)

/**
 * Filter allRecordTypes to only those with a granted read permission.
 */
fun getGrantedRecordTypes(
    grantedPermissions: Set<String>,
    recordTypes: List<KClass<out Record>> = allRecordTypes
): List<KClass<out Record>> =
    recordTypes.filter { recordType ->
        HealthPermission.getReadPermission(recordType) in grantedPermissions
    }

/**
 * Compute per-category permission status from the set of granted permissions.
 */
fun getCategoryStatuses(
    grantedPermissions: Set<String>,
    categories: List<HealthDataCategory> = healthDataCategories
): List<CategoryPermissionStatus> =
    categories.map { category ->
        val grantedCount = category.recordTypes.count { recordType ->
            HealthPermission.getReadPermission(recordType) in grantedPermissions
        }
        CategoryPermissionStatus(
            category = category,
            grantedCount = grantedCount,
            totalCount = category.recordTypes.size
        )
    }
