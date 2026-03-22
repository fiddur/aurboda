import type { Confidence } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'

import { MetricPicker } from '../../components/MetricPicker'
import { createReport, fetchReports } from '../../state/api'
import '../AddData/style.css'
import './AddReport.css'

interface EntryDraft {
  key: number
  metric: string
  value: string
  unit: string
  method: string
  confidence: Confidence
  reference_low: string
  reference_high: string
}

let entryKeyCounter = 0
const newEntry = (): EntryDraft => ({
  confidence: 'measured',
  key: entryKeyCounter++,
  method: '',
  metric: '',
  reference_high: '',
  reference_low: '',
  unit: '',
  value: '',
})

const nowLocal = () => format(new Date(), "yyyy-MM-dd'T'HH:mm")

const formatType = (type: string): string =>
  type.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

export function AddReport() {
  const { route } = useLocation()
  const queryClient = useQueryClient()

  const [reportType, setReportType] = useState('')
  const [date, setDate] = useState(nowLocal())
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [entries, setEntries] = useState<EntryDraft[]>([newEntry()])
  const [error, setError] = useState('')
  const [showTypeSuggestions, setShowTypeSuggestions] = useState(false)

  // Fetch existing report types for autocomplete
  const { data: existingReports } = useQuery({
    queryFn: () => fetchReports(),
    queryKey: ['reports', ''],
    staleTime: 5 * 60 * 1000,
  })

  const existingTypes = [...new Set((existingReports ?? []).map((r) => r.report_type))].sort()
  const filteredTypes = existingTypes.filter(
    (t) => reportType && t.toLowerCase().includes(reportType.toLowerCase()) && t !== reportType,
  )

  const updateEntry = useCallback((key: number, field: keyof EntryDraft, value: string) => {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, [field]: value } : e)))
  }, [])

  const removeEntry = useCallback((key: number) => {
    setEntries((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((e) => e.key !== key)
    })
  }, [])

  const addEntry = useCallback(() => {
    setEntries((prev) => [...prev, newEntry()])
  }, [])

  const mutation = useMutation({
    mutationFn: async () => {
      const validEntries = entries.filter((e) => e.metric && e.value && e.unit)
      if (validEntries.length === 0) throw new Error('At least one complete entry is required')

      return createReport({
        date: new Date(date).toISOString(),
        entries: validEntries.map((e) => ({
          confidence: e.confidence,
          metric: e.metric,
          ...(e.method ? { method: e.method } : {}),
          ...(e.reference_high ? { reference_high: parseFloat(e.reference_high) } : {}),
          ...(e.reference_low ? { reference_low: parseFloat(e.reference_low) } : {}),
          unit: e.unit,
          value: parseFloat(e.value),
        })),
        ...(location ? { location } : {}),
        ...(notes ? { notes } : {}),
        report_type: reportType,
      })
    },
    onError: (err: Error) => setError(err.message),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      route(`/reports/${report.id}`)
    },
  })

  const hasValidEntries = entries.some((e) => e.metric && e.value && e.unit)

  return (
    <div class="add-data-page">
      <div class="add-data-header">
        <h1>Add Lab Report</h1>
      </div>

      <div class="add-form">
        {error && <div class="add-error">{error}</div>}

        <div class="form-field" style={{ position: 'relative' }}>
          <label>Report Type</label>
          <input
            type="text"
            value={reportType}
            onInput={(e) => {
              setReportType((e.target as HTMLInputElement).value)
              setShowTypeSuggestions(true)
            }}
            onFocus={() => setShowTypeSuggestions(true)}
            onBlur={() => setTimeout(() => setShowTypeSuggestions(false), 200)}
            placeholder="e.g. blood_panel, inbody, hair_mineral_analysis"
          />
          {showTypeSuggestions && filteredTypes.length > 0 && (
            <ul
              class="tag-picker-dropdown"
              style={{ left: 0, position: 'absolute', right: 0, top: '100%', zIndex: 10 }}
            >
              {filteredTypes.map((t) => (
                <li
                  key={t}
                  class="tag-picker-option"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setReportType(t)
                    setShowTypeSuggestions(false)
                  }}
                >
                  <span class="tag-option-display">{formatType(t)}</span>
                  <span class="metric-option-key">{t}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div class="form-row">
          <div class="form-field">
            <label>Date</label>
            <input
              type="datetime-local"
              value={date}
              onInput={(e) => setDate((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-field">
            <label>Location</label>
            <input
              type="text"
              value={location}
              onInput={(e) => setLocation((e.target as HTMLInputElement).value)}
              placeholder="e.g. Lab name, clinic"
            />
          </div>
        </div>

        <div class="form-field">
          <label>Notes</label>
          <textarea
            value={notes}
            onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
            placeholder="e.g. Fasted 12h, exercised before scan"
            rows={2}
          />
        </div>

        <div class="report-entries-editor">
          <div class="report-entries-editor-header">
            <label>Entries</label>
            <button type="button" class="btn-add-entry" onClick={addEntry}>
              + Add Entry
            </button>
          </div>

          {entries.map((entry, index) => (
            <div key={entry.key} class="report-entry-form">
              <div class="report-entry-form-header">
                <span class="report-entry-form-number">#{index + 1}</span>
                {entries.length > 1 && (
                  <button
                    type="button"
                    class="report-entry-remove"
                    onClick={() => removeEntry(entry.key)}
                    title="Remove entry"
                  >
                    &times;
                  </button>
                )}
              </div>

              <div class="form-row">
                <div class="form-field" style={{ flex: 2 }}>
                  <label>Metric</label>
                  <MetricPicker
                    value={entry.metric}
                    onChange={(v) => updateEntry(entry.key, 'metric', v)}
                    placeholder="Search metrics..."
                  />
                </div>
                <div class="form-field">
                  <label>Value</label>
                  <input
                    type="number"
                    step="any"
                    value={entry.value}
                    onInput={(e) => updateEntry(entry.key, 'value', (e.target as HTMLInputElement).value)}
                    placeholder="0.0"
                  />
                </div>
                <div class="form-field">
                  <label>Unit</label>
                  <input
                    type="text"
                    value={entry.unit}
                    onInput={(e) => updateEntry(entry.key, 'unit', (e.target as HTMLInputElement).value)}
                    placeholder="kg, %, ng/mL"
                  />
                </div>
              </div>

              <div class="form-row">
                <div class="form-field">
                  <label>Method</label>
                  <input
                    type="text"
                    value={entry.method}
                    onInput={(e) => updateEntry(entry.key, 'method', (e.target as HTMLInputElement).value)}
                    placeholder="e.g. bia, dexa, blood_draw"
                  />
                </div>
                <div class="form-field">
                  <label>Confidence</label>
                  <select
                    value={entry.confidence}
                    onChange={(e) =>
                      updateEntry(entry.key, 'confidence', (e.target as HTMLSelectElement).value)
                    }
                  >
                    <option value="measured">Measured</option>
                    <option value="estimated">Estimated</option>
                    <option value="derived">Derived</option>
                  </select>
                </div>
                <div class="form-field">
                  <label>Ref Low</label>
                  <input
                    type="number"
                    step="any"
                    value={entry.reference_low}
                    onInput={(e) =>
                      updateEntry(entry.key, 'reference_low', (e.target as HTMLInputElement).value)
                    }
                    placeholder="—"
                  />
                </div>
                <div class="form-field">
                  <label>Ref High</label>
                  <input
                    type="number"
                    step="any"
                    value={entry.reference_high}
                    onInput={(e) =>
                      updateEntry(entry.key, 'reference_high', (e.target as HTMLInputElement).value)
                    }
                    placeholder="—"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div class="add-form-actions">
          <button
            class="btn-primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !reportType.trim() || !date || !hasValidEntries}
            type="button"
          >
            {mutation.isPending ? 'Saving...' : 'Save Report'}
          </button>
          <a href="/reports" class="btn-secondary-link">
            Cancel
          </a>
        </div>
      </div>
    </div>
  )
}
