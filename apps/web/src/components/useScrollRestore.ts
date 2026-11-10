import { useEffect, useRef } from 'preact/hooks'

type ScrollStorage = Pick<Storage, 'getItem' | 'setItem'>

const scrollKey = (key: string) => `aurboda:scroll:${key}`

export const saveScroll = (storage: () => ScrollStorage, key: string, y: number): void => {
  try {
    storage().setItem(scrollKey(key), String(Math.round(y)))
  } catch {
    // Without storage a reloaded tab just opens at the top.
  }
}

export const readScroll = (storage: () => ScrollStorage, key: string): number | undefined => {
  try {
    const y = Number(storage().getItem(scrollKey(key)))
    return Number.isFinite(y) && y > 0 ? y : undefined
  } catch {
    return undefined
  }
}

const sessionStore = () => window.sessionStorage

/** The app shell scrolls `main`, not the window; a page without the shell scrolls the document. */
const scroller = (): Element | null => document.querySelector('main') ?? document.scrollingElement

/**
 * Keeps a period dashboard's scroll position across a reload of its tab (a mobile browser discards
 * background tabs): saved per `scope` and shown period when the tab is hidden or left, and restored
 * once per mount, as soon as the period is known — which is when its data is there.
 */
export const useScrollRestore = (scope: string, period: string | null | undefined): void => {
  const restored = useRef(false)
  const key = period ? `${scope}:${period}` : null

  useEffect(() => {
    if (key === null) return
    const save = () => saveScroll(sessionStore, key, scroller()?.scrollTop ?? 0)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') save()
    }
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      save()
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [key])

  useEffect(() => {
    if (restored.current || key === null) return
    restored.current = true
    const y = readScroll(sessionStore, key)
    if (y === undefined) return
    requestAnimationFrame(() => {
      const el = scroller()
      if (el) el.scrollTop = y
    })
  }, [key])
}
