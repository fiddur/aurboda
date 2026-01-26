# LocationsApi

All URIs are relative to *https://aurboda.net/api*

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**locationsDetectedGet**](LocationsApi.md#locationsDetectedGet) | **GET** /locations/detected | Get detected locations |
| [**locationsDetectedPromotePost**](LocationsApi.md#locationsDetectedPromotePost) | **POST** /locations/detected/promote | Promote detected location |
| [**locationsDetectedStoredGet**](LocationsApi.md#locationsDetectedStoredGet) | **GET** /locations/detected/stored | Get stored detected locations |
| [**locationsGet**](LocationsApi.md#locationsGet) | **GET** /locations | Get place visits |
| [**locationsNamedGet**](LocationsApi.md#locationsNamedGet) | **GET** /locations/named | Get named locations |
| [**locationsNamedIdDelete**](LocationsApi.md#locationsNamedIdDelete) | **DELETE** /locations/named/{id} | Delete named location |
| [**locationsNamedIdPatch**](LocationsApi.md#locationsNamedIdPatch) | **PATCH** /locations/named/{id} | Update named location |
| [**locationsNamedPost**](LocationsApi.md#locationsNamedPost) | **POST** /locations/named | Add named location |


<a id="locationsDetectedGet"></a>
# **locationsDetectedGet**
> DetectedLocationsResponse locationsDetectedGet(start, end, minDuration)

Get detected locations

Get frequently visited locations that are not yet named. Detects places where user spent 60+ minutes.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = LocationsApi()
val start : java.time.OffsetDateTime =  // java.time.OffsetDateTime | Start date/time
val end : java.time.OffsetDateTime =  // java.time.OffsetDateTime | End date/time
val minDuration : java.math.BigDecimal = 8.14 // java.math.BigDecimal | Minimum stay duration in minutes
try {
    val result : DetectedLocationsResponse = apiInstance.locationsDetectedGet(start, end, minDuration)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling LocationsApi#locationsDetectedGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling LocationsApi#locationsDetectedGet")
    e.printStackTrace()
}
```

### Parameters
| **start** | [**java.time.OffsetDateTime**](.md)| Start date/time | |
| **end** | [**java.time.OffsetDateTime**](.md)| End date/time | |
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **minDuration** | **java.math.BigDecimal**| Minimum stay duration in minutes | [optional] |

### Return type

[**DetectedLocationsResponse**](DetectedLocationsResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

<a id="locationsDetectedPromotePost"></a>
# **locationsDetectedPromotePost**
> AddNamedLocationResponse locationsDetectedPromotePost(promoteDetectedLocationBody)

Promote detected location

Create a named location from detected coordinates.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = LocationsApi()
val promoteDetectedLocationBody : PromoteDetectedLocationBody =  // PromoteDetectedLocationBody | 
try {
    val result : AddNamedLocationResponse = apiInstance.locationsDetectedPromotePost(promoteDetectedLocationBody)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling LocationsApi#locationsDetectedPromotePost")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling LocationsApi#locationsDetectedPromotePost")
    e.printStackTrace()
}
```

### Parameters
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **promoteDetectedLocationBody** | [**PromoteDetectedLocationBody**](PromoteDetectedLocationBody.md)|  | [optional] |

### Return type

[**AddNamedLocationResponse**](AddNamedLocationResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

<a id="locationsDetectedStoredGet"></a>
# **locationsDetectedStoredGet**
> DetectedLocationsResponse locationsDetectedStoredGet()

Get stored detected locations

Get all stored detected locations with visit statistics.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = LocationsApi()
try {
    val result : DetectedLocationsResponse = apiInstance.locationsDetectedStoredGet()
    println(result)
} catch (e: ClientException) {
    println("4xx response calling LocationsApi#locationsDetectedStoredGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling LocationsApi#locationsDetectedStoredGet")
    e.printStackTrace()
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**DetectedLocationsResponse**](DetectedLocationsResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

<a id="locationsGet"></a>
# **locationsGet**
> LocationsResponse locationsGet(start, end)

Get place visits

Get place visits for a time range.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = LocationsApi()
val start : java.time.OffsetDateTime =  // java.time.OffsetDateTime | Start date/time
val end : java.time.OffsetDateTime =  // java.time.OffsetDateTime | End date/time
try {
    val result : LocationsResponse = apiInstance.locationsGet(start, end)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling LocationsApi#locationsGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling LocationsApi#locationsGet")
    e.printStackTrace()
}
```

### Parameters
| **start** | [**java.time.OffsetDateTime**](.md)| Start date/time | |
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **end** | [**java.time.OffsetDateTime**](.md)| End date/time | |

### Return type

[**LocationsResponse**](LocationsResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

<a id="locationsNamedGet"></a>
# **locationsNamedGet**
> NamedLocationsResponse locationsNamedGet()

Get named locations

Get all user-defined named locations.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = LocationsApi()
try {
    val result : NamedLocationsResponse = apiInstance.locationsNamedGet()
    println(result)
} catch (e: ClientException) {
    println("4xx response calling LocationsApi#locationsNamedGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling LocationsApi#locationsNamedGet")
    e.printStackTrace()
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**NamedLocationsResponse**](NamedLocationsResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

<a id="locationsNamedIdDelete"></a>
# **locationsNamedIdDelete**
> DeleteResponse locationsNamedIdDelete(id)

Delete named location

Delete a named location by its ID.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = LocationsApi()
val id : java.util.UUID = 38400000-8cf0-11bd-b23e-10b96e4ef00d // java.util.UUID | Location ID
try {
    val result : DeleteResponse = apiInstance.locationsNamedIdDelete(id)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling LocationsApi#locationsNamedIdDelete")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling LocationsApi#locationsNamedIdDelete")
    e.printStackTrace()
}
```

### Parameters
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **id** | **java.util.UUID**| Location ID | |

### Return type

[**DeleteResponse**](DeleteResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

<a id="locationsNamedIdPatch"></a>
# **locationsNamedIdPatch**
> AddNamedLocationResponse locationsNamedIdPatch(id, updateNamedLocationBody)

Update named location

Update an existing named location.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = LocationsApi()
val id : java.util.UUID = 38400000-8cf0-11bd-b23e-10b96e4ef00d // java.util.UUID | Location ID
val updateNamedLocationBody : UpdateNamedLocationBody =  // UpdateNamedLocationBody | 
try {
    val result : AddNamedLocationResponse = apiInstance.locationsNamedIdPatch(id, updateNamedLocationBody)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling LocationsApi#locationsNamedIdPatch")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling LocationsApi#locationsNamedIdPatch")
    e.printStackTrace()
}
```

### Parameters
| **id** | **java.util.UUID**| Location ID | |
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **updateNamedLocationBody** | [**UpdateNamedLocationBody**](UpdateNamedLocationBody.md)|  | [optional] |

### Return type

[**AddNamedLocationResponse**](AddNamedLocationResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

<a id="locationsNamedPost"></a>
# **locationsNamedPost**
> AddNamedLocationResponse locationsNamedPost(addNamedLocationBody)

Add named location

Create a named location.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = LocationsApi()
val addNamedLocationBody : AddNamedLocationBody =  // AddNamedLocationBody | 
try {
    val result : AddNamedLocationResponse = apiInstance.locationsNamedPost(addNamedLocationBody)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling LocationsApi#locationsNamedPost")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling LocationsApi#locationsNamedPost")
    e.printStackTrace()
}
```

### Parameters
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **addNamedLocationBody** | [**AddNamedLocationBody**](AddNamedLocationBody.md)|  | [optional] |

### Return type

[**AddNamedLocationResponse**](AddNamedLocationResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

