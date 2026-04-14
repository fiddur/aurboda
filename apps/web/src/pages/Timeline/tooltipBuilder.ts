import { format } from 'date-fns'

import type { Activity } from '../../state/api'
import type { ChartItem } from './types'

import { hrZoneColors } from './colors'
import { escapeHtml, formatDuration } from './formatting'

export type SleepMetrics = Record<string, number>
export type SleepMetricsByDate = Map<string, SleepMetrics>

export const buildSleepDetails = (a: Activity, end: Date, sleepByDate: SleepMetricsByDate): string[] => {
  const details: string[] = []
  details.push(`Bed: ${formatDuration(a.start_time, end)}`)

  if (a.total_sleep !== undefined) {
    const h = Math.floor(a.total_sleep / 60)
    const m = a.total_sleep % 60
    details.push(`Sleep: ${m > 0 ? `${h}h ${m}m` : `${h}h`}`)
  }

  const sleepData = sleepByDate.get(format(end, 'yyyy-MM-dd'))
  if (sleepData) {
    if (sleepData.sleep_score !== undefined) details.push(`Score: ${Math.round(sleepData.sleep_score)}`)
    if (sleepData.sleep_efficiency !== undefined) {
      details.push(`Efficiency: ${Math.round(sleepData.sleep_efficiency)}%`)
    }
    if (sleepData.sleep_restfulness !== undefined) {
      details.push(`Restfulness: ${Math.round(sleepData.sleep_restfulness)}`)
    }
    if (sleepData.sleep_deep_score !== undefined) {
      details.push(`Deep: ${Math.round(sleepData.sleep_deep_score)}`)
    }
    if (sleepData.sleep_rem_score !== undefined) details.push(`REM: ${Math.round(sleepData.sleep_rem_score)}`)
  }

  if (a.avg_hrv) details.push(`Avg HRV: ${a.avg_hrv} ms`)
  return details
}

export const buildHrZoneBarHtml = (zones: Record<number, number>): string => {
  const total = Object.values(zones).reduce((s, v) => s + v, 0)
  if (total <= 0) return ''
  let html = '<div class="hr-zone-bar">'
  for (let z = 0; z <= 5; z++) {
    const pct = ((zones[z] ?? 0) / total) * 100
    if (pct > 0) {
      html += `<span style="width:${pct}%;background:${hrZoneColors[z]}"></span>`
    }
  }
  return html + '</div>'
}

export const buildTooltipHtml = (item: ChartItem, music: string[], activities: Activity[]): string => {
  const datePrefix = format(item.start, 'EEE d MMM')
  let html = `<div class="tooltip-title">${escapeHtml(item.tooltip.title)}</div>`
  html += `<div class="tooltip-time">${escapeHtml(datePrefix)} · ${escapeHtml(item.tooltip.time)}</div>`
  for (const d of item.tooltip.details) {
    html += `<div class="tooltip-detail">${escapeHtml(d)}</div>`
  }

  if (item.activity_type === 'exercise') {
    const activity = activities.find(
      (a) => a.activity_type === 'exercise' && a.start_time.getTime() === item.start.getTime(),
    )
    const zones = activity?.hr_zone_secs as Record<number, number> | undefined
    if (zones) html += buildHrZoneBarHtml(zones)
  }

  if (music.length > 0) {
    const musicList = music.slice(0, 3).join(', ')
    const suffix = music.length > 3 ? ` +${music.length - 3} more` : ''
    html += `<div class="tooltip-music">♪ ${escapeHtml(musicList + suffix)}</div>`
  }

  return html
}
