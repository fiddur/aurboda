package net.aurboda

import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class OutboundSyncTest {

    @Test
    fun `deleteTargetOf deletes by record id when there is one`() {
        assertEquals(
            DeleteTarget(recordIds = listOf("hc-1"), clientRecordIds = emptyList()),
            deleteTargetOf(hcRecordId = "hc-1", entityId = "entity-1"),
        )
    }

    @Test
    fun `deleteTargetOf deletes by the client record id the writer set when there is no record id`() {
        assertEquals(
            DeleteTarget(recordIds = emptyList(), clientRecordIds = listOf("aurboda-sync-entity-1")),
            deleteTargetOf(hcRecordId = null, entityId = "entity-1"),
        )
    }

    // The record types writeUpsertRecord writes.
    private val writtenRecordTypes = listOf(
        "ActiveCaloriesBurnedRecord",
        "WeightRecord",
        "HeightRecord",
        "BodyFatRecord",
        "LeanBodyMassRecord",
        "BoneMassRecord",
        "BodyWaterMassRecord",
        "RestingHeartRateRecord",
        "StepsRecord",
        "HeartRateRecord",
        "HeartRateVariabilityRmssdRecord",
        "ExerciseSessionRecord",
        "SleepSessionRecord",
    )

    @Test
    fun `every written record type maps to a class for deletes`() {
        for (typeName in writtenRecordTypes) {
            val recordClass = hcRecordTypeToClass(typeName)
            assertNotNull("$typeName has no class for deletes", recordClass)
            assertEquals(typeName, recordClass!!.simpleName)
        }
    }

    @Test
    fun `calories_active deletes resolve to ActiveCaloriesBurnedRecord`() {
        assertEquals(ActiveCaloriesBurnedRecord::class, hcRecordTypeToClass("ActiveCaloriesBurnedRecord"))
    }

    @Test
    fun `unknown record type maps to null`() {
        assertNull(hcRecordTypeToClass("NutritionRecord"))
    }
}
