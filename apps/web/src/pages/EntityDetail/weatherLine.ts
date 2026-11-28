import { type WeatherSummary, weatherTemperatureText } from '@aurboda/api-spec'

/** E.g. "🌧️ Slight rain · 4–6 °C · 2.3 mm": the condition, the temperature, and the precipitation when there was any. */
export const weatherLine = (summary: WeatherSummary): string => {
  const temperature = weatherTemperatureText(summary.temperature_min, summary.temperature_max)
  const parts = [
    summary.code === null ? undefined : `${summary.emoji} ${summary.condition}`,
    temperature,
    summary.precipitation_sum !== null && summary.precipitation_sum > 0
      ? `${summary.precipitation_sum} mm`
      : undefined,
  ].filter((part): part is string => part !== undefined)
  return parts.join(' · ')
}
