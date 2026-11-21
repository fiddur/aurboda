import { menuPath } from '../../components/nav-links'

export type StrengthTabId = 'train' | 'progress' | 'exercises' | 'muscles'

export const STRENGTH_TABS: { href: string; id: StrengthTabId; label: string }[] = [
  { href: '/strength', id: 'train', label: 'Train' },
  { href: '/strength/progress', id: 'progress', label: 'Progress' },
  { href: '/strength/exercises', id: 'exercises', label: 'Exercises' },
  { href: '/strength/muscles', id: 'muscles', label: 'Muscles' },
]

export const strengthTabForPath = (url: string): StrengthTabId | undefined => {
  const path = menuPath(url)
  return STRENGTH_TABS.find((t) => t.href === path)?.id
}
