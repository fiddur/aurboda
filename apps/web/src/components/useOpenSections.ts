import { useEffect, useState } from 'preact/hooks'

import {
  type NavSectionId,
  parseOpenSections,
  sectionForUrl,
  toggleSection,
  withSectionOpen,
} from './nav-links'

const OPEN_SECTIONS_KEY = 'menu-open-sections'

const readStored = (): NavSectionId[] | null => {
  try {
    return parseOpenSections(localStorage.getItem(OPEN_SECTIONS_KEY))
  } catch {
    return null
  }
}

const store = (open: readonly NavSectionId[]) => {
  try {
    localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(open))
  } catch {
    // Without storage the open sections last for this page view only.
  }
}

/**
 * The open menu sections, kept in storage. The sidebar and the drawer are both mounted (CSS shows one),
 * so each change starts from the stored list rather than this instance's state, lest the hidden menu
 * write back a stale list.
 */
export const useOpenSections = (
  url: string,
): { open: readonly NavSectionId[]; toggle: (id: NavSectionId) => void } => {
  const [open, setOpen] = useState<NavSectionId[]>(() => readStored() ?? [])

  const update = (change: (current: NavSectionId[]) => NavSectionId[]) =>
    setOpen((current) => {
      const next = change(readStored() ?? current)
      store(next)
      return next
    })

  useEffect(() => {
    const section = sectionForUrl(url)
    if (section) update((current) => withSectionOpen(current, section))
  }, [url])

  return { open, toggle: (id) => update((current) => toggleSection(current, id)) }
}
