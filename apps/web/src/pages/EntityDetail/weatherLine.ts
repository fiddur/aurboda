import type { WeatherSummary } from '@aurboda/api-spec'

/** Whole degrees: one value when the lowest and highest round alike, else the range. */
const temperatures = ({ temperature_max, temperature_min }: WeatherSummary): string | undefined => {
  if (temperature_min === null || temperature_max === null) return undefined
  const low = Math.round(temperature_min) + 0
  const high = Math.round(temperature_max) + 0
  return low === high ? `${low} °C` : `${low}–${high} °C`
}

/** E.g. "🌧️ Slight rain · 4–6 °C · 2.3 mm": the condition, the temperature, and the precipitation when there was any. */
export const weatherLine = (summary: WeatherSummary): string => {
  const temperature = temperatures(summary)
  const parts = [
    summary.code === null ? undefined : `${summary.emoji} ${summary.condition}`,
    temperature,
    summary.precipitation_sum !== null && summary.precipitation_sum > 0
      ? `${summary.precipitation_sum} mm`
      : undefined,
  ].filter((part): part is string => part !== undefined)
  return parts.join(' · ')
}
