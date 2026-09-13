import type * as d3 from 'd3'

import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import type { Orientation } from './types'

import { pointerOffset, timeAtOffset } from './contextMenuTime'

/** How long a touch must rest before it counts as a long-press. */
const LONG_PRESS_MS = 500
/** A touch that wanders further than this is a pan, not a long-press. */
const LONG_PRESS_MOVE_TOLERANCE_PX = 8
/** Rough menu size — the chart container clips its overflow, so keep the menu inside it. */
const MENU_WIDTH_PX = 180
const MENU_HEIGHT_PX = 140

export interface TimelineContextMenuState {
  /** Position inside the chart container, in px. */
  x: number
  y: number
  /** The moment the pointer was over when the menu opened. */
  at: Date
}

/** Structural ref shapes — compatible with both preact's `useRef` and `RefObject`. */
export interface UseTimelineContextMenuConfig {
  containerRef: { readonly current: HTMLDivElement | null }
  orientationRef: { readonly current: Orientation }
  currentScaleRef: { readonly current: d3.ScaleTime<number, number> | null }
}

/**
 * Right-click (desktop) or long-press (touch) anywhere on the chart to act on
 * the moment under the pointer. The live zoom scale is read from a ref so the
 * picked time follows whatever the user has panned/zoomed to, without the
 * handlers being rebuilt on every redraw.
 */
export const useTimelineContextMenu = ({
  containerRef,
  orientationRef,
  currentScaleRef,
}: UseTimelineContextMenuConfig) => {
  const [menu, setMenu] = useState<TimelineContextMenuState | null>(null)
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)

  const cancelLongPress = useCallback(() => {
    if (!longPressRef.current) return
    clearTimeout(longPressRef.current.timer)
    longPressRef.current = null
  }, [])

  useEffect(() => cancelLongPress, [cancelLongPress])

  const openAt = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current
      const scale = currentScaleRef.current
      if (!container || !scale) return
      const rect = container.getBoundingClientRect()
      const at = timeAtOffset(pointerOffset({ clientX, clientY }, rect, orientationRef.current), scale)
      setMenu({
        at,
        x: Math.max(0, Math.min(clientX - rect.left, rect.width - MENU_WIDTH_PX)),
        y: Math.max(0, Math.min(clientY - rect.top, rect.height - MENU_HEIGHT_PX)),
      })
    },
    [containerRef, currentScaleRef, orientationRef],
  )

  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault()
      cancelLongPress()
      openAt(event.clientX, event.clientY)
    },
    [cancelLongPress, openAt],
  )

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      cancelLongPress()
      if (event.pointerType !== 'touch') return
      const { clientX, clientY } = event
      longPressRef.current = {
        timer: setTimeout(() => {
          longPressRef.current = null
          openAt(clientX, clientY)
        }, LONG_PRESS_MS),
        x: clientX,
        y: clientY,
      }
    },
    [cancelLongPress, openAt],
  )

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const pending = longPressRef.current
      if (!pending) return
      const moved = Math.hypot(event.clientX - pending.x, event.clientY - pending.y)
      if (moved > LONG_PRESS_MOVE_TOLERANCE_PX) cancelLongPress()
    },
    [cancelLongPress],
  )

  const close = useCallback(() => setMenu(null), [])

  return { cancelLongPress, close, menu, onContextMenu, onPointerDown, onPointerMove }
}
