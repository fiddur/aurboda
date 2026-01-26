# TagsApi

All URIs are relative to *https://aurboda.net/api*

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**tagsExternalIdDelete**](TagsApi.md#tagsExternalIdDelete) | **DELETE** /tags/{externalId} | Delete tag |
| [**tagsGet**](TagsApi.md#tagsGet) | **GET** /tags | Get tags |
| [**tagsPost**](TagsApi.md#tagsPost) | **POST** /tags | Add tag |


<a id="tagsExternalIdDelete"></a>
# **tagsExternalIdDelete**
> DeleteTagResponse tagsExternalIdDelete(externalId)

Delete tag

Delete a tag by its external ID.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = TagsApi()
val externalId : kotlin.String = externalId_example // kotlin.String | External ID of the tag to delete
try {
    val result : DeleteTagResponse = apiInstance.tagsExternalIdDelete(externalId)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling TagsApi#tagsExternalIdDelete")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling TagsApi#tagsExternalIdDelete")
    e.printStackTrace()
}
```

### Parameters
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **externalId** | **kotlin.String**| External ID of the tag to delete | |

### Return type

[**DeleteTagResponse**](DeleteTagResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

<a id="tagsGet"></a>
# **tagsGet**
> TagsResponse tagsGet(start, end)

Get tags

Get tags/labels for a time range.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = TagsApi()
val start : java.time.OffsetDateTime =  // java.time.OffsetDateTime | Start date/time
val end : java.time.OffsetDateTime =  // java.time.OffsetDateTime | End date/time
try {
    val result : TagsResponse = apiInstance.tagsGet(start, end)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling TagsApi#tagsGet")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling TagsApi#tagsGet")
    e.printStackTrace()
}
```

### Parameters
| **start** | [**java.time.OffsetDateTime**](.md)| Start date/time | |
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **end** | [**java.time.OffsetDateTime**](.md)| End date/time | |

### Return type

[**TagsResponse**](TagsResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

<a id="tagsPost"></a>
# **tagsPost**
> AddTagResponse tagsPost(addTagBody)

Add tag

Add a manual tag/label to mark an activity or event.

### Example
```kotlin
// Import classes:
//import net.aurboda.api.infrastructure.*
//import net.aurboda.api.models.*

val apiInstance = TagsApi()
val addTagBody : AddTagBody =  // AddTagBody | 
try {
    val result : AddTagResponse = apiInstance.tagsPost(addTagBody)
    println(result)
} catch (e: ClientException) {
    println("4xx response calling TagsApi#tagsPost")
    e.printStackTrace()
} catch (e: ServerException) {
    println("5xx response calling TagsApi#tagsPost")
    e.printStackTrace()
}
```

### Parameters
| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **addTagBody** | [**AddTagBody**](AddTagBody.md)|  | [optional] |

### Return type

[**AddTagResponse**](AddTagResponse.md)

### Authorization


Configure bearerAuth:
    ApiClient.accessToken = ""

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

