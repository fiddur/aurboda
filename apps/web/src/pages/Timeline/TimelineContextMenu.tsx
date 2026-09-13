import { format } from 'date-fns'
import { useLocation } from 'preact-iso'
import { useEffect, useRef } from 'preact/hooks'

import './TimelineContextMenu.css'

interface TimelineContextMenuProps {
  /** Position inside the chart container, in px. */
  x: number
  y: number
  /** The moment every item in the menu acts on. */
  at: Date
  onAddComment: (at: Date) => void
  onClose: () => void
}

/**
 * Right-click / long-press menu on the chart. Everything it offers is about the
 * moment the pointer was over — the Timeline is the place you notice a gap in
 * the record, so this is the shortest path from noticing to filling it.
 */
export const TimelineContextMenu = ({ x, y, at, onAddComment, onClose }: TimelineContextMenuProps) => {
  const { route } = useLocation()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: PointerEvent) => {
      const menu = menuRef.current
      if (menu && event.composedPath().includes(menu)) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const goToAddData = (tab: 'activity' | 'metric') => {
    onClose()
    route(`/add?tab=${tab}&time=${encodeURIComponent(at.toISOString())}`)
  }

  return (
    <div class="timeline-context-menu" ref={menuRef} style={{ left: `${x}px`, top: `${y}px` }}>
      <div class="timeline-context-menu-time">{format(at, 'yyyy-MM-dd HH:mm')}</div>
      <button
        type="button"
        class="timeline-context-menu-item"
        onClick={() => {
          onClose()
          onAddComment(at)
        }}
      >
        💬 Add comment
      </button>
      <button type="button" class="timeline-context-menu-item" onClick={() => goToAddData('activity')}>
        Add activity
      </button>
      <button type="button" class="timeline-context-menu-item" onClick={() => goToAddData('metric')}>
        Add metric
      </button>
    </div>
  )
}
