
# PlaceVisit

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **name** | **kotlin.String** | Place name |  |
| **startTime** | [**java.time.OffsetDateTime**](java.time.OffsetDateTime.md) | ISO 8601 date-time string |  |
| **endTime** | [**java.time.OffsetDateTime**](java.time.OffsetDateTime.md) | ISO 8601 date-time string |  |
| **duration** | [**java.math.BigDecimal**](java.math.BigDecimal.md) | Duration in minutes |  |
| **source** | [**PlaceSource**](PlaceSource.md) |  |  |
| **lat** | [**java.math.BigDecimal**](java.math.BigDecimal.md) | Latitude |  [optional] |
| **lon** | [**java.math.BigDecimal**](java.math.BigDecimal.md) | Longitude |  [optional] |
| **address** | **kotlin.String** | Geocoded address |  [optional] |
| **detectedLocationId** | [**java.util.UUID**](java.util.UUID.md) | ID of detected location if source is detected |  [optional] |



