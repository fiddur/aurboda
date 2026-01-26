# SettingsApi

All URIs are relative to *https://aurboda.net/api*

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**userSettingsGet**](SettingsApi.md#userSettingsGet) | **GET** /user/settings | Get user settings |
| [**userSettingsPatch**](SettingsApi.md#userSettingsPatch) | **PATCH** /user/settings | Update user settings |


<a id="userSettingsGet"></a>
# **userSettingsGet**
> UserSettingsResponse userSettingsGet()

Get user settings

Get user settings including birth date and effective HR zones. HR zones are used to calculate time spent in different heart rate zones during exercise.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = SettingsApi()
try {
    val result : UserSettingsResponse = apiInstance.userSettingsGet()
    println(result)
} catch (e: ClientException) {
    println("4xx response calling SettingsApi#userSettingsGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling SettingsApi#userSettingsGet")
    e.printStackTrace()
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**UserSettingsResponse**](UserSettingsResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

<a id="userSettingsPatch"></a>
# **userSettingsPatch**
> UserSettingsResponse userSettingsPatch(updateSettingsInput)

Update user settings

Update user settings. Can set birth date (for age-based HR zones) and/or custom HR zone thresholds.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = SettingsApi()
val updateSettingsInput : UpdateSettingsInput =  // UpdateSettingsInput | 
try {
    val result : UserSettingsResponse = apiInstance.userSettingsPatch(updateSettingsInput)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling SettingsApi#userSettingsPatch")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling SettingsApi#userSettingsPatch")
    e.printStackTrace()
}
```

### Parameters
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **updateSettingsInput** | [**UpdateSettingsInput**](UpdateSettingsInput.md)|  | [optional] |

### Return type

[**UserSettingsResponse**](UserSettingsResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

