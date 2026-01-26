# SyncApi

All URIs are relative to *https://aurboda.net/api*

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**syncOuraPost**](SyncApi.md#syncOuraPost) | **POST** /sync/oura | Sync Oura data |
| [**syncRescuetimePost**](SyncApi.md#syncRescuetimePost) | **POST** /sync/rescuetime | Sync RescueTime data |
| [**syncStatusGet**](SyncApi.md#syncStatusGet) | **GET** /sync/status | Get sync status |


<a id="syncOuraPost"></a>
# **syncOuraPost**
> SyncResponse syncOuraPost(syncOuraBody)

Sync Oura data

Sync data from Oura Ring API. Fetches cardiovascular age, readiness, resilience, sleep scores, meditation sessions, and tags.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = SyncApi()
val syncOuraBody : SyncOuraBody =  // SyncOuraBody | 
try {
    val result : SyncResponse = apiInstance.syncOuraPost(syncOuraBody)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling SyncApi#syncOuraPost")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling SyncApi#syncOuraPost")
    e.printStackTrace()
}
```

### Parameters
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **syncOuraBody** | [**SyncOuraBody**](SyncOuraBody.md)|  | [optional] |

### Return type

[**SyncResponse**](SyncResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

<a id="syncRescuetimePost"></a>
# **syncRescuetimePost**
> SyncResponse syncRescuetimePost(syncRescueTimeBody)

Sync RescueTime data

Sync productivity data from RescueTime API. Fetches application and website usage with productivity scores.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = SyncApi()
val syncRescueTimeBody : SyncRescueTimeBody =  // SyncRescueTimeBody | 
try {
    val result : SyncResponse = apiInstance.syncRescuetimePost(syncRescueTimeBody)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling SyncApi#syncRescuetimePost")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling SyncApi#syncRescuetimePost")
    e.printStackTrace()
}
```

### Parameters
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **syncRescueTimeBody** | [**SyncRescueTimeBody**](SyncRescueTimeBody.md)|  | [optional] |

### Return type

[**SyncResponse**](SyncResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

<a id="syncStatusGet"></a>
# **syncStatusGet**
> SyncStatusResponse syncStatusGet(provider)

Get sync status

Get the current sync status for Oura and RescueTime data sources. Shows last sync time, status, and any errors.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = SyncApi()
val provider : kotlin.String = provider_example // kotlin.String | Provider to check
try {
    val result : SyncStatusResponse = apiInstance.syncStatusGet(provider)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling SyncApi#syncStatusGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling SyncApi#syncStatusGet")
    e.printStackTrace()
}
```

### Parameters
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **provider** | **kotlin.String**| Provider to check | [optional] [enum: oura, rescuetime, all] |

### Return type

[**SyncStatusResponse**](SyncStatusResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

