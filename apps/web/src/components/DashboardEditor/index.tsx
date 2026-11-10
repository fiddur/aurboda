import {
  activityMeasureLabels,
  type DashboardWidget,
  recordMeasures,
  type SectionType,
} from '@aurboda/api-spec'
import { useState } from 'preact/hooks'

import { getMetricDisplayName } from '../../utils/metricLabels'
import { ActivityTypePicker } from '../ActivityTypePicker'
import { MetricPicker } from '../MetricPicker'
import { offeredWidgetTypes } from './periodWidgets'
import { blankRequiredFields } from './requiredConfig'
import './style.css'

interface DashboardEditorProps {
  sectionId: string
  sectionType: SectionType
  onAddWidget: (widget: DashboardWidget) => void
  onClose: () => void
  /** A period dashboard: hide the widgets that have no meaning for a past period. */
  periodMode?: boolean
}

const metricCardUnits: Record<string, string> = {
  body_fat: '%',
  hrv_30day: 'ms',
  hrv_7day: 'ms',
  rhr_30day: 'bpm',
  rhr_7day: 'bpm',
  weight: 'kg',
  zone2_weekly: 'min',
}

const generateWidgetId = () => `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

interface WidgetTemplate {
  type: DashboardWidget['type']
  label: string
  description: string
  defaultConfig: () => DashboardWidget['config']
  allowedSections: SectionType[]
}

const widgetTemplates: WidgetTemplate[] = [
  {
    allowedSections: ['metrics'],
    defaultConfig: () => ({
      metric: 'hrv_7day',
      title: 'HRV (7-day)',
      unit: 'ms',
    }),
    description: 'Display a single metric value with optional trend',
    label: 'Metric Card',
    type: 'metric_card',
  },
  {
    allowedSections: ['metrics'],
    defaultConfig: () => ({
      color: '#3b82f6',
      lookback_days: 30,
      metric: 'sleep_score',
    }),
    description: 'Metric value with a mini chart',
    label: 'Sparkline Card',
    type: 'sparkline_card',
  },
  {
    allowedSections: ['metrics'],
    defaultConfig: () => ({}),
    description: 'Latest sleep: score, stages, vitals',
    label: 'Last night',
    type: 'last_sleep',
  },
  {
    allowedSections: ['metrics'],
    defaultConfig: () => ({
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
    }),
    description: 'Best value of an activity measure, with the date it was reached',
    label: 'Record Card',
    type: 'record_card',
  },
  {
    allowedSections: ['metrics', 'charts'],
    defaultConfig: () => ({
      lookback_days: 30,
      pattern: 'exercise',
    }),
    description: 'Sessions, time, distance and pace of one activity type; sleep stages for sleep',
    label: 'Activity card',
    type: 'activity_type_card',
  },
  {
    allowedSections: ['metrics'],
    defaultConfig: () => ({ limit: 3, source: 'media_artist' }),
    description: 'Total music plays, screen time or place visits, with the top entries',
    label: 'Top list',
    type: 'top_list_card',
  },
  {
    allowedSections: ['metrics'],
    defaultConfig: () => ({}),
    description: 'Nights at home and away, distinct places and the most visited',
    label: 'Places card',
    type: 'places_card',
  },
  {
    allowedSections: ['metrics', 'charts'],
    defaultConfig: () => ({
      lookback_days: 7,
    }),
    description: 'Workout, sleep, and meditation stats',
    label: 'Activity Summary',
    type: 'activity_summary',
  },
  {
    allowedSections: ['charts'],
    defaultConfig: () => ({
      display_period: 'monthly',
      half_life_days: 15,
      lookback_days: 90,
      pattern: 'coffee',
      source_type: 'activity_type',
    }),
    description: 'EMA trend visualization for activity types or metrics',
    label: 'Trend Chart',
    type: 'trend_chart',
  },
  {
    allowedSections: ['charts'],
    defaultConfig: () => ({
      bucket_size: '1d',
      lookback_days: 30,
      pattern: 'coffee',
      source_type: 'activity_type',
    }),
    description: 'Bucketed bar chart for activity types, metrics, or categories',
    label: 'Bar Chart',
    type: 'bar_chart',
  },
  {
    allowedSections: ['charts'],
    defaultConfig: () => ({
      layers: [
        { bucket_size: '1w', kind: 'bars', pattern: 'coffee', source_type: 'activity_type' },
        { display_period: 'weekly', kind: 'trend', pattern: 'coffee', source_type: 'activity_type' },
      ],
      lookback_days: 90,
    }),
    description: 'Bars and trend lines over one time axis',
    label: 'Combined Chart',
    type: 'combined_chart',
  },
  {
    allowedSections: ['charts'],
    defaultConfig: () => ({
      activity: 'exercise',
      activity_type: 'activity_type',
      period_days: 90,
    }),
    description: 'Activity impact on HRV/HR timeline',
    label: 'Correlation Impact',
    type: 'correlation',
  },
  {
    allowedSections: ['charts'],
    defaultConfig: () => ({
      lookback_days: 7,
      show_targets: true,
    }),
    description: 'Heart rate zone progress bars with targets',
    label: 'HR Zones',
    type: 'hr_zones',
  },
  {
    allowedSections: ['metrics', 'charts'],
    defaultConfig: () => ({
      compact: false,
    }),
    description: 'Progress bars showing goal achievement',
    label: 'Goal Progress',
    type: 'goal_progress',
  },
  {
    allowedSections: ['links'],
    defaultConfig: () => ({
      href: '/timeline',
      icon: 'timeline',
      label: 'Timeline',
    }),
    description: 'Navigation card to another page',
    label: 'Quick Link',
    type: 'quick_link',
  },
]

const linkOptions = [
  { icon: 'timeline', label: 'Timeline', value: '/timeline' },
  { icon: 'sleep', label: 'Sleep', value: '/sleep' },
  { icon: 'correlations', label: 'Correlations', value: '/correlations' },
  { icon: 'goals', label: 'Goals', value: '/goals' },
  { icon: 'places', label: 'Places', value: '/places' },
  { icon: 'trends', label: 'Chart', value: '/chart' },
  { icon: 'settings', label: 'Settings', value: '/settings' },
]

const topListSourceOptions = [
  { label: 'Music: artists', value: 'media_artist' },
  { label: 'Music: albums', value: 'media_album' },
  { label: 'Music: tracks', value: 'media_track' },
  { label: 'Screen time: apps', value: 'screentime_app' },
  { label: 'Places: visits', value: 'place' },
] as const

const isMediaTopListSource = (source: string) => source.startsWith('media_')

/** A text field whose key is dropped from the config while blank, so an optional `min(1)` field stays valid. */
const OptionalTextField = ({
  configKey,
  configValues,
  label,
  placeholder,
  setConfigValues,
}: {
  configKey: string
  configValues: Record<string, unknown>
  label: string
  placeholder: string
  setConfigValues: (update: (prev: Record<string, unknown>) => Record<string, unknown>) => void
}) => (
  <div class="form-group">
    <label>{label}</label>
    <input
      type="text"
      value={(configValues[configKey] as string) ?? ''}
      onChange={(e) => {
        const value = (e.target as HTMLInputElement).value
        setConfigValues(({ [configKey]: _dropped, ...rest }) =>
          value.trim() ? { ...rest, [configKey]: value } : rest,
        )
      }}
      placeholder={placeholder}
    />
  </div>
)

export function DashboardEditor({
  sectionType,
  onAddWidget,
  onClose,
  periodMode = false,
}: DashboardEditorProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<WidgetTemplate | null>(null)
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({})

  const availableTemplates = offeredWidgetTypes(
    widgetTemplates.filter((t) => t.allowedSections.includes(sectionType)),
    periodMode,
  )

  const handleSelectTemplate = (template: WidgetTemplate) => {
    setSelectedTemplate(template)
    setConfigValues(template.defaultConfig() as Record<string, unknown>)
  }

  const blankFields = selectedTemplate ? blankRequiredFields(selectedTemplate.type, configValues) : []

  const handleAddWidget = () => {
    if (!selectedTemplate || blankFields.length > 0) return

    const widget: DashboardWidget = {
      config: configValues,
      id: generateWidgetId(),
      type: selectedTemplate.type,
    } as DashboardWidget

    onAddWidget(widget)
  }

  const updateConfig = (key: string, value: unknown) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }))
  }

  // eslint-disable-next-line complexity -- TODO: refactor
  const renderConfigForm = () => {
    if (!selectedTemplate) return null

    switch (selectedTemplate.type) {
      case 'metric_card':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Metric</label>
              <MetricPicker
                value={(configValues.metric as string) ?? 'hrv_7day'}
                onChange={(metric) => {
                  updateConfig('metric', metric)
                  updateConfig('title', getMetricDisplayName(metric))
                  updateConfig('unit', metricCardUnits[metric] ?? '')
                }}
              />
            </div>
            <div class="form-group">
              <label>Title</label>
              <input
                type="text"
                value={(configValues.title as string) ?? ''}
                onChange={(e) => updateConfig('title', (e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="form-group">
              <label>Unit (optional)</label>
              <input
                type="text"
                value={(configValues.unit as string) ?? ''}
                onChange={(e) => updateConfig('unit', (e.target as HTMLInputElement).value)}
                placeholder="e.g., ms, bpm"
              />
            </div>
          </div>
        )

      case 'sparkline_card':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Metric</label>
              <MetricPicker
                value={(configValues.metric as string) ?? 'sleep_score'}
                onChange={(metric) => updateConfig('metric', metric)}
              />
            </div>
            <div class="form-group">
              <label>Lookback Days</label>
              <input
                type="number"
                value={(configValues.lookback_days as number) ?? 30}
                onChange={(e) =>
                  updateConfig('lookback_days', parseInt((e.target as HTMLInputElement).value, 10))
                }
                min={7}
                max={365}
              />
            </div>
            <div class="form-group">
              <label>Color</label>
              <input
                type="color"
                value={(configValues.color as string) ?? '#3b82f6'}
                onChange={(e) => updateConfig('color', (e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        )

      case 'activity_summary':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Lookback Days</label>
              <input
                type="number"
                value={(configValues.lookback_days as number) ?? 7}
                onChange={(e) =>
                  updateConfig('lookback_days', parseInt((e.target as HTMLInputElement).value, 10))
                }
                min={1}
                max={30}
              />
            </div>
          </div>
        )

      case 'trend_chart':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Source Type</label>
              <select
                value={(configValues.source_type as string) ?? 'activity_type'}
                onChange={(e) => updateConfig('source_type', (e.target as HTMLSelectElement).value)}
              >
                <option value="activity_type">Activity Type</option>
                <option value="metric">Metric</option>
              </select>
            </div>
            <div class="form-group">
              <label>{(configValues.source_type as string) === 'metric' ? 'Metric' : 'Pattern'}</label>
              {(configValues.source_type as string) === 'metric' ? (
                <MetricPicker
                  value={(configValues.pattern as string) ?? ''}
                  onChange={(metric) => updateConfig('pattern', metric)}
                  placeholder="Search metrics..."
                />
              ) : (
                <ActivityTypePicker
                  value={(configValues.pattern as string) ?? ''}
                  onChange={(activityType) => updateConfig('pattern', activityType)}
                  placeholder="e.g., coffee, exercise"
                />
              )}
            </div>
            <div class="form-group">
              <label>Display Period</label>
              <select
                value={(configValues.display_period as string) ?? 'monthly'}
                onChange={(e) => updateConfig('display_period', (e.target as HTMLSelectElement).value)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
        )

      case 'record_card':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Activity Type</label>
              <ActivityTypePicker
                value={(configValues.pattern as string) ?? ''}
                onChange={(activityType) => updateConfig('pattern', activityType)}
                placeholder="e.g., strength_training"
              />
            </div>
            <div class="form-group">
              <label>Measure</label>
              <select
                value={(configValues.measure as string) ?? 'e1rm'}
                onChange={(e) => updateConfig('measure', (e.target as HTMLSelectElement).value)}
              >
                {recordMeasures.map((m) => (
                  <option key={m} value={m}>
                    {activityMeasureLabels[m]}
                  </option>
                ))}
              </select>
            </div>
            <div class="form-group">
              <label>Exercise (optional)</label>
              <input
                type="text"
                value={(configValues.filter_value as string) ?? ''}
                onChange={(e) => {
                  const value = (e.target as HTMLInputElement).value.trim()
                  setConfigValues(({ filter_field: _field, filter_value: _value, ...rest }) =>
                    value ? { ...rest, filter_field: 'sets.exercise', filter_value: value } : rest,
                  )
                }}
                placeholder="e.g., Bench Press"
              />
            </div>
          </div>
        )

      case 'activity_type_card':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Activity Type</label>
              <ActivityTypePicker
                value={(configValues.pattern as string) ?? ''}
                onChange={(activityType) => updateConfig('pattern', activityType)}
                placeholder="e.g., running, sleep"
              />
            </div>
            <div class="form-group">
              <label>Title</label>
              <input
                type="text"
                value={(configValues.title as string) ?? ''}
                onChange={(e) => {
                  const value = (e.target as HTMLInputElement).value
                  setConfigValues(({ title: _title, ...rest }) =>
                    value.trim() ? { ...rest, title: value } : rest,
                  )
                }}
                placeholder="Defaults to the activity type name"
              />
            </div>
            <div class="form-group">
              <label>Exercise (optional)</label>
              <input
                type="text"
                value={(configValues.filter_value as string) ?? ''}
                onChange={(e) => {
                  const value = (e.target as HTMLInputElement).value.trim()
                  setConfigValues(({ filter_field: _field, filter_value: _value, ...rest }) =>
                    value ? { ...rest, filter_field: 'sets.exercise', filter_value: value } : rest,
                  )
                }}
                placeholder="e.g., Bench Press"
              />
            </div>
            <div class="form-group">
              <label>Show</label>
              <select
                value={(configValues.speed_display as string) ?? ''}
                onChange={(e) => {
                  const value = (e.target as HTMLSelectElement).value
                  setConfigValues(({ speed_display: _display, ...rest }) =>
                    value ? { ...rest, speed_display: value } : rest,
                  )
                }}
              >
                <option value="">Default for the type</option>
                <option value="pace">Pace (min/km)</option>
                <option value="speed">Speed (km/h)</option>
              </select>
            </div>
          </div>
        )

      case 'top_list_card':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Source</label>
              <select
                value={(configValues.source as string) ?? 'media_artist'}
                onChange={(e) => {
                  const value = (e.target as HTMLSelectElement).value
                  setConfigValues((prev) => {
                    if (isMediaTopListSource(value)) return { ...prev, source: value }
                    const { media_source: _mediaSource, ...rest } = prev
                    return { ...rest, source: value }
                  })
                }}
              >
                {topListSourceOptions.map(({ label, value }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {isMediaTopListSource((configValues.source as string) ?? 'media_artist') && (
              <div class="form-group">
                <label>Plays from</label>
                <select
                  value={(configValues.media_source as string) ?? ''}
                  onChange={(e) => {
                    const value = (e.target as HTMLSelectElement).value
                    setConfigValues(({ media_source: _mediaSource, ...rest }) =>
                      value ? { ...rest, media_source: value } : rest,
                    )
                  }}
                >
                  <option value="">All plays</option>
                  <option value="lastfm">Last.fm</option>
                  <option value="mpris">MPRIS player</option>
                </select>
              </div>
            )}
            <div class="form-group">
              <label>Limit</label>
              <input
                type="number"
                value={(configValues.limit as number) ?? 3}
                onChange={(e) => updateConfig('limit', parseInt((e.target as HTMLInputElement).value, 10))}
                min={1}
                max={10}
              />
            </div>
            <OptionalTextField
              configKey="title"
              configValues={configValues}
              label="Title"
              placeholder="Defaults to Top artists, Top apps, ..."
              setConfigValues={setConfigValues}
            />
          </div>
        )

      case 'places_card':
        return (
          <div class="config-form">
            <OptionalTextField
              configKey="title"
              configValues={configValues}
              label="Title"
              placeholder="Places"
              setConfigValues={setConfigValues}
            />
          </div>
        )

      case 'correlation':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Activity Type</label>
              <select
                value={(configValues.activity_type as string) ?? 'activity_type'}
                onChange={(e) => updateConfig('activity_type', (e.target as HTMLSelectElement).value)}
              >
                <option value="activity_type">Activity Type</option>
                <option value="location">Location</option>
              </select>
            </div>
            <div class="form-group">
              <label>Activity/Tag Name</label>
              <input
                type="text"
                value={(configValues.activity as string) ?? ''}
                onChange={(e) => updateConfig('activity', (e.target as HTMLInputElement).value)}
                placeholder="e.g., coffee, exercise, gym"
              />
            </div>
          </div>
        )

      case 'hr_zones':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Lookback Days</label>
              <input
                type="number"
                value={(configValues.lookback_days as number) ?? 7}
                onChange={(e) =>
                  updateConfig('lookback_days', parseInt((e.target as HTMLInputElement).value, 10))
                }
                min={1}
                max={90}
              />
            </div>
            <div class="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={(configValues.show_targets as boolean) ?? true}
                  onChange={(e) => updateConfig('show_targets', (e.target as HTMLInputElement).checked)}
                />{' '}
                Show target percentages
              </label>
            </div>
          </div>
        )

      case 'goal_progress':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={(configValues.compact as boolean) ?? false}
                  onChange={(e) => updateConfig('compact', (e.target as HTMLInputElement).checked)}
                />{' '}
                Compact mode (hide losing-tomorrow info)
              </label>
            </div>
          </div>
        )

      case 'last_sleep':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Title (optional)</label>
              <input
                type="text"
                value={(configValues.title as string) ?? ''}
                onChange={(e) => updateConfig('title', (e.target as HTMLInputElement).value || undefined)}
                placeholder="Last night"
              />
            </div>
          </div>
        )

      case 'quick_link':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Page</label>
              <select
                value={(configValues.href as string) ?? '/timeline'}
                onChange={(e) => {
                  const href = (e.target as HTMLSelectElement).value
                  const option = linkOptions.find((o) => o.value === href)
                  updateConfig('href', href)
                  updateConfig('label', option?.label ?? '')
                  updateConfig('icon', option?.icon ?? '')
                }}
              >
                {linkOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div class="form-group">
              <label>Label</label>
              <input
                type="text"
                value={(configValues.label as string) ?? ''}
                onChange={(e) => updateConfig('label', (e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div class="dashboard-editor-overlay" onClick={onClose}>
      <div class="dashboard-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>{selectedTemplate ? `Configure ${selectedTemplate.label}` : 'Add Widget'}</h3>
          <button class="close-btn" onClick={onClose}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="modal-content">
          {!selectedTemplate ? (
            <div class="widget-picker">
              {availableTemplates.map((template) => (
                <button
                  key={template.type}
                  class="widget-template"
                  onClick={() => handleSelectTemplate(template)}
                >
                  <span class="template-label">{template.label}</span>
                  <span class="template-description">{template.description}</span>
                </button>
              ))}
            </div>
          ) : (
            <div class="widget-config">
              <button class="back-btn" onClick={() => setSelectedTemplate(null)}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                Back to widgets
              </button>
              {renderConfigForm()}
            </div>
          )}
        </div>

        {selectedTemplate && (
          <div class="modal-footer">
            <button class="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              class="btn-primary"
              onClick={handleAddWidget}
              disabled={blankFields.length > 0}
              title={blankFields.length > 0 ? `Fill in: ${blankFields.join(', ')}` : undefined}
            >
              Add Widget
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
