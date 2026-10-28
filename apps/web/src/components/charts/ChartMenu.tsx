import type { DashboardWidget } from '@aurboda/api-spec'

import { useEffect, useRef, useState } from 'preact/hooks'

import { AddToDashboardModal } from '../AddToDashboardModal'
import './ChartMenu.css'

export interface ChartMenuProps {
  exploreHref?: string
  /** Builds the widget to add; `title` is what the user typed (may be ''), `masked` the masked breakdown fields. */
  widget?: (title: string, masked: string[]) => DashboardWidget
  /** Breakdown fields the Add-to-dashboard dialog offers to mask (defaults to none). */
  breakdownFields?: string[]
  goalHref?: string
}

const NO_FIELDS: string[] = []

const VerticalDots = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="8" cy="3" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="8" cy="13" r="1.5" />
  </svg>
)

/** A ⋮ button with a chart's actions: open it in the Chart Explorer, add it to a dashboard, set a goal on it. */
export function ChartMenu({ exploreHref, widget, breakdownFields = NO_FIELDS, goalHref }: ChartMenuProps) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!exploreHref && !widget && !goalHref) return null

  const close = () => setOpen(false)

  return (
    <div class="chart-menu-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        class="chart-menu-button"
        aria-label="Chart actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <VerticalDots />
      </button>
      {open && (
        <div role="menu" class="chart-menu">
          {exploreHref && (
            <a role="menuitem" class="chart-menu-item" href={exploreHref} onClick={close}>
              Open in Chart Explorer
            </a>
          )}
          {widget && (
            <button
              type="button"
              role="menuitem"
              class="chart-menu-item"
              onClick={() => {
                close()
                setAdding(true)
              }}
            >
              Add to dashboard
            </button>
          )}
          {goalHref && (
            <a role="menuitem" class="chart-menu-item" href={goalHref} onClick={close}>
              Set a goal
            </a>
          )}
        </div>
      )}
      {adding && widget && (
        <AddToDashboardModal
          widget={widget}
          breakdownFields={breakdownFields}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
