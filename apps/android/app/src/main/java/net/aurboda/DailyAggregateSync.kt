package net.aurboda

import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import io.ktor.client.HttpClient
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import net.aurboda.api.models.DailyAggregate
import net.aurboda.api.models.DailyAggregatesBody
import java.time.LocalDate
import java.time.ZoneId
import kotlin.reflect.KClass

private const val TAG = "DailyAggregateSync"

/** Describes a cumulative metric that can be aggregated from Health Connect. */
data class AggregatableMetric(
  val aggregateMetric: AggregateMetric<*>,
  val dailyMetric: DailyAggregate.Metric,
  val recordClass: KClass<out Record>,
)

/** All cumulative metrics we aggregate from Health Connect. */
val allAggregatableMetrics: List<AggregatableMetric> =
  listOf(
    AggregatableMetric(StepsRecord.COUNT_TOTAL, DailyAggregate.Metric.steps, StepsRecord::class),
    AggregatableMetric(DistanceRecord.DISTANCE_TOTAL, DailyAggregate.Metric.distance, DistanceRecord::class),
    AggregatableMetric(
      ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL,
      DailyAggregate.Metric.calories_active,
      ActiveCaloriesBurnedRecord::class,
    ),
    AggregatableMetric(TotalCaloriesBurnedRecord.ENERGY_TOTAL, DailyAggregate.Metric.calories_total, TotalCaloriesBurnedRecord::class),
    AggregatableMetric(FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL, DailyAggregate.Metric.floors_climbed, FloorsClimbedRecord::class),
  )

/**
 * Fetch daily aggregates for cumulative metrics using Health Connect's aggregate() API.
 * Only fetches for metrics whose record classes are in [grantedTypes].
 */
suspend fun fetchDailyAggregates(
  healthConnectClient: HealthConnectClient,
  grantedTypes: Set<KClass<out Record>>,
  days: Int = 7,
): List<DailyAggregate> {
  val activeMetrics = allAggregatableMetrics.filter { it.recordClass in grantedTypes }
  if (activeMetrics.isEmpty()) {
    Log.d(TAG, "No aggregatable metrics have granted permissions")
    return emptyList()
  }

  val aggregates = mutableListOf<DailyAggregate>()
  val today = LocalDate.now()
  val zoneId = ZoneId.systemDefault()

  for (dayOffset in 0 until days) {
    val date = today.minusDays(dayOffset.toLong())
    val startTime = date.atStartOfDay(zoneId).toInstant()
    val endTime = date.plusDays(1).atStartOfDay(zoneId).toInstant()

    for ((metric, metricType, _) in activeMetrics) {
      try {
        val request =
          AggregateRequest(
            metrics = setOf(metric),
            timeRangeFilter = TimeRangeFilter.between(startTime, endTime),
          )
        val result = healthConnectClient.aggregate(request)

        // Extract value based on metric type
        val value: Double? =
          when (metric) {
            StepsRecord.COUNT_TOTAL -> result[StepsRecord.COUNT_TOTAL]?.toDouble()
            DistanceRecord.DISTANCE_TOTAL -> result[DistanceRecord.DISTANCE_TOTAL]?.inMeters
            ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL ->
              result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories
            TotalCaloriesBurnedRecord.ENERGY_TOTAL ->
              result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories
            FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL ->
              result[FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL]
            else -> null
          }

        if (value != null && value > 0) {
          val dataOrigins = result.dataOrigins.map { it.packageName }
          aggregates.add(
            DailyAggregate(
              date = date.toString(), // YYYY-MM-DD format
              metric = metricType,
              value = value,
              dataOrigins = dataOrigins,
            ),
          )
          Log.d(TAG, "Aggregate for $metricType on $date: $value from ${dataOrigins.size} sources")
        } else {
          Log.d(TAG, "No data for $metricType on $date (value=$value)")
        }
      } catch (e: Exception) {
        Log.w(TAG, "Failed to fetch aggregate for $metricType on $date: ${e.message}", e)
      }
    }
  }

  Log.d(TAG, "Fetched ${aggregates.size} aggregates for ${activeMetrics.size} metrics over $days days")
  return aggregates
}

/**
 * Send daily aggregates to the backend.
 * @return true if successful (including when there's nothing to send), false on failure.
 */
suspend fun sendDailyAggregates(
  aggregates: List<DailyAggregate>,
  serverUrl: String,
  authToken: String,
  httpClient: HttpClient,
): Boolean {
  if (aggregates.isEmpty()) {
    Log.d(TAG, "No aggregates to send")
    return true
  }

  val postData = DailyAggregatesBody(data = aggregates)
  return try {
    val response =
      httpClient.post("$serverUrl/sync/daily-aggregates") {
        contentType(ContentType.Application.Json)
        headers { append(HttpHeaders.Authorization, "Bearer $authToken") }
        setBody(postData)
      }
    Log.d(TAG, "Daily aggregates response: ${response.status} (${aggregates.size} aggregates)")
    response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created
  } catch (e: Exception) {
    Log.e(TAG, "Error posting daily aggregates: ${e.message}", e)
    false
  }
}
