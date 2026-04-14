import { getExerciseTypeName as getExerciseTypeNameFromValue } from '@aurboda/api-spec'
import { format } from 'date-fns'

import type { Activity } from '../../state/api'

export const formatTime = (date: Date): string => format(date, 'HH:mm')

export const formatDuration = (start: Date, end: Date): string => {
  const ms = end.getTime() - start.getTime()
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export const formatExerciseType = (name: string): string => name.replaceAll('_', ' ')

export const getExerciseTypeName = (activity: Activity): string => {
  const data = activity.data as Record<string, unknown> | undefined
  const typeName = data?.exerciseTypeName as string | undefined
  if (typeName) return formatExerciseType(typeName)
  const typeValue = data?.exerciseType as number | undefined
  if (typeValue !== undefined) {
    const name = getExerciseTypeNameFromValue(typeValue)
    if (name) return formatExerciseType(name)
  }
  return activity.title || 'Workout'
}

export const escapeHtml = (str: string): string =>
  str.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
