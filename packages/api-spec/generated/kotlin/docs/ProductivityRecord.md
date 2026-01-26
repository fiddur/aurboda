
# ProductivityRecord

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **startTime** | [**java.time.OffsetDateTime**](java.time.OffsetDateTime.md) | ISO 8601 date-time string |  |
| **endTime** | [**java.time.OffsetDateTime**](java.time.OffsetDateTime.md) | ISO 8601 date-time string |  |
| **activity** | **kotlin.String** | Activity/application name |  |
| **durationSec** | **kotlin.Int** | Duration in seconds |  |
| **source** | [**DataSource**](DataSource.md) |  |  [optional] |
| **category** | **kotlin.String** | Activity category |  [optional] |
| **productivity** | **kotlin.Int** | Productivity score (-2 to 2) |  [optional] |
| **isMobile** | **kotlin.Boolean** | Whether activity was on mobile |  [optional] |



