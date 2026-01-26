# SummaryApi

All URIs are relative to *https://aurboda.net/api*

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**dailySummaryGet**](SummaryApi.md#dailySummaryGet) | **GET** /daily-summary | Get daily summary |
| [**periodSummaryGet**](SummaryApi.md#periodSummaryGet) | **GET** /period-summary | Get period summary |


<a id="dailySummaryGet"></a>
# **dailySummaryGet**
> DailySummaryResponse dailySummaryGet(date)

Get daily summary

Get a comprehensive summary of health data for a specific day including heart rate, steps, sleep, exercise, tags, productivity, and visited places.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = SummaryApi()
val date : java.time.LocalDate = 2013-10-20 // java.time.LocalDate | Date in YYYY-MM-DD format
try {
    val result : DailySummaryResponse = apiInstance.dailySummaryGet(date)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling SummaryApi#dailySummaryGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling SummaryApi#dailySummaryGet")
    e.printStackTrace()
}
```

### Parameters
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **date** | **java.time.LocalDate**| Date in YYYY-MM-DD format | |

### Return type

[**DailySummaryResponse**](DailySummaryResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

<a id="periodSummaryGet"></a>
# **periodSummaryGet**
> PeriodSummaryResponse periodSummaryGet(start, end, metrics)

Get period summary

Get aggregated statistics for a time period. Returns min/max/avg/stddev for each metric, trend compared to previous period, and data completeness.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = SummaryApi()
val start : java.time.OffsetDateTime =  // java.time.OffsetDateTime | Start date/time
val end : java.time.OffsetDateTime =  // java.time.OffsetDateTime | End date/time
val metrics : kotlin.String = metrics_example // kotlin.String | Comma-separated list of metrics
try {
    val result : PeriodSummaryResponse = apiInstance.periodSummaryGet(start, end, metrics)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling SummaryApi#periodSummaryGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling SummaryApi#periodSummaryGet")
    e.printStackTrace()
}
```

### Parameters
| **start** | [**java.time.OffsetDateTime**](.md)| Start date/time | |
| **end** | [**java.time.OffsetDateTime**](.md)| End date/time | |
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **metrics** | **kotlin.String**| Comma-separated list of metrics | |

### Return type

[**PeriodSummaryResponse**](PeriodSummaryResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

