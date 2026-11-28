import type { DataSource, JournalContextItem, UserSettingsResponse } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { ContextTokens } from '../pages/Journal/ContextTokens'
import {
  apiErrorMessage,
  fetchActivityTypeDefinitions,
  fetchJournalContext,
  updateUserSettings,
} from '../state/api'
import { browserTimezone } from '../utils/browserTimezone'
import { ActivityTypePicker } from './ActivityTypePicker'
import {
  addItem,
  autosaveStep,
  type ContextKind,
  contextKindLabels,
  type IconSources,
  itemsToSaveOnClose,
  metricCarriesForward,
  metricHasSource,
  moveItem,
  removeItem,
  replaceItem,
  withDaysSinceSource,
  withKind,
  withMetric,
  withSuggestedLabel,
} from './journal-context-form'
import { MetricPicker } from './MetricPicker'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import './JournalContextSettings.css'

const kinds = Object.keys(contextKindLabels) as ContextKind[]

const metricSources: DataSource[] = [
  'oura',
  'garmin',
  'health_connect',
  'health_connect_aggregate',
  'strava',
  'gravl',
  'home_assistant',
  'lab_report',
  'manual',
  'aurboda',
]

const AUTOSAVE_DELAY_MS = 600

const inputValue = (e: Event): string => (e.target as HTMLInputElement | HTMLSelectElement).value

type Change = (item: JournalContextItem) => void

