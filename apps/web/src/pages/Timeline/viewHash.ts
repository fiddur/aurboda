import { endOfDay, startOfDay } from 'date-fns'

import type { Orientation } from './types'

import { LEGACY_CATEGORY_MAP, type LegendCategory } from './legendCategories'

export const getDefaultOrientation = (): Orientation =>
  typeof window !== 'undefined' && window.innerWidth >= window.innerHeight ? 'horizontal' : 'vertical'

export const getDefaultViewStart = (): Date => startOfDay(new Date())
export const getDefaultViewEnd = (): Date => endOfDay(new Date())

/** Parse window.location.hash into view state. */
export const parseViewHash = (): {
  from: Date | null
  to: Date | null
  hide: LegendCategory[]
  orientation: Orientation | null
} => {
  const hash = window.location.hash.slice(1)
  if (!hash) return { from: null, hide: [], orientation: null, to: null }
  const params = new URLSearchParams(hash)
  const fromStr = params.get('from')
  const toStr = params.get('to')
  const hideStr = params.get('hide')
  const oStr = params.get('o')
  const from = fromStr ? new Date(fromStr) : null
  const to = toStr ? new Date(toStr) : null
  const hide = hideStr
    ? ([
        ...new Set(
          hideStr
            .split(',')
            .filter(Boolean)
            .map((c) => LEGACY_CATEGORY_MAP[c] ?? c),
        ),
      ] as LegendCategory[])
    : []
  const orientation: Orientation | null = oStr === 'h' ? 'horizontal' : oStr === 'v' ? 'vertical' : null
  return {
    from: from && !isNaN(from.getTime()) ? from : null,
    hide,
    orientation,
    to: to && !isNaN(to.getTime()) ? to : null,
  }
}

/** Build hash string from current view state. */
export const buildViewHash = (
  start: Date | null,
  end: Date | null,
  hidden: ReadonlySet<string>,
  orientation: Orientation,
): string => {
  const params = new URLSearchParams()
  if (start) params.set('from', start.toISOString())
  if (end) params.set('to', end.toISOString())
  if (hidden.size > 0) params.set('hide', [...hidden].join(','))
  // Only write orientation when it differs from the viewport default
  const defaultO = getDefaultOrientation()
  if (orientation !== defaultO) params.set('o', orientation === 'horizontal' ? 'h' : 'v')
  const str = params.toString()
  return str ? `#${str}` : ''
}
