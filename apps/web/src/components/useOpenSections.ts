import { signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import {
  type NavSectionId,
  parseOpenSections,
  sectionForUrl,
  toggleSection,
  withSectionOpen,
} from './nav-links'

const OPEN_SECTIONS_KEY = 'menu-open-sections'

const readStored = (): NavSectionId[] => {
  try {
    return parseOpenSections(localStorage.getItem(OPEN_SECTIONS_KEY))
  } catch {
    return []
  }
}

const store = (open: readonly NavSectionId[]) => {
  try {
    localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(open))
  } catch {
    // Without storage the open sections last for this page view only.
  }
}

// One list for the sidebar and the drawer, which are both mounted (CSS shows one).
const openSections = signal<NavSectionId[]>(readStored())

const update = (change: (current: NavSectionId[]) => NavSectionId[]) => {
  const current = openSections.value
  const next = change(current)
  if (next.length === current.length && next.every((id, i) => id === current[i])) return
  openSections.value = next
  store(next)
}

export const useOpenSections = (
  url: string,
): { open: readonly NavSectionId[]; toggle: (id: NavSectionId) => void } => {
  useEffect(() => {
    const section = sectionForUrl(url)
    if (section) update((current) => withSectionOpen(current, section))
  }, [url])

  return { open: openSections.value, toggle: (id) => update((current) => toggleSection(current, id)) }
}