const MetricFields = ({
  item,
  onChange,
}: {
  item: Extract<JournalContextItem, { kind: 'metric' }>
  onChange: Change
}) => (
  <>
    <div class="form-group">
      <label>Metric</label>
      <MetricPicker value={item.metric} onChange={(metric) => onChange(withMetric(item, metric))} />
    </div>
    {metricHasSource(item.metric) && (
      <div class="form-group">
        <label>Source</label>
        <select
          value={item.source ?? ''}
          onChange={(e) =>
            onChange({ ...item, source: (inputValue(e) || undefined) as DataSource | undefined })
          }
        >
          <option value="">Any</option>
          {metricSources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </div>
    )}
    {metricCarriesForward(item.metric) && (
      <div class="form-group">
        <label>No value that day</label>
        <select
          value={item.missing}
          onChange={(e) => onChange({ ...item, missing: inputValue(e) as typeof item.missing })}
        >
          <option value="hide">Leave it out</option>
          <option value="carry_forward">Show the latest earlier value</option>
        </select>
      </div>
    )}
  </>
)

const TrendFields = ({
  item,
  onChange,
}: {
  item: Extract<JournalContextItem, { kind: 'trend' }>
  onChange: Change
}) => (
  <>
    <div class="form-group">
      <label>Source Type</label>
      <select
        value={item.source_type}
        onChange={(e) =>
          onChange({ ...item, pattern: '', source_type: inputValue(e) as typeof item.source_type })
        }
      >
        <option value="activity_type">Activity Type</option>
        <option value="tag">Tag</option>
        <option value="metric">Metric</option>
      </select>
    </div>
    <div class="form-group">
      <label>{item.source_type === 'metric' ? 'Metric' : 'Pattern'}</label>
      {item.source_type === 'metric' ? (
        <MetricPicker value={item.pattern} onChange={(pattern) => onChange({ ...item, pattern })} />
      ) : (
        <ActivityTypePicker value={item.pattern} onChange={(pattern) => onChange({ ...item, pattern })} />
      )}
    </div>
    <div class="form-group">
      <label>Display Period</label>
      <select
        value={item.display_period ?? 'monthly'}
        onChange={(e) => onChange({ ...item, display_period: inputValue(e) as typeof item.display_period })}
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
    </div>
    <div class="form-group">
      <label>Half-life (days)</label>
      <input
        type="number"
        min={1}
        value={item.half_life_days ?? 15}
        onChange={(e) => {
          const days = parseInt(inputValue(e), 10)
          onChange({ ...item, half_life_days: days > 0 ? days : undefined })
        }}
      />
    </div>
  </>
)

const DaysSinceFields = ({
  item,
  onChange,
}: {
  item: Extract<JournalContextItem, { kind: 'days_since' }>
  onChange: Change
}) => (
  <>
    <div class="form-group">
      <label>Since</label>
      <select
        value={item.source_type}
        onChange={(e) => onChange(withDaysSinceSource(item, inputValue(e) as typeof item.source_type))}
      >
        <option value="activity_type">Last activity</option>
        <option value="tag">Last tag</option>
        <option value="date">Fixed date</option>
      </select>
    </div>
    {item.source_type === 'date' ? (
      <div class="form-group">
        <label>Date</label>
        <input
          type="date"
          value={item.date ?? ''}
          onChange={(e) => onChange({ ...item, date: inputValue(e) || undefined })}
        />
      </div>
    ) : (
      <div class="form-group">
        <label>Activity type or tag</label>
        <ActivityTypePicker
          value={item.pattern ?? ''}
          onChange={(pattern) => onChange({ ...item, pattern })}
        />
      </div>
    )}
    <div class="form-group">
      <label>Unit</label>
      <select
        value={item.unit}
        onChange={(e) => onChange({ ...item, unit: inputValue(e) as typeof item.unit })}
      >
        <option value="days">Days</option>
        <option value="weeks">Weeks</option>
        <option value="years">Years</option>
      </select>
    </div>
  </>
)

const MoonFields = ({
  item,
  onChange,
}: {
  item: Extract<JournalContextItem, { kind: 'moon' }>
  onChange: Change
}) => (
  <div class="form-group">
    <label>Show</label>
    <select
      value={item.value}
      onChange={(e) => onChange({ ...item, value: inputValue(e) as typeof item.value })}
    >
      <option value="illumination">Illumination (%)</option>
      <option value="age_percent">Age (% of cycle)</option>
      <option value="age_days">Age (days)</option>
    </select>
  </div>
)

const TrainingLoadFields = ({
  item,
  onChange,
}: {
  item: Extract<JournalContextItem, { kind: 'training_load' }>
  onChange: Change
}) => (
  <div class="form-group">
    <label>Show</label>
    <select
      value={item.value}
      onChange={(e) => onChange({ ...item, value: inputValue(e) as typeof item.value })}
    >
      <option value="ctl">Fitness (CTL)</option>
      <option value="atl">Fatigue (ATL)</option>
      <option value="tsb">Form (TSB)</option>
    </select>
  </div>
)

const WeatherFields = ({
  item,
  onChange,
}: {
  item: Extract<JournalContextItem, { kind: 'weather' }>
  onChange: Change
}) => (
  <div class="form-group">
    <label>
      <input
        type="checkbox"
        checked={item.show_temperature}
        onChange={(e) => onChange({ ...item, show_temperature: (e.target as HTMLInputElement).checked })}
      />{' '}
      Show temperature
    </label>
    <p class="field-description">
      Needs the <a href="/data-sources/weather">Weather</a> data source. An entry with a time shows the
      weather of its hour, a day entry the day's.
    </p>
  </div>
)

const KindFields = ({ item, onChange }: { item: JournalContextItem; onChange: Change }) => {
  switch (item.kind) {
    case 'metric':
      return <MetricFields item={item} onChange={onChange} />
    case 'trend':
      return <TrendFields item={item} onChange={onChange} />
    case 'days_since':
      return <DaysSinceFields item={item} onChange={onChange} />
    case 'moon':
      return <MoonFields item={item} onChange={onChange} />
    case 'training_load':
      return <TrainingLoadFields item={item} onChange={onChange} />
    case 'weather':
      return <WeatherFields item={item} onChange={onChange} />
  }
}

const ItemEditor = ({
  item,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  item: JournalContextItem
  index: number
  count: number
  onChange: Change
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}) => (
  <div class="journal-context-item">
    <div class="journal-context-item-head">
      <select
        aria-label="Kind"
        value={item.kind}
        onChange={(e) => onChange(withKind(item, inputValue(e) as ContextKind))}
      >
        {kinds.map((kind) => (
          <option key={kind} value={kind}>
            {contextKindLabels[kind]}
          </option>
        ))}
      </select>
      <span class="journal-context-item-actions">
        <button
          type="button"
          class="btn-secondary"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          class="btn-secondary"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          aria-label="Move down"
        >
          ↓
        </button>
        <button type="button" class="btn-danger-small" onClick={onRemove}>
          Remove
        </button>
      </span>
    </div>
    <div class="journal-context-item-fields">
      <KindFields item={item} onChange={onChange} />
    </div>
    <div class="journal-context-item-look">
      <input
        type="text"
        aria-label="Label"
        placeholder="Label"
        maxLength={12}
        class="journal-context-label"
        value={item.label}
        onInput={(e) => onChange({ ...item, label: inputValue(e) })}
      />
      <label class="journal-context-decimals">
        Decimals
        <input
          type="number"
          min={0}
          max={3}
          value={item.decimals}
          onChange={(e) =>
            onChange({ ...item, decimals: Math.min(3, Math.max(0, parseInt(inputValue(e), 10) || 0)) })
          }
        />
      </label>
    </div>
  </div>
)

const PreviewLine = ({ date }: { date: string }) => {
  const { data } = useQuery({
    queryFn: () => fetchJournalContext(date, browserTimezone() ?? undefined),
    queryKey: ['journal-context', date],
  })
  if (!data) return null
  return (
    <p class="field-description">
      Preview for this entry's day, {date} (saved items):{' '}
      {data.items.length === 0 ? (
        'nothing to show'
      ) : (
        <span class="journal-context-preview">
          <ContextTokens context={data} />
        </span>
      )}
    </p>
  )
}

const useIconSources = (settings: UserSettingsResponse | undefined): IconSources => {
  const { data: typeDefs } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 30 * 60 * 1000,
  })
  return useMemo(
    () => ({
      itemIcons: settings?.item_icons ?? {},
      typeIcons: new Map((typeDefs ?? []).map((def) => [def.name, def.icon])),
    }),
    [settings?.item_icons, typeDefs],
  )
}

