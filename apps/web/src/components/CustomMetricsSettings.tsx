import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import {
  addCustomMetric,
  deleteCustomMetric,
  fetchCustomMetrics,
  updateCustomMetric,
  type CustomMetricDefinition,
} from '../state/api'

const CustomMetricRow = ({
  metric,
  onDeleted,
  onUpdated,
}: {
  metric: CustomMetricDefinition
  onDeleted: () => void
  onUpdated: () => void
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [unit, setUnit] = useState(metric.unit)
  const [description, setDescription] = useState(metric.description ?? '')
  const [minValue, setMinValue] = useState(metric.min_value?.toString() ?? '')
  const [maxValue, setMaxValue] = useState(metric.max_value?.toString() ?? '')

  const updateMutation = useMutation({
    mutationFn: () =>
      updateCustomMetric(metric.name, {
        description: description || undefined,
        max_value: maxValue ? parseFloat(maxValue) : null,
        min_value: minValue ? parseFloat(minValue) : null,
        unit,
      }),
    onSuccess: () => {
      setIsEditing(false)
      onUpdated()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteCustomMetric(metric.name),
    onSuccess: onDeleted,
  })

  if (isEditing) {
    return (
      <div class="custom-metric-item editing">
        <div class="custom-metric-fields">
          <span class="custom-metric-name">{metric.name}</span>
          <div class="custom-metric-edit-row">
            <input
              type="text"
              value={unit}
              onInput={(e) => setUnit((e.target as HTMLInputElement).value)}
              placeholder="Unit"
              class="custom-metric-input"
            />
            <input
              type="text"
              value={description}
              onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
              placeholder="Description"
              class="custom-metric-input wide"
            />
          </div>
          <div class="custom-metric-edit-row">
            <input
              type="number"
              step="any"
              value={minValue}
              onInput={(e) => setMinValue((e.target as HTMLInputElement).value)}
              placeholder="Min"
              class="custom-metric-input"
            />
            <input
              type="number"
              step="any"
              value={maxValue}
              onInput={(e) => setMaxValue((e.target as HTMLInputElement).value)}
              placeholder="Max"
              class="custom-metric-input"
            />
          </div>
        </div>
        <div class="custom-metric-actions">
          <button
            type="button"
            class="note-action-btn"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !unit.trim()}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </button>
          <button type="button" class="note-action-btn" onClick={() => setIsEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div class="custom-metric-item">
      <div class="custom-metric-fields">
        <span class="custom-metric-name">{metric.name}</span>
        <span class="custom-metric-unit">{metric.unit}</span>
        {metric.description && <span class="custom-metric-desc">{metric.description}</span>}
        {(metric.min_value !== undefined || metric.max_value !== undefined) && (
          <span class="custom-metric-range">
            Range: {metric.min_value ?? '—'} – {metric.max_value ?? '—'}
          </span>
        )}
      </div>
      <div class="custom-metric-actions">
        <button type="button" class="note-action-btn" onClick={() => setIsEditing(true)}>
          Edit
        </button>
        <button
          type="button"
          class="note-action-btn danger"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
        >
          {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

export function CustomMetricsSettings() {
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [newUnit, setNewUnit] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newMinValue, setNewMinValue] = useState('')
  const [newMaxValue, setNewMaxValue] = useState('')

  const { data: metrics } = useQuery({
    queryFn: fetchCustomMetrics,
    queryKey: ['customMetrics'],
    staleTime: 5 * 60 * 1000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['customMetrics'] })
  }

  const addMutation = useMutation({
    mutationFn: () =>
      addCustomMetric({
        ...(newDescription ? { description: newDescription } : {}),
        ...(newMaxValue ? { max_value: parseFloat(newMaxValue) } : {}),
        ...(newMinValue ? { min_value: parseFloat(newMinValue) } : {}),
        name: newName,
        unit: newUnit,
      }),
    onSuccess: () => {
      setNewName('')
      setNewUnit('')
      setNewDescription('')
      setNewMinValue('')
      setNewMaxValue('')
      invalidate()
    },
  })

  return (
    <section class="settings-section">
      <h2>Custom Metrics</h2>
      <p class="section-description">
        Define custom metrics to track any numeric data. Custom metrics appear in the metric picker and can be
        used in trends and dashboards.
      </p>

      {(metrics ?? []).length > 0 && (
        <div class="custom-metrics-list">
          {(metrics ?? []).map((m) => (
            <CustomMetricRow key={m.name} metric={m} onDeleted={invalidate} onUpdated={invalidate} />
          ))}
        </div>
      )}

      <div class="custom-metric-add-form">
        <h3>Add Custom Metric</h3>
        <div class="custom-metric-add-row">
          <input
            type="text"
            value={newName}
            onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
            placeholder="name (snake_case)"
            class="custom-metric-input"
          />
          <input
            type="text"
            value={newUnit}
            onInput={(e) => setNewUnit((e.target as HTMLInputElement).value)}
            placeholder="unit (e.g. kg, mg, count)"
            class="custom-metric-input"
          />
        </div>
        <div class="custom-metric-add-row">
          <input
            type="text"
            value={newDescription}
            onInput={(e) => setNewDescription((e.target as HTMLInputElement).value)}
            placeholder="Description (optional)"
            class="custom-metric-input wide"
          />
        </div>
        <div class="custom-metric-add-row">
          <input
            type="number"
            step="any"
            value={newMinValue}
            onInput={(e) => setNewMinValue((e.target as HTMLInputElement).value)}
            placeholder="Min value (optional)"
            class="custom-metric-input"
          />
          <input
            type="number"
            step="any"
            value={newMaxValue}
            onInput={(e) => setNewMaxValue((e.target as HTMLInputElement).value)}
            placeholder="Max value (optional)"
            class="custom-metric-input"
          />
        </div>
        {addMutation.isError && <p class="custom-metric-error">{(addMutation.error as Error).message}</p>}
        <button
          type="button"
          class="connect-button"
          onClick={() => addMutation.mutate()}
          disabled={addMutation.isPending || !newName.trim() || !newUnit.trim()}
        >
          {addMutation.isPending ? 'Adding...' : 'Add Metric'}
        </button>
      </div>
    </section>
  )
}
