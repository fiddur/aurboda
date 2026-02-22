package net.aurboda

import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import org.junit.Test
import org.junit.Assert.*

class HealthConnectPermissionsTest {

    @Test
    fun `all allRecordTypes are covered by exactly one category`() {
        val categorized = healthDataCategories.flatMap { it.recordTypes }
        val categorizedSet = categorized.toSet()

        // Every allRecordType must appear in categories
        for (recordType in allRecordTypes) {
            assertTrue(
                "${recordType.simpleName} is not in any category",
                recordType in categorizedSet
            )
        }

        // No duplicates across categories
        assertEquals(
            "Some record types appear in multiple categories",
            categorized.size,
            categorizedSet.size
        )

        // Every categorized type must be in allRecordTypes
        val allRecordSet = allRecordTypes.toSet()
        for (recordType in categorizedSet) {
            assertTrue(
                "${recordType.simpleName} is in categories but not in allRecordTypes",
                recordType in allRecordSet
            )
        }
    }

    @Test
    fun `getGrantedRecordTypes returns only types with granted read permission`() {
        val subset = listOf(StepsRecord::class, WeightRecord::class, SleepSessionRecord::class)
        val grantedPermissions = setOf(
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(SleepSessionRecord::class)
        )

        val result = getGrantedRecordTypes(grantedPermissions, subset)

        assertEquals(2, result.size)
        assertTrue(StepsRecord::class in result)
        assertTrue(SleepSessionRecord::class in result)
        assertFalse(WeightRecord::class in result)
    }

    @Test
    fun `getGrantedRecordTypes returns empty list when no permissions granted`() {
        val result = getGrantedRecordTypes(emptySet(), allRecordTypes)
        assertTrue(result.isEmpty())
    }

    @Test
    fun `getGrantedRecordTypes returns all types when all permissions granted`() {
        val allPermissions = allRecordTypes.map { HealthPermission.getReadPermission(it) }.toSet()
        val result = getGrantedRecordTypes(allPermissions, allRecordTypes)
        assertEquals(allRecordTypes.size, result.size)
    }

    @Test
    fun `getCategoryStatuses computes correct counts`() {
        val grantedPermissions = setOf(
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(DistanceRecord::class),
            HealthPermission.getReadPermission(SleepSessionRecord::class)
        )

        val statuses = getCategoryStatuses(grantedPermissions)

        // Activity category should be partially granted (2 of 12)
        val activityStatus = statuses.first { it.category.name == "Activity & Exercise" }
        assertEquals(2, activityStatus.grantedCount)
        assertEquals(12, activityStatus.totalCount)
        assertTrue(activityStatus.partiallyGranted)
        assertFalse(activityStatus.allGranted)
        assertFalse(activityStatus.noneGranted)

        // Sleep should be fully granted (1 of 1)
        val sleepStatus = statuses.first { it.category.name == "Sleep" }
        assertEquals(1, sleepStatus.grantedCount)
        assertEquals(1, sleepStatus.totalCount)
        assertTrue(sleepStatus.allGranted)
        assertFalse(sleepStatus.partiallyGranted)
        assertFalse(sleepStatus.noneGranted)

        // Heart should be none granted
        val heartStatus = statuses.first { it.category.name == "Heart & Vitals" }
        assertEquals(0, heartStatus.grantedCount)
        assertTrue(heartStatus.noneGranted)
        assertFalse(heartStatus.allGranted)
        assertFalse(heartStatus.partiallyGranted)
    }

    @Test
    fun `getCategoryStatuses with all permissions shows all granted`() {
        val allPermissions = allRecordTypes.map { HealthPermission.getReadPermission(it) }.toSet()
        val statuses = getCategoryStatuses(allPermissions)

        for (status in statuses) {
            assertTrue("${status.category.name} should be all granted", status.allGranted)
            assertFalse(status.partiallyGranted)
            assertFalse(status.noneGranted)
        }
    }

    @Test
    fun `getCategoryStatuses with no permissions shows all none granted`() {
        val statuses = getCategoryStatuses(emptySet())

        for (status in statuses) {
            assertTrue("${status.category.name} should be none granted", status.noneGranted)
            assertFalse(status.allGranted)
            assertFalse(status.partiallyGranted)
        }
    }

    @Test
    fun `CategoryPermissionStatus boundary - single type category`() {
        val singleCategory = HealthDataCategory(
            name = "Test",
            recordTypes = listOf(SleepSessionRecord::class),
            description = "Test"
        )

        // None granted
        val noneStatus = CategoryPermissionStatus(singleCategory, grantedCount = 0, totalCount = 1)
        assertTrue(noneStatus.noneGranted)
        assertFalse(noneStatus.allGranted)
        assertFalse(noneStatus.partiallyGranted)

        // All granted
        val allStatus = CategoryPermissionStatus(singleCategory, grantedCount = 1, totalCount = 1)
        assertTrue(allStatus.allGranted)
        assertFalse(noneStatus.partiallyGranted)
        assertFalse(allStatus.noneGranted)
    }
}
