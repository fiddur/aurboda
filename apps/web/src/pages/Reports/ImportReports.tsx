import type { ImportReportsResult, ReportImportDateOrder } from '@aurboda/api-spec'

import { parseTable } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'

import { fetchUserSettings, importReports } from '../../state/api'
import {
  ACCEPTED_FILE_TYPES,
  type ColumnRole,
  mappingFromRoles,
  type MappingState,
  missingRoles,
  ROLE_LABELS,
  rolesForLayout,
  setRole,
  sortRows,
  startingMapping,
  STATUS_LABELS,
  summaryText,
  switchLayout,
} from './import-mapping'
import '../AddData/style.css'
import './AddReport.css'
import './ImportReports.css'

type Step = 'input' | 'mapping' | 'preview' | 'done'

const PREVIEW_ROWS = 6

interface Source {
  text: string
  report_type: string
  location: string
  notes: string
}

function InputStep({
  source,
  onChange,
  onNext,
}: {
  source: Source
  onChange: (source: Source) => void
  onNext: () => void
}) {
  const [fileError, setFileError] = useState('')
  const readFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    if (!file) return
    setFileError('')
    try {
      onChange({ ...source, text: await file.text() })
    } catch {
      setFileError('That file could not be read. Try copying the table and pasting it instead.')
    }
  }
  return (
    <div class="add-form">
      <p class="import-intro">
        Copy the table from your spreadsheet (Google Sheets, Excel, Numbers) and paste it below, or choose a
        CSV file. One row per result, or one row per test with a column per date, both work.
      </p>
      <div class="form-field">
        <label for="import-text">Table</label>
        <textarea
          id="import-text"
          class="import-textarea"
          value={source.text}
          onInput={(e) => onChange({ ...source, text: (e.target as HTMLTextAreaElement).value })}
          placeholder={'Datum\tAnalys\tResultat\tEnhet\n2026-03-01\tHb\t145\tg/L'}
          rows={8}
        />
      </div>
      <div class="form-field">
        <label for="import-file">Or choose a file (.csv, .tsv, .txt)</label>
        <input
          id="import-file"
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          onChange={(e) => void readFile(e.target as HTMLInputElement)}
        />
        {fileError && <div class="add-error">{fileError}</div>}
      </div>
      <div class="form-row import-meta-row">
        <div class="form-field">
          <label for="import-type">Report type</label>
          <input
            id="import-type"
            type="text"
            value={source.report_type}
            onInput={(e) => onChange({ ...source, report_type: (e.target as HTMLInputElement).value })}
          />
        </div>
        <div class="form-field">
          <label for="import-location">Location</label>
          <input
            id="import-location"
            type="text"
            value={source.location}
            onInput={(e) => onChange({ ...source, location: (e.target as HTMLInputElement).value })}
            placeholder="e.g. Lab name, clinic"
          />
        </div>
      </div>
      <div class="form-field">
        <label for="import-notes">Notes</label>
        <textarea
          id="import-notes"
          value={source.notes}
          onInput={(e) => onChange({ ...source, notes: (e.target as HTMLTextAreaElement).value })}
          rows={2}
        />
      </div>
      <div class="add-form-actions">
        <button
          type="button"
          class="btn-primary"
          disabled={!source.text.trim() || !source.report_type.trim()}
          onClick={onNext}
        >
          Next: choose columns
        </button>
        <a href="/reports" class="btn-secondary-link">
          Cancel
        </a>
      </div>
    </div>
  )
}

