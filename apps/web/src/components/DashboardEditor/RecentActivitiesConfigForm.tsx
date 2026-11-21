import { useQuery } from '@tanstack/react-query'

import { fetchActivityTypeDefinitions } from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { ActivityTypePicker } from '../ActivityTypePicker'
import { type ConfigValues, withConfigValue } from './configValues'
import { RECENT_ACTIVITIES_VISITOR_WARNING, VisibleToVisitorsField } from './VisibleToVisitorsField'
import './RecentActivitiesConfigForm.css'

type SetConfigValues = (update: (prev: ConfigValues) => ConfigValues) => void

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
          <input
            type="number"
            value={(configValues.lookback_days as number | undefined) ?? 30}
            onChange={(e) => set('lookback_days', parseInt((e.target as HTMLInputElement).value, 10))}
            min={1}
            max={365}
          />
        </div>
      )}
      <div class="form-group">
        <label>Limit</label>
        <input
          type="number"
          value={(configValues.limit as number | undefined) ?? 5}
          onChange={(e) => set('limit', parseInt((e.target as HTMLInputElement).value, 10))}
          min={1}
          max={20}
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
