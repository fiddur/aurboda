import type { FunctionComponent, RefObject } from 'preact'

import type { LegendCategory } from './legendCategories'
import type { Orientation } from './types'

import {
  activityColors,
  hrZoneColors,
  MUSIC_COLOR,
  placeColorPalette,
  productivityColors,
  TAG_COLOR,
  tagSourceColors,
} from './colors'
import { CALORIES_COLOR, HR_COLOR, HRV_COLOR, STEPS_COLOR, STRESS_COLOR } from './drawMetricsTrack'
import { SCREENTIME_COLOR } from './drawScreentimeTrack'
import { CTL_COLOR } from './drawTrainingLoadTrack'

interface TimelineLegendProps {
  orientation: Orientation
  hiddenCategories: Set<LegendCategory>
  toggleCategory: (cat: LegendCategory) => void
  hasLastFm: boolean
  legendCollapsed: boolean
  setLegendCollapsed: (fn: (v: boolean) => boolean) => void
  legendRef: RefObject<HTMLDivElement>
}

export const TimelineLegend: FunctionComponent<TimelineLegendProps> = ({
  orientation,
  hiddenCategories,
  toggleCategory,
  hasLastFm,
  legendCollapsed,
  setLegendCollapsed,
  legendRef,
}) => {
  const hiddenCount = hiddenCategories.size

  return (
    <div class={`timeline-legend-wrapper${legendCollapsed ? ' collapsed' : ''}`}>
      <button
        class="timeline-legend-toggle"
        onClick={() => setLegendCollapsed((v) => !v)}
        type="button"
        title={legendCollapsed ? 'Show legend' : 'Hide legend'}
      >
        Legend{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}{' '}
        <span class="dropdown-arrow">{legendCollapsed ? '\u25BE' : '\u25B4'}</span>
      </button>
      {!legendCollapsed && (
        <div class="timeline-legend" ref={legendRef}>
          {/* ── Music (top-level) ── */}
          {hasLastFm && (
            <>
              <button
                key="music"
                class={`legend-item${hiddenCategories.has('music') ? ' legend-item-hidden' : ''}`}
                onClick={() => toggleCategory('music')}
                type="button"
              >
                <span class="legend-dot" style={{ background: MUSIC_COLOR }} />
                Music
              </button>
              <span class="legend-separator" />
            </>
          )}

          {/* ── Activity group ── */}
          <div class="legend-group">
            <button
              key="activity"
              class={`legend-item legend-group-header${hiddenCategories.has('activity') ? ' legend-item-hidden' : ''}`}
              onClick={() => toggleCategory('activity')}
              type="button"
            >
              <span class="legend-dot" style={{ background: activityColors.sleep! }} />
              Activity
            </button>
            {[
              { cat: 'sleep_rest' as LegendCategory, color: activityColors.sleep!, label: 'Sleep/Nap/Rest' },
              { cat: 'meditation' as LegendCategory, color: activityColors.meditation!, label: 'Meditation' },
              { cat: 'exercise' as LegendCategory, color: hrZoneColors[2]!, label: 'Exercise' },
              { cat: 'other' as LegendCategory, color: TAG_COLOR, label: 'Other' },
              { cat: 'calendar' as LegendCategory, color: tagSourceColors.calendar!, label: 'Calendar' },
              { cat: 'screentime' as LegendCategory, color: productivityColors[1]!, label: 'Screen Time' },
            ].map(({ cat, color, label }) => (
              <button
                key={cat}
                class={`legend-item legend-sub-item${hiddenCategories.has('activity') ? ' legend-sub-item--disabled' : ''}${hiddenCategories.has(cat) ? ' legend-item-hidden' : ''}`}
                onClick={() => toggleCategory(cat)}
                type="button"
              >
                <span class="legend-dot legend-dot-small" style={{ background: color }} />
                {label}
              </button>
            ))}
          </div>

          <span class="legend-separator" />

          {/* ── Metrics group ── */}
          <div class="legend-group">
            <button
              key="metrics"
              class={`legend-item legend-group-header${hiddenCategories.has('metrics') ? ' legend-item-hidden' : ''}`}
              onClick={() => toggleCategory('metrics')}
              type="button"
            >
              <span class="legend-dot" style={{ background: HR_COLOR }} />
              Metrics
            </button>
            {[
              { cat: 'hr' as LegendCategory, color: HR_COLOR, label: 'HR' },
              { cat: 'hrv' as LegendCategory, color: HRV_COLOR, label: 'HRV' },
              { cat: 'stress' as LegendCategory, color: STRESS_COLOR, label: 'Stress' },
              ...(orientation === 'horizontal'
                ? [
                    { cat: 'steps' as LegendCategory, color: STEPS_COLOR, label: 'Steps' },
                    { cat: 'calories' as LegendCategory, color: CALORIES_COLOR, label: 'Calories' },
                    { cat: 'training_load' as LegendCategory, color: CTL_COLOR, label: 'Training Load' },
                    { cat: 'screen_time_h' as LegendCategory, color: SCREENTIME_COLOR, label: 'Screen Time' },
                  ]
                : []),
            ].map(({ cat, color, label }) => (
              <button
                key={cat}
                class={`legend-item legend-sub-item${hiddenCategories.has('metrics') ? ' legend-sub-item--disabled' : ''}${hiddenCategories.has(cat) ? ' legend-item-hidden' : ''}`}
                onClick={() => toggleCategory(cat)}
                type="button"
              >
                <span class="legend-dot legend-dot-small" style={{ background: color }} />
                {label}
              </button>
            ))}
          </div>

          <span class="legend-separator" />

          {/* ── Location (top-level) ── */}
          <button
            key="location"
            class={`legend-item${hiddenCategories.has('location') ? ' legend-item-hidden' : ''}`}
            onClick={() => toggleCategory('location')}
            type="button"
          >
            <span class="legend-dot" style={{ background: placeColorPalette[0]! }} />
            Location
          </button>
        </div>
      )}
    </div>
  )
}
