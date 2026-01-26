
# PeriodMetricStats

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **metric** | [**MetricType**](MetricType.md) |  |  |
| **unit** | **kotlin.String** | Unit of measurement |  |
| **count** | **kotlin.Int** | Number of data points |  |
| **min** | [**java.math.BigDecimal**](java.math.BigDecimal.md) | Minimum value |  |
| **max** | [**java.math.BigDecimal**](java.math.BigDecimal.md) | Maximum value |  |
| **avg** | [**java.math.BigDecimal**](java.math.BigDecimal.md) | Average value |  |
| **stddev** | [**java.math.BigDecimal**](java.math.BigDecimal.md) | Standard deviation |  |
| **trendPerDay** | [**java.math.BigDecimal**](java.math.BigDecimal.md) |  |  |
| **changeFromPreviousPeriodPercent** | [**java.math.BigDecimal**](java.math.BigDecimal.md) |  |  |
| **completenessPercent** | [**java.math.BigDecimal**](java.math.BigDecimal.md) | Data completeness (days with data / total days) |  |
| **outliers** | [**kotlin.collections.List&lt;Outlier&gt;**](Outlier.md) | Values more than 2 stddev from mean |  [optional] |



