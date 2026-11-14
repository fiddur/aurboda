import { itemPageHref } from '../../components/sessions/sessionView'

export const STRENGTH_TYPE = 'strength_training'
export const SETS_PATH = 'sets.exercise'

export const exerciseItemUrl = (exercise: string): string => itemPageHref(STRENGTH_TYPE, SETS_PATH, exercise)

export const sessionUrl = (id: string): string => `/strength/session/${encodeURIComponent(id)}`

export const detailUrl = (id: string): string => `/detail/activity/${encodeURIComponent(id)}`

export const STRENGTH_QUERY_KEYS = [
  'activity-sessions',
  'activity-item-history',
  'activity-field-values',
  'activity-records',
  'activity-neighbors',
  'chart-data',
  'activities',
  'dayview-activities',
  'data-activities',
  'entity-detail',
  'strength-start',
]
