import { exerciseTypeNames, type ExerciseTypeName } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'

import { MetricPicker } from '../../components/MetricPicker'
import {
  addActivity,
  addMetric,
  addNote,
  fetchActivityTypeDefinitions,
  uploadFitFile,
  type ActivityType,
  type ActivityTypeDefinition,
} from '../../state/api'
import './style.css'

type Tab = 'activity' | 'metric'

const STORAGE_KEY = 'addData.addMore'
const getAddMore = (): boolean => localStorage.getItem(STORAGE_KEY) !== 'false'
const setAddMore = (value: boolean): void => localStorage.setItem(STORAGE_KEY, String(value))

const nowLocal = () => format(new Date(), "yyyy-MM-dd'T'HH:mm")

interface FormProps {
  /** Called after successful creation. If it returns true, the form was navigated away. */
  onCreated: (entityType: string, entityId: string | undefined) => boolean
}

const FitUpload = ({ onCreated }: FormProps) => {
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      setUploading(true)
      setError('')
      setSuccess('')

      try {
        let lastId: string | undefined
        for (const file of Array.from(files)) {
          const result = await uploadFitFile(file)
          const data = Array.isArray(result.data) ? result.data[0] : result.data
          lastId = data?.id
        }
        queryClient.invalidateQueries({ queryKey: ['dayview-activities'] })
        if (files.length === 1 && lastId) {
          if (onCreated('activity', lastId)) return
        }
        setSuccess(`Imported ${files.length} file${files.length > 1 ? 's' : ''}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        setUploading(false)
      }
    },
    [onCreated, queryClient],
  )

  return (
    <div class="fit-upload">
      {success && <div class="add-success">{success}</div>}
      {error && <div class="add-error">{error}</div>}
      <label class="fit-upload-area">
        <input
          type="file"
          accept=".fit"
          multiple
          class="fit-upload-input"
          onChange={(e) => handleFiles((e.target as HTMLInputElement).files)}
          disabled={uploading}
        />
        <span class="fit-upload-label">{uploading ? 'Importing...' : 'Import .FIT file(s)'}</span>
        <span class="fit-upload-hint">From Garmin, QZ, Polar, Suunto, etc.</span>
      </label>
    </div>
  )
}

const AddActivityForm = ({ onCreated }: FormProps) => {
  const queryClient = useQueryClient()
  const [activityType, setActivityType] = useState<ActivityType>('exercise')
  const [exerciseType, setExerciseType] = useState<ExerciseTypeName>('other_workout')
  const [title, setTitle] = useState('')
  const [startTime, setStartTime] = useState(nowLocal())
  const [endTime, setEndTime] = useState(nowLocal())
  const [hasEndTime, setHasEndTime] = useState(true)
  const [notes, setNotes] = useState('')
  const [comment, setComment] = useState('')
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const { data: activityTypeDefs } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activity-type-definitions'],
    staleTime: 5 * 60 * 1000,
  })

  const allDefs = activityTypeDefs ?? []
  const builtinDefs = allDefs.filter(
    (d: ActivityTypeDefinition) =>
      d.is_builtin && ['exercise', 'meditation', 'nap', 'rest', 'sleep'].includes(d.name),
  )
  const customDefs = allDefs.filter((d: ActivityTypeDefinition) => !builtinDefs.includes(d))

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await addActivity({
        activity_type: activityType,
        ...(hasEndTime ? { end_time: new Date(endTime).toISOString() } : {}),
        ...(activityType === 'exercise' ? { exercise_type: exerciseType } : {}),
        ...(notes ? { notes } : {}),
        start_time: new Date(startTime).toISOString(),
        ...(title ? { title } : {}),
      })
      if (comment.trim() && result.data?.id) {
        try {
          await addNote('activity', result.data.id, comment.trim())
        } catch {
          // Activity was created successfully; comment save failed silently
        }
      }
      return result
    },
    onError: (err: Error) => {
      setError(err.message)
      setSuccess('')
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['dayview-activities'] })
      if (onCreated('activity', result.data?.id)) return
      setSuccess('Activity added')
      setError('')
      setTitle('')
      setNotes('')
      setComment('')
      setStartTime(nowLocal())
      setEndTime(nowLocal())
      setHasEndTime(true)
    },
  })

  return (
    <div class="add-form">
      {success && <div class="add-success">{success}</div>}
      {error && <div class="add-error">{error}</div>}

      <div class="form-field">
        <label>Activity Type</label>
        <select
          value={activityType}
          onChange={(e) => {
            const val = (e.target as HTMLSelectElement).value as ActivityType
            setActivityType(val)
            // Default to having end time for most types
            setHasEndTime(true)
          }}
        >
          <optgroup label="Built-in">
            {builtinDefs.map((d: ActivityTypeDefinition) => (
              <option key={d.name} value={d.name}>
                {d.display_name || d.name}
              </option>
            ))}
          </optgroup>
          {customDefs.length > 0 && (
            <optgroup label="Other">
              {customDefs.map((d: ActivityTypeDefinition) => (
                <option key={d.name} value={d.name}>
                  {d.display_name || d.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {activityType === 'exercise' && (
        <div class="form-field">
          <label>Exercise Type</label>
          <select
            value={exerciseType}
            onChange={(e) => setExerciseType((e.target as HTMLSelectElement).value as ExerciseTypeName)}
          >
            {exerciseTypeNames.map((name) => (
              <option key={name} value={name}>
                {name.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>
      )}

      <div class="form-field">
        <label>Title</label>
        <input
          type="text"
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          placeholder={activityType === 'exercise' ? 'e.g. Morning run' : 'Optional title'}
        />
      </div>

      <div class="form-field">
        <label>Start</label>
        <input
          type="datetime-local"
          value={startTime}
          onInput={(e) => setStartTime((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="form-check">
        <input
          type="checkbox"
          id="has-end-time-activity"
          checked={hasEndTime}
          onChange={(e) => setHasEndTime((e.target as HTMLInputElement).checked)}
        />
        <label for="has-end-time-activity">Has end time</label>
      </div>

      {hasEndTime && (
        <div class="form-field">
          <label>End</label>
          <input
            type="datetime-local"
            value={endTime}
            onInput={(e) => setEndTime((e.target as HTMLInputElement).value)}
          />
        </div>
      )}

      <div class="form-field">
        <label>Notes</label>
        <textarea
          value={notes}
          onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
          placeholder={
            activityType === 'exercise' ? 'e.g. Bench press: 10x80, 8x85\nSquat: 5x100' : 'Optional notes'
          }
          rows={3}
        />
        {activityType === 'exercise' && (
          <span class="form-hint">For workouts: "Exercise: reps x weight" per line</span>
        )}
      </div>

      <div class="form-field">
        <label>Comment</label>
        <textarea
          value={comment}
          onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)}
          placeholder="Optional comment"
          rows={2}
        />
      </div>

      <div class="add-form-actions">
        <button
          class="btn-primary"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !startTime || !endTime}
          type="button"
        >
          {mutation.isPending ? 'Adding...' : 'Add Activity'}
        </button>
      </div>
    </div>
  )
}

const AddMetricForm = ({ onCreated }: FormProps) => {
  const [metric, setMetric] = useState('')
  const [value, setValue] = useState('')
  const [time, setTime] = useState(nowLocal())
  const [comment, setComment] = useState('')
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      const metricTimeISO = new Date(time).toISOString()
      const result = await addMetric({
        metric,
        time: metricTimeISO,
        value: parseFloat(value),
      })
      if (comment.trim() && result.success && result.entity_id) {
        try {
          await addNote('metric', result.entity_id, comment.trim())
        } catch {
          // Metric was recorded successfully; comment save failed silently
        }
      }
      return result
    },
    onError: (err: Error) => {
      setError(err.message)
      setSuccess('')
    },
    onSuccess: (result) => {
      if (onCreated('metric', result.entity_id)) return
      setSuccess(`Metric "${metric}" recorded`)
      setError('')
      setValue('')
      setComment('')
      setTime(nowLocal())
    },
  })

  return (
    <div class="add-form">
      {success && <div class="add-success">{success}</div>}
      {error && <div class="add-error">{error}</div>}

      <div class="form-field">
        <label>Metric</label>
        <MetricPicker value={metric} onChange={setMetric} placeholder="Select a metric..." />
      </div>

      <div class="form-row">
        <div class="form-field">
          <label>Value</label>
          <input
            type="number"
            step="any"
            value={value}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
            placeholder="e.g. 72.5"
          />
        </div>
        <div class="form-field">
          <label>Time</label>
          <input
            type="datetime-local"
            value={time}
            onInput={(e) => setTime((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      <div class="form-field">
        <label>Comment</label>
        <textarea
          value={comment}
          onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)}
          placeholder="Optional comment"
          rows={2}
        />
      </div>

      <div class="add-form-actions">
        <button
          class="btn-primary"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !metric || !value}
          type="button"
        >
          {mutation.isPending ? 'Adding...' : 'Add Metric'}
        </button>
      </div>
    </div>
  )
}

export const AddData = () => {
  const { route } = useLocation()
  const [activeTab, setActiveTab] = useState<Tab>('activity')
  const [addMore, setAddMoreState] = useState(getAddMore)

  const handleTabClick = useCallback((tab: Tab) => {
    setActiveTab(tab)
  }, [])

  const toggleAddMore = useCallback(() => {
    setAddMoreState((prev) => {
      const next = !prev
      setAddMore(next)
      return next
    })
  }, [])

  /**
   * Called after successful creation.
   * Returns true if navigation happened (form should not reset).
   */
  const handleCreated = useCallback(
    (entityType: string, entityId: string | undefined): boolean => {
      if (addMore) return false
      if (!entityId) {
        route('/timeline')
        return true
      }
      route(`/detail/${entityType}/${entityId}`)
      return true
    },
    [addMore, route],
  )

  return (
    <div class="add-data-page">
      <div class="add-data-header">
        <h1>Add Data</h1>
        <label class="add-more-toggle" title="Keep form open to add more data">
          <span class="add-more-label">Add more</span>
          <span class={`toggle-switch ${addMore ? 'active' : ''}`} onClick={toggleAddMore}>
            <span class="toggle-knob" />
          </span>
        </label>
      </div>

      <div class="add-data-tabs">
        <button
          class={`add-data-tab ${activeTab === 'activity' ? 'active' : ''}`}
          onClick={() => handleTabClick('activity')}
          type="button"
        >
          Activity
        </button>
        <button
          class={`add-data-tab ${activeTab === 'metric' ? 'active' : ''}`}
          onClick={() => handleTabClick('metric')}
          type="button"
        >
          Metric
        </button>
      </div>

      {activeTab === 'activity' && (
        <>
          <FitUpload onCreated={handleCreated} />
          <div class="form-divider">or enter manually</div>
          <AddActivityForm onCreated={handleCreated} />
        </>
      )}
      {activeTab === 'metric' && <AddMetricForm onCreated={handleCreated} />}
    </div>
  )
}