function MappingStep({
  records,
  state,
  onChange,
  onBack,
  onNext,
  pending,
}: {
  records: string[][]
  state: MappingState
  onChange: (state: MappingState) => void
  onBack: () => void
  onNext: () => void
  pending: boolean
}) {
  const header = records[0] ?? []
  const shown = records.slice(0, PREVIEW_ROWS)
  const problem =
    state.layout === 'wide' && !state.has_header
      ? 'A sheet with a column per date needs its first row to hold the dates.'
      : missingRoles(state.roles, state.layout)
  const choices = rolesForLayout(state.layout)
  return (
    <div class="add-form">
      <fieldset class="import-layout">
        <legend>How is the sheet laid out?</legend>
        {(['long', 'wide'] as const).map((layout) => (
          <label key={layout} class="import-radio">
            <input
              type="radio"
              name="layout"
              checked={state.layout === layout}
              onChange={() =>
                onChange({
                  ...state,
                  layout,
                  roles: switchLayout(state.roles, header, layout, state.date_order),
                })
              }
            />
            {layout === 'long'
              ? 'One row per result (with a date column)'
              : 'One row per test, one column per date'}
          </label>
        ))}
      </fieldset>
      <div class="form-row import-options">
        <label class="import-checkbox">
          <input
            type="checkbox"
            checked={state.has_header}
            onChange={(e) => onChange({ ...state, has_header: (e.target as HTMLInputElement).checked })}
          />
          The first row holds column names
        </label>
        <div class="form-field">
          <label for="import-date-order">Dates like 1/3/2026 mean</label>
          <select
            id="import-date-order"
            value={state.date_order}
            onChange={(e) =>
              onChange({
                ...state,
                date_order: (e.target as HTMLSelectElement).value as ReportImportDateOrder,
              })
            }
          >
            <option value="dmy">1 March (day first)</option>
            <option value="mdy">January 3 (month first)</option>
          </select>
        </div>
      </div>
      <p class="import-hint">Choose what each column holds. Columns left on "Ignore" are not imported.</p>
      <div class="import-table-scroll">
        <table class="import-table">
          <thead>
            <tr>
              {state.roles.map((role, index) => (
                <th key={index}>
                  <select
                    aria-label={`Column ${index + 1}`}
                    value={role}
                    onChange={(e) =>
                      onChange({
                        ...state,
                        roles: setRole(
                          state.roles,
                          index,
                          (e.target as HTMLSelectElement).value as ColumnRole,
                        ),
                      })
                    }
                  >
                    {choices.map((choice) => (
                      <option key={choice} value={choice}>
                        {ROLE_LABELS[choice]}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((record, rowIndex) => (
              <tr key={rowIndex} class={rowIndex === 0 && state.has_header ? 'import-header-row' : ''}>
                {state.roles.map((_, index) => (
                  <td key={index}>{record[index] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length > PREVIEW_ROWS && (
        <p class="import-hint">
          Showing the first {PREVIEW_ROWS} of {records.length} rows.
        </p>
      )}
      {problem && <div class="import-problem">{problem}</div>}
      <div class="add-form-actions">
        <button type="button" class="btn-primary" disabled={!!problem || pending} onClick={onNext}>
          {pending ? 'Checking...' : 'Next: preview'}
        </button>
        <button type="button" class="btn-secondary-link" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  )
}

function ResultTable({ result }: { result: ImportReportsResult }) {
  const rows = sortRows(result.rows)
  if (rows.length === 0) return <p class="import-hint">The table has no results to import.</p>
  return (
    <>
      <div class="import-table-scroll">
        <table class="import-table import-result-table">
          <thead>
            <tr>
              <th>Row</th>
              <th>Status</th>
              <th>Date</th>
              <th>Test</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = `${row.row}:${row.column ?? ''}`
              return (
                <Fragment key={key}>
                  <tr class={`import-status-${row.status}${row.error ? ' has-error' : ''}`}>
                    <td>{row.row}</td>
                    <td>
                      <span class="import-status">{STATUS_LABELS[row.status]}</span>
                    </td>
                    <td>{row.date ?? ''}</td>
                    <td>{row.metric ?? ''}</td>
                    <td>{row.value === undefined ? '' : `${row.value}${row.unit ? ` ${row.unit}` : ''}`}</td>
                  </tr>
                  {row.error && (
                    <tr class="import-error-row">
                      <td colSpan={5}>
                        <div class="import-error-text">{row.error}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {result.rows_truncated && (
        <p class="import-hint">Only the first {result.rows.length} rows are listed.</p>
      )}
    </>
  )
}

function PreviewStep({
  preview,
  pending,
  onCreate,
  onBack,
}: {
  preview: ImportReportsResult
  pending: boolean
  onCreate: () => void
  onBack: () => void
}) {
  return (
    <div class="add-form">
      <p class="import-summary">{summaryText(preview.summary)}</p>
      <ResultTable result={preview} />
      <div class="add-form-actions">
        <button
          type="button"
          class="btn-primary"
          disabled={preview.summary.entries_new === 0 || pending}
          onClick={onCreate}
        >
          {pending ? 'Creating...' : 'Create'}
        </button>
        <button type="button" class="btn-secondary-link" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  )
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

function DoneStep({ done }: { done: ImportReportsResult }) {
  const { summary } = done
  const errors = done.rows.filter((r) => r.status === 'error')
  return (
    <div class="add-form">
      <p class="import-summary">
        {summary.entries_new === 0
          ? 'Nothing was imported.'
          : `Imported ${plural(summary.entries_new, 'result', 'results')}: ${plural(summary.reports_new, 'new report', 'new reports')}, ${summary.reports_updated} updated.`}
      </p>
      {summary.errors > 0 && (
        <>
          <p class="import-hint">{plural(summary.errors, 'row was', 'rows were')} left out:</p>
          <ResultTable result={{ ...done, rows: errors }} />
        </>
      )}
      <div class="add-form-actions">
        <a href="/reports" class="btn-primary import-link-button">
          Go to reports
        </a>
      </div>
    </div>
  )
}

export function ImportReports() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('input')
  const [source, setSource] = useState<Source>({
    location: '',
    notes: '',
    report_type: 'blood_panel',
    text: '',
  })
  const [mapping, setMapping] = useState<MappingState | undefined>()
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ImportReportsResult | undefined>()
  const [done, setDone] = useState<ImportReportsResult | undefined>()

  const { data: settings } = useQuery({ queryFn: fetchUserSettings, queryKey: ['userSettings'] })
  const records = useMemo(() => (step === 'input' ? [] : parseTable(source.text)), [step, source.text])

  useEffect(() => {
    if (step === 'mapping' && !mapping) setMapping(startingMapping(records, settings?.report_import_mapping))
  }, [step, mapping, records, settings?.report_import_mapping])

  const body = (dryRun: boolean) => {
    const built = mapping && mappingFromRoles(mapping.roles, mapping)
    if (!built) throw new Error('Choose the columns first')
    return {
      dry_run: dryRun,
      mapping: built,
      report_type: source.report_type.trim(),
      text: source.text,
      ...(source.location.trim() ? { location: source.location.trim() } : {}),
      ...(source.notes.trim() ? { notes: source.notes.trim() } : {}),
    }
  }

  const previewMutation = useMutation({
    mutationFn: () => importReports(body(true)),
    onError: (err: Error) => setError(err.message),
    onSuccess: (result) => {
      setError('')
      setPreview(result)
      setStep('preview')
    },
  })

  const createMutation = useMutation({
    mutationFn: () => importReports(body(false)),
    onError: (err: Error) => setError(err.message),
    onSuccess: (result) => {
      setError('')
      setDone(result)
      setStep('done')
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
    },
  })

  const goToMapping = () => {
    setError('')
    if (parseTable(source.text).length === 0) {
      setError('The table is empty. Paste a few rows from your spreadsheet first.')
      return
    }
    setMapping(undefined)
    setStep('mapping')
  }

  const stepNumber = { done: 3, input: 1, mapping: 2, preview: 3 }[step]

  return (
    <div class="add-data-page import-reports-page">
      <div class="add-data-header">
        <h1>Import lab results</h1>
      </div>
      <ol class="import-steps" aria-label="Steps">
        {['Paste or upload', 'Choose columns', 'Preview and create'].map((label, i) => (
          <li key={label} class={i + 1 === stepNumber ? 'current' : i + 1 < stepNumber ? 'complete' : ''}>
            {label}
          </li>
        ))}
      </ol>

      {error && <div class="add-error">{error}</div>}

      {step === 'input' && <InputStep source={source} onChange={setSource} onNext={goToMapping} />}

      {step === 'mapping' && mapping && (
        <MappingStep
          records={records}
          state={mapping}
          onChange={setMapping}
          onBack={() => setStep('input')}
          onNext={() => previewMutation.mutate()}
          pending={previewMutation.isPending}
        />
      )}

      {step === 'preview' && preview && (
        <PreviewStep
          preview={preview}
          pending={createMutation.isPending}
          onCreate={() => createMutation.mutate()}
          onBack={() => setStep('mapping')}
        />
      )}

      {step === 'done' && done && <DoneStep done={done} />}
    </div>
  )
}
