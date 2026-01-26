# ProductivityApi

All URIs are relative to *https://aurboda.net/api*

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**productivityGet**](ProductivityApi.md#productivityGet) | **GET** /productivity | Get productivity data |


<a id="productivityGet"></a>
# **productivityGet**
> ProductivityResponse productivityGet(start, end)

Get productivity data

Get RescueTime productivity data for a time range.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = ProductivityApi()
val start : java.time.OffsetDateTime =  // java.time.OffsetDateTime | Start date/time
val end : java.time.OffsetDateTime =  // java.time.OffsetDateTime | End date/time
try {
    val result : ProductivityResponse = apiInstance.productivityGet(start, end)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling ProductivityApi#productivityGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling ProductivityApi#productivityGet")
    e.printStackTrace()
}
```

### Parameters
| **start** | [**java.time.OffsetDateTime**](.md)| Start date/time | |
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **end** | [**java.time.OffsetDateTime**](.md)| End date/time | |

### Return type

[**ProductivityResponse**](ProductivityResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

