package net.aurboda

import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.records.MindfulnessSessionRecord
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class HealthDataModelsTest {
  @Test
  fun `toIsoString formats instant correctly in UTC`() {
    val instant = Instant.parse("2024-01-15T10:30:00Z")
    assertEquals("2024-01-15T10:30:00Z", instant.toIsoString())
  }

  @Test
  fun `toIsoString handles epoch instant`() {
    val instant = Instant.EPOCH
    assertEquals("1970-01-01T00:00:00Z", instant.toIsoString())
  }

  @Test
  fun `toIsoString handles milliseconds`() {
    val instant = Instant.parse("2024-06-20T14:25:30.123Z")
    assertTrue(instant.toIsoString().startsWith("2024-06-20T14:25:30"))
  }

  @Test
  fun `appJson configuration is lenient`() {
    val jsonString = """{"known": "value", "unknown": "ignored"}"""

    @kotlinx.serialization.Serializable
    data class TestData(
      val known: String,
    )

    val result = appJson.decodeFromString<TestData>(jsonString)
    assertEquals("value", result.known)
  }

  @Test
  fun `appJson encodes defaults`() {
    @kotlinx.serialization.Serializable
    data class TestWithDefault(
      val value: String = "default",
    )

    val result = appJson.encodeToString(kotlinx.serialization.serializer(), TestWithDefault())
    assertTrue(result.contains("default"))
  }

  @Test
  fun `DeviceSerializable holds device info correctly`() {
    val device =
      DeviceSerializable(
        manufacturer = "Samsung",
        model = "Galaxy Watch 5",
        type = 1,
      )

    assertEquals("Samsung", device.manufacturer)
    assertEquals("Galaxy Watch 5", device.model)
    assertEquals(1, device.type)
  }

  @Test
  fun `DeviceSerializable handles null manufacturer and model`() {
    val device =
      DeviceSerializable(
        manufacturer = null,
        model = null,
        type = 0,
      )

    assertNull(device.manufacturer)
    assertNull(device.model)
    assertEquals(0, device.type)
  }

  @Test
  fun `HealthConnectRecordMetadata stores all fields`() {
    val metadata =
      HealthConnectRecordMetadata(
        id = "test-id-123",
        dataOrigin = "com.example.app",
        lastModifiedTime = "2024-01-15T10:30:00Z",
        clientRecordId = "client-123",
        clientRecordVersion = 1L,
        device = DeviceSerializable("Test", "Model", 1),
        recordingMethod = 2,
      )

    assertEquals("test-id-123", metadata.id)
    assertEquals("com.example.app", metadata.dataOrigin)
    assertEquals("2024-01-15T10:30:00Z", metadata.lastModifiedTime)
    assertEquals("client-123", metadata.clientRecordId)
    assertEquals(1L, metadata.clientRecordVersion)
    assertNotNull(metadata.device)
    assertEquals(2, metadata.recordingMethod)
  }

  @Test
  fun `HeartRateSampleSerializable stores sample data`() {
    val sample =
      HeartRateSampleSerializable(
        time = "2024-01-15T10:30:00Z",
        beatsPerMinute = 72L,
      )

    assertEquals("2024-01-15T10:30:00Z", sample.time)
    assertEquals(72L, sample.beatsPerMinute)
  }

  @Test
  fun `StepsRecordSerializable stores step count`() {
    val metadata =
      HealthConnectRecordMetadata(
        id = "steps-1",
        dataOrigin = "com.google.android.apps.fitness",
        lastModifiedTime = "2024-01-15T10:30:00Z",
        clientRecordId = null,
        clientRecordVersion = 0L,
        device = null,
        recordingMethod = 1,
      )

    val record =
      StepsRecordSerializable(
        startTime = "2024-01-15T08:00:00Z",
        endTime = "2024-01-15T09:00:00Z",
        count = 5432L,
        metadata = metadata,
      )

    assertEquals(5432L, record.count)
    assertEquals("2024-01-15T08:00:00Z", record.startTime)
    assertEquals("2024-01-15T09:00:00Z", record.endTime)
  }

  @Test
  fun `SleepStageSerializable stores stage info`() {
    val stage =
      SleepStageSerializable(
        startTime = "2024-01-15T23:00:00Z",
        endTime = "2024-01-16T01:00:00Z",
        stage = 4, // Deep sleep
      )

    assertEquals(4, stage.stage)
    assertEquals("2024-01-15T23:00:00Z", stage.startTime)
    assertEquals("2024-01-16T01:00:00Z", stage.endTime)
  }

  @Test
  fun `allRecordTypes contains expected record classes`() {
    val typeNames = allRecordTypes.map { it.simpleName }

    assertTrue("Should contain HeartRateRecord", typeNames.contains("HeartRateRecord"))
    assertTrue("Should contain StepsRecord", typeNames.contains("StepsRecord"))
    assertTrue("Should contain SleepSessionRecord", typeNames.contains("SleepSessionRecord"))
    assertTrue("Should contain WeightRecord", typeNames.contains("WeightRecord"))
    assertTrue("Should contain ExerciseSessionRecord", typeNames.contains("ExerciseSessionRecord"))
  }

  @Test
  fun `allRecordTypes has no duplicates`() {
    val uniqueTypes = allRecordTypes.toSet()
    assertEquals(allRecordTypes.size, uniqueTypes.size)
  }

  @Test
  fun `writableRecordTypes is a subset of allRecordTypes`() {
    val allSet = allRecordTypes.toSet()
    for (type in writableRecordTypes) {
      assertTrue(
        "${type.simpleName} is in writableRecordTypes but not in allRecordTypes",
        type in allSet,
      )
    }
  }

  @Test
  fun `BloodPressureRecordSerializable holds systolic and diastolic`() {
    val metadata =
      HealthConnectRecordMetadata(
        id = "bp-1",
        dataOrigin = "com.example",
        lastModifiedTime = "2024-01-15T10:30:00Z",
        clientRecordId = null,
        clientRecordVersion = 0L,
        device = null,
        recordingMethod = 1,
      )
    val record =
      BloodPressureRecordSerializable(
        time = "2024-01-15T10:30:00Z",
        systolicInMmHg = 120.0,
        diastolicInMmHg = 80.0,
        bodyPosition = 1,
        measurementLocation = 1,
        metadata = metadata,
      )
    val json = appJson.encodeToString(BloodPressureRecordSerializable.serializer(), record)
    assertTrue(json.contains("\"systolicInMmHg\""))
    assertTrue(json.contains("\"diastolicInMmHg\""))
    assertTrue(json.contains("120"))
  }

  @Test
  fun `ElevationGainedRecordSerializable round-trips through JSON`() {
    val metadata =
      HealthConnectRecordMetadata(
        id = "elev-1",
        dataOrigin = "com.example",
        lastModifiedTime = "2024-01-15T10:30:00Z",
        clientRecordId = null,
        clientRecordVersion = 0L,
        device = null,
        recordingMethod = 1,
      )
    val record =
      ElevationGainedRecordSerializable(
        startTime = "2024-01-15T08:00:00Z",
        endTime = "2024-01-15T09:00:00Z",
        elevationInMeters = 42.5,
        metadata = metadata,
      )
    val json = appJson.encodeToString(ElevationGainedRecordSerializable.serializer(), record)
    val decoded = appJson.decodeFromString<ElevationGainedRecordSerializable>(json)
    assertEquals(42.5, decoded.elevationInMeters, 0.0)
    assertEquals("2024-01-15T08:00:00Z", decoded.startTime)
  }

  @Test
  fun `CyclingPedalingCadenceRecordSerializable round-trips nested samples`() {
    val metadata =
      HealthConnectRecordMetadata(
        id = "cad-1",
        dataOrigin = "com.example",
        lastModifiedTime = "2024-01-15T10:30:00Z",
        clientRecordId = null,
        clientRecordVersion = 0L,
        device = null,
        recordingMethod = 1,
      )
    val record =
      CyclingPedalingCadenceRecordSerializable(
        startTime = "2024-01-15T08:00:00Z",
        endTime = "2024-01-15T08:05:00Z",
        samples =
          listOf(
            CyclingCadenceSampleSerializable(time = "2024-01-15T08:00:30Z", revolutionsPerMinute = 85.0),
            CyclingCadenceSampleSerializable(time = "2024-01-15T08:01:30Z", revolutionsPerMinute = 92.5),
          ),
        metadata = metadata,
      )
    val json = appJson.encodeToString(CyclingPedalingCadenceRecordSerializable.serializer(), record)
    val decoded = appJson.decodeFromString<CyclingPedalingCadenceRecordSerializable>(json)
    assertEquals(2, decoded.samples.size)
    assertEquals(85.0, decoded.samples[0].revolutionsPerMinute, 0.0)
    assertEquals("2024-01-15T08:01:30Z", decoded.samples[1].time)
    assertEquals(92.5, decoded.samples[1].revolutionsPerMinute, 0.0)
  }

  @Test
  fun `every readable record type in allRecordTypes is dispatched in sendRecords`() {
    // Source-of-truth test: keep this in sync with the when-block in SyncUtils.sendRecords.
    // If you add a record class to allRecordTypes, you must also add a serializer + dispatch case.
    val coveredByDispatch =
      setOf(
        "ActiveCaloriesBurnedRecord",
        "BasalBodyTemperatureRecord",
        "BasalMetabolicRateRecord",
        "BloodGlucoseRecord",
        "BloodPressureRecord",
        "BodyFatRecord",
        "BodyTemperatureRecord",
        "BodyWaterMassRecord",
        "BoneMassRecord",
        "CervicalMucusRecord",
        "CyclingPedalingCadenceRecord",
        "DistanceRecord",
        "ElevationGainedRecord",
        "ExerciseSessionRecord",
        "FloorsClimbedRecord",
        "HeartRateRecord",
        "HeartRateVariabilityRmssdRecord",
        "HeightRecord",
        "HydrationRecord",
        "IntermenstrualBleedingRecord",
        "LeanBodyMassRecord",
        "MenstruationFlowRecord",
        "MenstruationPeriodRecord",
        "MindfulnessSessionRecord",
        "NutritionRecord",
        "OvulationTestRecord",
        "OxygenSaturationRecord",
        "PowerRecord",
        "RespiratoryRateRecord",
        "RestingHeartRateRecord",
        "SexualActivityRecord",
        "SleepSessionRecord",
        "SpeedRecord",
        "StepsRecord",
        "TotalCaloriesBurnedRecord",
        "Vo2MaxRecord",
        "WeightRecord",
        "WheelchairPushesRecord",
      )
    val readable = allRecordTypes.map { it.simpleName }.toSet()
    val missing = readable - coveredByDispatch
    assertTrue("Record types without sendRecords dispatch: $missing", missing.isEmpty())
  }

  @Test
  fun `writableRecordTypes matches outbound sync record types`() {
    // These are the record types handled in OutboundSync.kt writeUpsertRecord()
    val expectedTypes =
      setOf(
        "ActiveCaloriesBurnedRecord",
        "BodyFatRecord",
        "BodyWaterMassRecord",
        "BoneMassRecord",
        "ExerciseSessionRecord",
        "HeartRateRecord",
        "HeartRateVariabilityRmssdRecord",
        "HeightRecord",
        "LeanBodyMassRecord",
        "RestingHeartRateRecord",
        "SleepSessionRecord",
        "StepsRecord",
        "WeightRecord",
      )
    val actualTypes = writableRecordTypes.map { it.simpleName }.toSet()
    assertEquals(expectedTypes, actualTypes)
  }

  @Test
  fun `MindfulnessSessionRecordSerializable round-trips through JSON`() {
    val metadata =
      HealthConnectRecordMetadata(
        id = "hc-mind-1",
        dataOrigin = "com.wakingup.android",
        lastModifiedTime = "2024-01-15T10:30:00Z",
        clientRecordId = null,
        clientRecordVersion = 0L,
        device = null,
        recordingMethod = 0,
      )
    val record =
      MindfulnessSessionRecordSerializable(
        startTime = "2024-01-15T10:00:00Z",
        endTime = "2024-01-15T10:21:00Z",
        mindfulnessSessionType = MindfulnessSessionRecord.MINDFULNESS_SESSION_TYPE_MEDITATION,
        title = "Meditation • What Is Real?",
        notes = "x",
        metadata = metadata,
      )
    val json = appJson.encodeToString(MindfulnessSessionRecordSerializable.serializer(), record)
    val decoded = appJson.decodeFromString<MindfulnessSessionRecordSerializable>(json)
    assertEquals(record, decoded)
    assertEquals(1, decoded.mindfulnessSessionType)
  }

  @Test
  fun `MindfulnessSessionRecordSerializable omits absent title and notes`() {
    val metadata =
      HealthConnectRecordMetadata(
        id = "hc-mind-2",
        dataOrigin = "com.example",
        lastModifiedTime = "2024-01-15T10:30:00Z",
        clientRecordId = null,
        clientRecordVersion = 0L,
        device = null,
        recordingMethod = 0,
      )
    val record =
      MindfulnessSessionRecordSerializable(
        startTime = "2024-01-15T10:00:00Z",
        endTime = "2024-01-15T10:10:00Z",
        mindfulnessSessionType = MindfulnessSessionRecord.MINDFULNESS_SESSION_TYPE_UNKNOWN,
        metadata = metadata,
      )
    val json = appJson.encodeToString(MindfulnessSessionRecordSerializable.serializer(), record)
    assertFalse(json.contains("\"title\""))
    assertFalse(json.contains("\"notes\""))
  }

  @Test
  fun `filterAvailableRecordTypes drops mindfulness sessions when the feature is unavailable`() {
    val available = filterAvailableRecordTypes(isFeatureAvailable = { false })
    assertFalse(MindfulnessSessionRecord::class in available)
    assertEquals(allRecordTypes - MindfulnessSessionRecord::class, available)
  }

  @Test
  fun `filterAvailableRecordTypes keeps mindfulness sessions when the feature is available`() {
    val available = filterAvailableRecordTypes(isFeatureAvailable = { true })
    assertTrue(MindfulnessSessionRecord::class in available)
    assertEquals(allRecordTypes, available)
  }

  @Test
  fun `filterAvailableRecordTypes asks about the mindfulness feature`() {
    val asked = mutableListOf<Int>()
    filterAvailableRecordTypes(isFeatureAvailable = { feature -> asked.add(feature) })
    assertEquals(listOf(HealthConnectFeatures.FEATURE_MINDFULNESS_SESSION), asked)
  }
}
