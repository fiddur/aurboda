# ActivitiesApi

All URIs are relative to *https://aurboda.net/api*

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**activitiesGet**](ActivitiesApi.md#activitiesGet) | **GET** /activities | Get activities |


<a id="activitiesGet"></a>
# **activitiesGet**
> ActivitiesResponse activitiesGet(start, end, types)

Get activities

Get activities (sleep, exercise, meditation, nap) for a time range.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = ActivitiesApi()
val start : java.time.OffsetDateTime =  // java.time.OffsetDateTime | Start date/time
val end : java.time.OffsetDateTime =  // java.time.OffsetDateTime | End date/time
val types : kotlin.String = types_example // kotlin.String | Comma-separated activity types
try {
    val result : ActivitiesResponse = apiInstance.activitiesGet(start, end, types)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling ActivitiesApi#activitiesGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling ActivitiesApi#activitiesGet")
    e.printStackTrace()
}
```

### Parameters
| **start** | [**java.time.OffsetDateTime**](.md)| Start date/time | |
| **end** | [**java.time.OffsetDateTime**](.md)| End date/time | |
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **types** | **kotlin.String**| Comma-separated activity types | [optional] |

### Return type

[**ActivitiesResponse**](ActivitiesResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

