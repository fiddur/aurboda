/**
 * Status panel for bulk imports of external food databases.
 *
 * Shows the latest job for each source — its status, progress bar, and any
 * error. The button kicks off a new import; while one is running, polls the
 * job every 2s until it finishes.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { type ImportJob, listImportJobsApi, startLivsmedelsverketImportApi } from '../state/api'
import './ImportPanel.css'

const POLL_INTERVAL_MS = 2_000

const formatTime = (iso?: string): string => {
  if (!iso) return ''
  return new Date(iso).toLocaleString()
}

function JobStatus({ job }: { job: ImportJob }) {
  const total = job.total_items ?? 0
  const processed = job.processed_items
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0

  if (job.status === 'pending' || job.status === 'running') {
    return (
      <div class="import-job import-job-running">
        <div class="import-progress-row">
          <span>
            Importing… {processed}
            {total > 0 && ` / ${total}`}
          </span>
          <span class="import-progress-pct">{total > 0 ? `${pct}%` : ''}</span>
        </div>
        <div class="import-progress-bar">
          <div class="import-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  if (job.status === 'completed') {
    return (
      <div class="import-job import-job-completed">
        Last import completed {formatTime(job.completed_at)} — {processed} items
      </div>
    )
  }
  return (
    <div class="import-job import-job-failed">
      <strong>Last import failed</strong>
      {job.error && <span>: {job.error}</span>}
    </div>
  )
}

export function ImportPanel() {
  const queryClient = useQueryClient()

  const { data: jobs } = useQuery({
    queryFn: () => listImportJobsApi('livsmedelsverket', 1),
    queryKey: ['importJobs', 'livsmedelsverket'],
    refetchInterval: (q) => {
      const latest = q.state.data?.[0]
      const isActive = latest?.status === 'pending' || latest?.status === 'running'
      return isActive ? POLL_INTERVAL_MS : false
    },
  })

  const latest = jobs?.[0]

  const startMutation = useMutation({
    mutationFn: startLivsmedelsverketImportApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['importJobs', 'livsmedelsverket'] })
    },
  })

  const isActive = latest?.status === 'pending' || latest?.status === 'running'

  return (
    <div class="import-panel">
      <div class="import-panel-header">
        <h3>Import food library</h3>
        <button
          type="button"
          class="btn-primary"
          onClick={() => startMutation.mutate()}
          disabled={isActive || startMutation.isPending}
        >
          {isActive ? 'Import running…' : 'Import from Livsmedelsverket'}
        </button>
      </div>
      <p class="import-panel-attribution">
        Source: <a href="https://www.livsmedelsverket.se/">Livsmedelsverket</a> (Swedish Food Agency). Data
        licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Imports are
        upserts — running again refreshes any items that have changed.
      </p>
      {latest && <JobStatus job={latest} />}
      {startMutation.error && (
        <p class="import-error">Failed to start: {(startMutation.error as Error).message}</p>
      )}
    </div>
  )
}
