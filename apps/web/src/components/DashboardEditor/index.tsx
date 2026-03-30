/**
 * DashboardEditor - Widget picker and configuration modal.
 */

import type { DashboardWidget, SectionType } from '@aurboda/api-spec'

import { useState } from 'preact/hooks'

import { getMetricDisplayName } from '../../utils/metricLabels'
import { MetricPicker } from '../MetricPicker'
import './style.css'

interface DashboardEditorProps {
  sectionId: string
  sectionType: SectionType
  onAddWidget: (widget: DashboardWidget) => void
  onClose: () => void
}

// Generate unique widget ID
const generateWidgetId = () => `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

// Widget templates for the picker
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
      source_type: 'tag',
    }),
    description: 'EMA trend visualization for tags or metrics',
    label: 'Trend Chart',
    type: 'trend_chart',
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

// Link options for quick link widgets
const linkOptions = [
  { icon: 'timeline', label: 'Timeline', value: '/timeline' },
  { icon: 'sleep', label: 'Sleep', value: '/sleep' },
  { icon: 'hr-zones', label: 'HR Zones', value: '/hr-zones' },
  { icon: 'correlations', label: 'Correlations', value: '/correlations' },
  { icon: 'goals', label: 'Goals', value: '/goals' },
  { icon: 'places', label: 'Places', value: '/places' },
  { icon: 'trends', label: 'Chart', value: '/chart' },
  { icon: 'settings', label: 'Settings', value: '/settings' },
]

export function DashboardEditor({ sectionType, onAddWidget, onClose }: DashboardEditorProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<WidgetTemplate | null>(null)
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({})

  // Filter templates based on section type
  const availableTemplates = widgetTemplates.filter((t) => t.allowedSections.includes(sectionType))

  const handleSelectTemplate = (template: WidgetTemplate) => {
    setSelectedTemplate(template)
    setConfigValues(template.defaultConfig() as Record<string, unknown>)
  }

  const handleAddWidget = () => {
    if (!selectedTemplate) return

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

  // Render configuration form based on widget type
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
                value={(configValues.source_type as string) ?? 'tag'}
                onChange={(e) => updateConfig('source_type', (e.target as HTMLSelectElement).value)}
              >
                <option value="tag">Tag</option>
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
                <input
                  type="text"
                  value={(configValues.pattern as string) ?? ''}
                  onChange={(e) => updateConfig('pattern', (e.target as HTMLInputElement).value)}
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

      case 'correlation':
        return (
          <div class="config-form">
            <div class="form-group">
              <label>Activity Type</label>
              <select
                value={(configValues.activity_type as string) ?? 'tag'}
                onChange={(e) => updateConfig('activity_type', (e.target as HTMLSelectElement).value)}
              >
                <option value="tag">Tag</option>
                <option value="activity_type">Activity</option>
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
            <button class="btn-primary" onClick={handleAddWidget}>
              Add Widget
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
