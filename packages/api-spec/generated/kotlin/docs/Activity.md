
# Activity

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **source** | [**DataSource**](DataSource.md) |  |  |
| **activityType** | [**ActivityType**](ActivityType.md) |  |  |
| **startTime** | [**java.time.OffsetDateTime**](java.time.OffsetDateTime.md) | ISO 8601 date-time string |  |
| **id** | [**java.util.UUID**](java.util.UUID.md) | Activity ID |  [optional] |
| **endTime** | [**java.time.OffsetDateTime**](java.time.OffsetDateTime.md) | ISO 8601 date-time string |  [optional] |
| **duration** | [**java.math.BigDecimal**](java.math.BigDecimal.md) | Duration in minutes |  [optional] |
| **title** | **kotlin.String** | Activity title |  [optional] |
| **notes** | **kotlin.String** | Activity notes |  [optional] |
| **&#x60;data&#x60;** | [**kotlin.collections.Map&lt;kotlin.String, kotlin.Any&gt;**](kotlin.Any.md) |  |  [optional] |
| **hrZoneSecs** | [**HrZoneSecs**](HrZoneSecs.md) | Time spent in each HR zone (for exercise) |  [optional] |



