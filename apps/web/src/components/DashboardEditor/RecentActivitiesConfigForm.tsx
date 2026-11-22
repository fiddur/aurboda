import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { fetchActivityTypeDefinitions } from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { ActivityTypePicker } from '../ActivityTypePicker'
import { clampInt, type ConfigValues, withConfigValue } from './configValues'
import { RECENT_ACTIVITIES_VISITOR_WARNING, VisibleToVisitorsField } from './VisibleToVisitorsField'
import './RecentActivitiesConfigForm.css'

type SetConfigValues = (update: (prev: ConfigValues) => ConfigValues) => void

// The bounds of recentActivitiesConfigSchema, which rejects a save outside them.
const LIMIT_RANGE = [1, 20] as const
const LOOKBACK_DAYS_RANGE = [1, 365] as const

// Clamped on blur, not per keystroke (compat turns onChange into onInput), so the field can be
// cleared and retyped; a field left blank drops the key and shows the default again.
function ClampedNumberInput({
  defaultValue,
  onCommit,
  range: [min, max],
  value,
}: {
  defaultValue: number
  onCommit: (value: number) => void
  range: readonly [number, number]
  value: number | undefined
}) {
  const shown = String(value ?? defaultValue)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  return (
    <input
      type="number"
      value={draft}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => {
        const next = clampInt(parseInt(draft, 10), min, max)
        setDraft(String(Number.isNaN(next) ? defaultValue : next))
        onCommit(next)
      }}
      min={min}
      max={max}
    />
  )
}

function TypeChips({ onChange, types }: { onChange: (types: string[]) => void; types: string[] }) {
  const { data: defs = [] } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 30 * 60 * 1000,
  })
  const nameOf = (type: string) => defs.find((d) => d.name === type)?.display_name ?? toDisplayName(type)
  return (
    <>
      {types.length > 0 && (
        <div class="recent-activities-type-chips">
          {types.map((type) => (
            <span key={type} class="recent-activities-type-chip">
              {nameOf(type)}
              <button
                type="button"
                title={`Remove ${nameOf(type)}`}
                onClick={() => onChange(types.filter((t) => t !== type))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <ActivityTypePicker
        value=""
        onChange={(type) => {
          if (type && !types.includes(type)) onChange([...types, type])
        }}
        placeholder="Add an activity type"
      />
    </>
  )
}

export function RecentActivitiesConfigForm({
  configValues,
  periodMode,
  setConfigValues,
  sharedBoard,
}: {
  configValues: ConfigValues
  periodMode: boolean
  setConfigValues: SetConfigValues
  sharedBoard: boolean
}) {
  const set = (key: string, value: unknown) => setConfigValues((prev) => withConfigValue(prev, key, value))
  const window = (configValues.window as string | undefined) ?? 'today'
  const types = (configValues.types as string[] | undefined) ?? []

  return (
    <div class="config-form">
      {!periodMode && (
        <div class="form-group">
          <label>Window</label>
          <select
            value={window}
            onChange={(e) => {
              const next = (e.target as HTMLSelectElement).value
              setConfigValues((prev) =>
                withConfigValue(
                  next === 'latest' ? prev : withConfigValue(prev, 'lookback_days', undefined),
                  'window',
                  next,
                ),
              )
            }}
          >
            <option value="today">Today</option>
            <option value="latest">Latest</option>
          </select>
        </div>
      )}
      {!periodMode && window === 'latest' && (
        <div class="form-group">
          <label>Look back (days)</label>
          <ClampedNumberInput
            value={configValues.lookback_days as number | undefined}
            defaultValue={30}
            range={LOOKBACK_DAYS_RANGE}
            onCommit={(value) => set('lookback_days', value)}
          />
        </div>
      )}
      <div class="form-group">
        <label>Limit</label>
        <ClampedNumberInput
          value={configValues.limit as number | undefined}
          defaultValue={5}
          range={LIMIT_RANGE}
          onCommit={(value) => set('limit', value)}
        />
      </div>
      <div class="form-group">
        <label>Activity types</label>
        <TypeChips types={types} onChange={(next) => set('types', next)} />
        <p class="recent-activities-form-hint">
          Subtypes count. None chosen: the activities a day overview shows, without sleep, screen time, music
          and other tags.
        </p>
      </div>
      <div class="form-group">
        <label>
          <input
            type="checkbox"
            checked={configValues.manual_only === true}
            onChange={(e) => set('manual_only', (e.target as HTMLInputElement).checked)}
          />{' '}
          Only activities logged by hand
        </label>
      </div>
      <div class="form-group">
        <label>Title</label>
        <input
          type="text"
          value={(configValues.title as string | undefined) ?? ''}
          onChange={(e) => {
            const value = (e.target as HTMLInputElement).value
            set('title', value.trim() ? value : undefined)
          }}
          placeholder="Today or Latest activities"
        />
      </div>
      {sharedBoard && (
        <VisibleToVisitorsField
          checked={configValues.visible_to_visitors === true}
          onChange={(checked) => set('visible_to_visitors', checked)}
          warning={RECENT_ACTIVITIES_VISITOR_WARNING}
        />
      )}
    </div>
  )
}
