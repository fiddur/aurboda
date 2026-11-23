import { menuPath } from '../../components/nav-links'

export type StrengthTabId = 'muscles' | 'workouts' | 'progress' | 'exercises'

export const STRENGTH_TABS: { href: string; id: StrengthTabId; label: string }[] = [
  { href: '/strength', id: 'muscles', label: 'Muscles' },
  { href: '/strength/workouts', id: 'workouts', label: 'Workouts' },
  { href: '/strength/progress', id: 'progress', label: 'Progress' },
  { href: '/strength/exercises', id: 'exercises', label: 'Exercises' },
]

export const strengthTabForPath = (url: string): StrengthTabId | undefined => {
  const path = menuPath(url)
  return STRENGTH_TABS.find((t) => t.href === path)?.id
}

export const musclesRedirectTarget = (url: string): string => {
  const query = url.indexOf('?')
  return query === -1 ? '/strength' : `/strength${url.slice(query)}`
}
