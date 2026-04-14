import type { FunctionComponent } from 'preact'

import { useQueryClient } from '@tanstack/react-query'

import type { Orientation } from './types'

interface TimelineControlsProps {
  orientation: Orientation
  setOrientation: (o: Orientation) => void
  isFullscreen: boolean
  setIsFullscreen: (fn: (v: boolean) => boolean) => void
  handleJumpDays: (days: number) => void
  handleResetToToday: () => void
  viewLabel: string
  isFetching: boolean
}

export const TimelineControls: FunctionComponent<TimelineControlsProps> = ({
  orientation,
  setOrientation,
  isFullscreen,
  setIsFullscreen,
  handleJumpDays,
  handleResetToToday,
  viewLabel,
  isFetching,
}) => {
  const queryClient = useQueryClient()

  return (
    <div class="timeline-controls">
      <div class="timeline-nav">
        <button class="nav-btn" onClick={() => handleJumpDays(-30)} title="Back 1 month">
          {'<<'}
        </button>
        <button class="nav-btn" onClick={() => handleJumpDays(-1)} title="Back 1 day">
          {'<'}
        </button>
        <button class="nav-btn nav-today" onClick={handleResetToToday}>
          Today
        </button>
        <button class="nav-btn" onClick={() => handleJumpDays(1)} title="Forward 1 day">
          {'>'}
        </button>
        <button class="nav-btn" onClick={() => handleJumpDays(30)} title="Forward 1 month">
          {'>>'}
        </button>
      </div>
      <span class="timeline-date-label">{viewLabel}</span>
      <button
        class={`nav-btn timeline-refresh-btn${isFetching ? ' timeline-refresh-spinning' : ''}`}
        disabled={isFetching}
        onClick={() =>
          queryClient.invalidateQueries({
            predicate: (query) =>
              typeof query.queryKey[0] === 'string' && (query.queryKey[0] as string).startsWith('timeline-'),
          })
        }
        title={isFetching ? 'Loading...' : 'Refresh data'}
        type="button"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M21 21v-5h-5" />
        </svg>
      </button>

      <div class="timeline-orientation-toggle">
        <button
          class="nav-btn"
          onClick={() => setOrientation(orientation === 'vertical' ? 'horizontal' : 'vertical')}
          title={orientation === 'vertical' ? 'Switch to horizontal layout' : 'Switch to vertical layout'}
          type="button"
        >
          {orientation === 'vertical' ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="7" y="2" width="10" height="14" rx="2" />
              <path d="M19 17a7 7 0 0 1-7 5" />
              <polyline points="16 21 19 17 23 19" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="2" y="7" width="14" height="10" rx="2" />
              <path d="M17 19a7 7 0 0 1-5 -7" />
              <polyline points="21 16 17 19 19 23" />
            </svg>
          )}
        </button>
        <button
          class="nav-btn timeline-fullscreen-btn"
          onClick={() => setIsFullscreen((v) => !v)}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
          type="button"
        >
          {isFullscreen ? '\u2921' : '\u26F6'}
        </button>
      </div>
    </div>
  )
}
