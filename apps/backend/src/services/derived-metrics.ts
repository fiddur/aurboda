/**
 * Dashboard metrics that are not stored series but follow from one over the days ending on a day: the mean of
 * its daily values, or its total scaled to the unit the dashboard card shows.
 */
export interface DerivedMetric {
  days: number
  metric: string
  /** A series whose samples are averaged instead when it has any in the window and no source is asked for. */
  prefer?: string
  reduce: 'mean' | 'sum'
  scale: number
}

const derivedMetrics: Record<string, DerivedMetric> = {
  hrv_7day: { days: 7, metric: 'hrv_rmssd', prefer: 'hrv_sleep', reduce: 'mean', scale: 1 },
  hrv_30day: { days: 30, metric: 'hrv_rmssd', prefer: 'hrv_sleep', reduce: 'mean', scale: 1 },
  rhr_7day: { days: 7, metric: 'resting_heart_rate', reduce: 'mean', scale: 1 },
  rhr_30day: { days: 30, metric: 'resting_heart_rate', reduce: 'mean', scale: 1 },
  zone2_weekly: { days: 7, metric: 'hr_zone_2_sec', reduce: 'sum', scale: 1 / 60 },
}

export const derivedMetric = (name: string): DerivedMetric | undefined =>
  Object.hasOwn(derivedMetrics, name) ? derivedMetrics[name] : undefined
