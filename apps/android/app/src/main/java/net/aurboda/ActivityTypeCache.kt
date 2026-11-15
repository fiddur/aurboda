package net.aurboda

import android.content.Context
import android.util.Log
import kotlinx.serialization.encodeToString

private const val TAG = "ActivityTypeCache"
private const val PREFS_NAME = "ActivityTypeCache"
private const val TYPES_KEY = "activity_types"
private const val CUSTOM_METRICS_KEY = "custom_metrics"
private const val ACTIVITY_TYPE_CATALOG_KEY = "activity_type_catalog"
private const val METRIC_CATALOG_KEY = "metric_catalog"

val defaultActivityTypes = listOf(
    ActivityTypeDefinition(name = "sleep", displayName = "Sleep", isBuiltin = true),
    ActivityTypeDefinition(name = "exercise", displayName = "Exercise", isBuiltin = true),
    ActivityTypeDefinition(name = "meditation", displayName = "Meditation", isBuiltin = true),
    ActivityTypeDefinition(name = "nap", displayName = "Nap", isBuiltin = true),
    ActivityTypeDefinition(name = "rest", displayName = "Rest", isBuiltin = true),
)

fun getCachedActivityTypes(context: Context): List<ActivityTypeDefinition> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val json = prefs.getString(TYPES_KEY, null) ?: return defaultActivityTypes
    return try {
        appJson.decodeFromString<List<ActivityTypeDefinition>>(json)
    } catch (e: Exception) {
        Log.e(TAG, "Failed to decode cached activity types", e)
        defaultActivityTypes
    }
}

fun cacheActivityTypes(context: Context, types: List<ActivityTypeDefinition>) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(TYPES_KEY, appJson.encodeToString(types)).apply()
    Log.d(TAG, "Cached ${types.size} activity types")
}

fun getCachedCustomMetrics(context: Context): List<CustomMetricDefinition> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val json = prefs.getString(CUSTOM_METRICS_KEY, null) ?: return emptyList()
    return try {
        appJson.decodeFromString<List<CustomMetricDefinition>>(json)
    } catch (e: Exception) {
        Log.e(TAG, "Failed to decode cached custom metrics", e)
        emptyList()
    }
}

fun cacheCustomMetrics(context: Context, metrics: List<CustomMetricDefinition>) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(CUSTOM_METRICS_KEY, appJson.encodeToString(metrics)).apply()
    Log.d(TAG, "Cached ${metrics.size} custom metrics")
}

fun getCachedActivityTypeCatalog(context: Context): List<CatalogActivityType> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val json = prefs.getString(ACTIVITY_TYPE_CATALOG_KEY, null) ?: return emptyList()
    return try {
        appJson.decodeFromString<List<CatalogActivityType>>(json)
    } catch (e: Exception) {
        Log.e(TAG, "Failed to decode cached activity type catalogue", e)
        emptyList()
    }
}

fun cacheActivityTypeCatalog(context: Context, entries: List<CatalogActivityType>) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(ACTIVITY_TYPE_CATALOG_KEY, appJson.encodeToString(entries)).apply()
    Log.d(TAG, "Cached ${entries.size} activity type catalogue entries")
}

fun getCachedMetricCatalog(context: Context): List<CatalogMetric> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val json = prefs.getString(METRIC_CATALOG_KEY, null) ?: return emptyList()
    return try {
        appJson.decodeFromString<List<CatalogMetric>>(json)
    } catch (e: Exception) {
        Log.e(TAG, "Failed to decode cached metric catalogue", e)
        emptyList()
    }
}

fun cacheMetricCatalog(context: Context, entries: List<CatalogMetric>) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(METRIC_CATALOG_KEY, appJson.encodeToString(entries)).apply()
    Log.d(TAG, "Cached ${entries.size} metric catalogue entries")
}
