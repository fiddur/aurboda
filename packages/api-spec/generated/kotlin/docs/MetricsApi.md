# MetricsApi

All URIs are relative to *https://aurboda.net/api*

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**metricsMetricGet**](MetricsApi.md#metricsMetricGet) | **GET** /metrics/{metric} | Query time series metrics |
| [**metricsPost**](MetricsApi.md#metricsPost) | **POST** /metrics | Add manual metric |


<a id="metricsMetricGet"></a>
# **metricsMetricGet**
> QueryMetricsResponse metricsMetricGet(metric, start, end)

Query time series metrics

Query health metrics for a time range. Returns time series data with timestamps and values.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = MetricsApi()
val metric : MetricType =  // MetricType | Type of health metric
val start : java.time.OffsetDateTime =  // java.time.OffsetDateTime | Start date/time
val end : java.time.OffsetDateTime =  // java.time.OffsetDateTime | End date/time
try {
    val result : QueryMetricsResponse = apiInstance.metricsMetricGet(metric, start, end)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling MetricsApi#metricsMetricGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling MetricsApi#metricsMetricGet")
    e.printStackTrace()
}
```

### Parameters
| **metric** | [**MetricType**](.md)| Type of health metric | [enum: heart_rate, resting_heart_rate, hrv_rmssd, weight, body_fat, bone_mass, lean_body_mass, body_water_mass, height, steps, distance, floors_climbed, calories_active, calories_total, calories_basal, spo2, respiratory_rate, body_temperature, basal_body_temperature, blood_glucose, blood_pressure_systolic, blood_pressure_diastolic, vo2_max, readiness_score, resilience_score, productivity_score, cardiovascular_age, sleep_score, sleep_efficiency, sleep_latency, sleep_restfulness, sleep_timing, sleep_deep_score, sleep_rem_score, sleep_total_score, hr_zone_0_sec, hr_zone_1_sec, hr_zone_2_sec, hr_zone_3_sec, hr_zone_4_sec, hr_zone_5_sec] |
| **start** | [**java.time.OffsetDateTime**](.md)| Start date/time | |
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **end** | [**java.time.OffsetDateTime**](.md)| End date/time | |

### Return type

[**QueryMetricsResponse**](QueryMetricsResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

<a id="metricsPost"></a>
# **metricsPost**
> AddMetricResponse metricsPost(addMetricBody)

Add manual metric

Add a manual health metric measurement.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = MetricsApi()
val addMetricBody : AddMetricBody =  // AddMetricBody | 
try {
    val result : AddMetricResponse = apiInstance.metricsPost(addMetricBody)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling MetricsApi#metricsPost")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling MetricsApi#metricsPost")
    e.printStackTrace()
}
```

### Parameters
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **addMetricBody** | [**AddMetricBody**](AddMetricBody.md)|  | [optional] |

### Return type

[**AddMetricResponse**](AddMetricResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

