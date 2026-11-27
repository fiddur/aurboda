import type { DataSource, JournalContextItem, UserSettingsResponse } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'preact/hooks'

import { contextToken } from '../pages/Journal/context-line'
import { apiErrorMessage, fetchJournalContext, updateUserSettings } from '../state/api'
import { browserTimezone } from '../utils/browserTimezone'
import { ActivityTypePicker } from './ActivityTypePicker'
import {
  addItem,
  type ContextKind,
  contextKindLabels,
  itemProblem,
  moveItem,
  removeItem,
  replaceItem,
  withDaysSinceSource,
  withKind,
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

const todayKey = (): string => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

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
      <MetricPicker value={item.metric} onChange={(metric) => onChange({ ...item, metric })} />
    </div>
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
  </div>
)

const PreviewLine = () => {
  const date = todayKey()
  const { data } = useQuery({
    queryFn: () => fetchJournalContext(date, browserTimezone() ?? undefined),
    queryKey: ['journal-context', date],
  })
  if (!data) return null
  return (
    <p class="field-description">
      Preview for today (saved items):{' '}
      {data.items.length === 0 ? (
        'nothing to show'
      ) : (
        <span class="journal-context-preview">
          {data.items.map((item, index) => (
            <span key={item.id}>
              {index > 0 && ', '}
              <span title={item.name}>{contextToken(item)}</span>
            </span>
          ))}
        </span>
      )}
    </p>
  )
}

/** The journal context line: the figures shown under a journal entry for its day. */
export function JournalContextSettings({ settings }: { settings: UserSettingsResponse | undefined }) {
  const queryClient = useQueryClient()
  const saved = settings?.journal_context
  const [items, setItems] = useState<JournalContextItem[]>(saved ?? [])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<SaveStatus>({ status: 'idle' })

  useEffect(() => {
    if (!dirty) setItems(saved ?? [])
  }, [saved, dirty])

  const edit = (next: JournalContextItem[]) => {
    setItems(next)
    setDirty(true)
  }

  const problems = items.map(itemProblem)
  const problem = problems.find((p) => p !== undefined)

  const save = async () => {
    setStatus({ status: 'saving' })
    const sent = items
    try {
      const result = await updateUserSettings({ journal_context: sent })
      queryClient.setQueryData(['userSettings'], result)
      setDirty(itemsRef.current !== sent)
      setStatus({ status: 'saved', time: new Date() })
      void queryClient.invalidateQueries({ queryKey: ['journal-context'] })
    } catch (err) {
      setStatus({ error: apiErrorMessage(err, 'Failed to save'), status: 'error' })
    }
  }

  return (
    <div class="form-field journal-context-settings">
      <h3>Context line</h3>
      <p class="field-description">
        A short line of figures shown under a journal entry's title, computed for the entry's day, e.g. a
        readiness score, a trend, the days since an activity or the moon. An item without a value that day is
        left out.
      </p>
      {items.map((item, index) => (
        <ItemEditor
          key={item.id}
          item={item}
          index={index}
          count={items.length}
          onChange={(next) => edit(replaceItem(items, index, next))}
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
        <button
          type="button"
          class="btn-primary"
          disabled={!dirty || problem !== undefined || status.status === 'saving'}
          onClick={() => void save()}
        >
          Save context line
        </button>
        <SaveStatusIndicator state={status} />
      </div>
      {dirty && problem && <p class="field-description">{problem}</p>}
      <PreviewLine />
    </div>
  )
}
