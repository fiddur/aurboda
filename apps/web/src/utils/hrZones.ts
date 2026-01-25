import type { HrZoneThresholds, PeriodMetricStats } from '../state/api'

// Default HR zone thresholds (matching Android app)
export const defaultHrZoneThresholds: HrZoneThresholds = {
  1: 86,
  2: 102,
  3: 118,
  4: 135,
  5: 151,
}

// Weekly target minutes per zone (matching Android app)
// Based on Galpin/Huberman recommendations
export const hrZoneWeeklyTargetMinutes = [0, 60, 200, 60, 30, 10]

// HR Zone colors (matching Android app)
export const hrZoneColors = [
  '#9E9E9E', // Zone 0: Gray - Below threshold
  '#64B5F6', // Zone 1: Light Blue - Warm-up
  '#4CAF50', // Zone 2: Green - Aerobic
  '#FFC107', // Zone 3: Amber - Tempo
  '#FF9800', // Zone 4: Orange - Threshold
  '#F44336', // Zone 5: Red - Max effort
]

/**
 * Format seconds as human-readable time string
 * @param seconds - Time in seconds
 * @returns Formatted string like "1 h 30 min" or "45 min"
 */
export const formatZoneTime = (seconds: number): string => {
  const totalMinutes = Math.floor(seconds / 60)
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60)
    const mins = totalMinutes % 60
    return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`
  }
  return `${totalMinutes} min`
}

/**
 * Format BPM range string for a given HR zone
 * @param zoneIndex - Zone index (0-5)
 * @param thresholds - HR zone thresholds
 * @returns Formatted string like "102 - 117 bpm"
 */
export const formatBpmRange = (zoneIndex: number, thresholds: HrZoneThresholds): string => {
  const zoneStarts = [0, thresholds[1], thresholds[2], thresholds[3], thresholds[4], thresholds[5]]
  switch (zoneIndex) {
    case 0:
      return `< ${thresholds[1]} bpm`
    case 5:
      return `${thresholds[5]}+ bpm`
    default:
      return `${zoneStarts[zoneIndex]} - ${zoneStarts[zoneIndex + 1] - 1} bpm`
  }
}

/**
 * Find metric time in seconds from a list of period metrics
 * @param metrics - List of period metric stats
 * @param metricName - Name of the metric to find
 * @returns Time in seconds (avg value) or 0 if not found
 */
export const findMetricTimeSeconds = (metrics: PeriodMetricStats[], metricName: string): number => {
  const metric = metrics.find((m) => m.metric === metricName)
  return metric?.avg ?? 0
}

/**
 * Calculate date range for last 7 days (including today)
 * Returns stable date strings suitable for use as query keys
 */
export const getWeekDateRange = (): { start: string; end: string } => {
  const today = new Date()
  const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)

  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - 6)
  startDate.setHours(0, 0, 0, 0)

  return {
    end: endDate.toISOString(),
    start: startDate.toISOString(),
  }
}