/**
 * The journal context line's editor: the figures shown under a journal entry for its day. Changes save by
 * themselves once every item is complete; `date` is the day the preview is for.
 */
export function JournalContextSettings({
  settings,
  date,
}: {
  settings: UserSettingsResponse | undefined
  date: string
}) {
  const queryClient = useQueryClient()
  const saved = settings?.journal_context
  const [items, setItems] = useState<JournalContextItem[]>(saved ?? [])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const savedRef = useRef(JSON.stringify(saved ?? []))
  const editedRef = useRef(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const closingRef = useRef(false)
  const [status, setStatus] = useState<SaveStatus>({ status: 'idle' })
  const icons = useIconSources(settings)

  useEffect(() => {
    if (editedRef.current) return
    setItems(saved ?? [])
    savedRef.current = JSON.stringify(saved ?? [])
  }, [saved])

  const edit = (next: JournalContextItem[]) => {
    editedRef.current = true
    setItems(next)
  }

  const save = async (sent: JournalContextItem[]) => {
    savingRef.current = true
    if (mountedRef.current) setStatus({ status: 'saving' })
    try {
      const result = await updateUserSettings({ journal_context: sent })
      savedRef.current = JSON.stringify(sent)
      queryClient.setQueryData(['userSettings'], result)
      void queryClient.invalidateQueries({ queryKey: ['journal-context'] })
      savingRef.current = false
      if (mountedRef.current) setStatus({ status: 'saved', time: new Date() })
      runAutosave()
    } catch (err) {
      savingRef.current = false
      if (mountedRef.current) setStatus({ error: apiErrorMessage(err, 'Failed to save'), status: 'error' })
    }
  }

  const runAutosave = () => {
    const current = closingRef.current ? itemsToSaveOnClose(itemsRef.current) : itemsRef.current
    const step = autosaveStep(current, savedRef.current, savingRef.current)
    if (step.action === 'save') void save(step.items)
  }
  const runAutosaveRef = useRef(runAutosave)
  runAutosaveRef.current = runAutosave

  useEffect(() => {
    if (!editedRef.current) return
    const timer = setTimeout(() => runAutosaveRef.current(), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [items])

  useEffect(
    () => () => {
      mountedRef.current = false
      closingRef.current = true
      if (editedRef.current) runAutosaveRef.current()
    },
    [],
  )

  const pending = autosaveStep(items, savedRef.current, true)
  const problem = pending.action === 'blocked' ? pending.problem : undefined

  return (
    <div class="form-field journal-context-settings">
      <p class="field-description">
        A short line of figures shown under a journal entry's title, computed for the entry's day, e.g. a
        readiness score, a trend, the days since an activity, the moon or the weather. An item without a value
        that day is left out. Changes are saved as you make them.
      </p>
      {items.map((item, index) => (
        <ItemEditor
          key={item.id}
          item={item}
          index={index}
          count={items.length}
          onChange={(next) => edit(replaceItem(items, index, withSuggestedLabel(item, next, icons)))}
          onMove={(by) => edit(moveItem(items, index, by))}
          onRemove={() => edit(removeItem(items, index))}
        />
      ))}
      <div class="journal-context-actions">
        <select
          aria-label="Add an item"
          value=""
          onChange={(e) => {
            const kind = inputValue(e) as ContextKind
            if (kind) edit(addItem(items, kind))
          }}
        >
          <option value="">Add an item…</option>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {contextKindLabels[kind]}
            </option>
          ))}
        </select>
        <SaveStatusIndicator state={status} />
        {status.status === 'error' && (
          <button type="button" class="btn-secondary" onClick={() => runAutosave()}>
            Retry
          </button>
        )}
      </div>
      {problem && <p class="field-description">{problem}</p>}
      <PreviewLine date={date} />
    </div>
  )
}
