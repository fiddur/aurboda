import { exerciseTypeNames, type ExerciseTypeName } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useCallback, useState } from 'preact/hooks'
import { MetricPicker } from '../../components/MetricPicker'
import { addActivity, addMetric, addTag, fetchUniqueTags, type ActivityType } from '../../state/api'

import './style.css'

type Tab = 'activity' | 'tag' | 'metric'

const nowLocal = () => format(new Date(), "yyyy-MM-dd'T'HH:mm")

const AddActivityForm = () => {
  const queryClient = useQueryClient()
  const [activityType, setActivityType] = useState<ActivityType>('exercise')
  const [exerciseType, setExerciseType] = useState<ExerciseTypeName>('other_workout')
  const [title, setTitle] = useState('')
  const [startTime, setStartTime] = useState(nowLocal())
  const [endTime, setEndTime] = useState(nowLocal())
  const [notes, setNotes] = useState('')
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      addActivity({
        activity_type: activityType,
        end_time: new Date(endTime).toISOString(),
        ...(activityType === 'exercise' ? { exercise_type: exerciseType } : {}),
        ...(notes ? { notes } : {}),
        start_time: new Date(startTime).toISOString(),
        ...(title ? { title } : {}),
      }),
    onError: (err: Error) => {
      setError(err.message)
      setSuccess('')
    },
    onSuccess: () => {
      setSuccess('Activity added')
      setError('')
      setTitle('')
      setNotes('')
      setStartTime(nowLocal())
      setEndTime(nowLocal())
      queryClient.invalidateQueries({ queryKey: ['dayview-activities'] })
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
          onChange={(e) => setActivityType((e.target as HTMLSelectElement).value as ActivityType)}
        >
          <option value="exercise">Exercise</option>
          <option value="meditation">Meditation</option>
          <option value="nap">Nap</option>
          <option value="sleep">Sleep</option>
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
                {name.replace(/_/g, ' ')}
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

      <div class="form-row">
        <div class="form-field">
          <label>Start</label>
          <input
            type="datetime-local"
            value={startTime}
            onInput={(e) => setStartTime((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="form-field">
          <label>End</label>
          <input
            type="datetime-local"
            value={endTime}
            onInput={(e) => setEndTime((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>

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

const AddTagForm = () => {
  const queryClient = useQueryClient()
  const [tagName, setTagName] = useState('')
  const [startTime, setStartTime] = useState(nowLocal())
  const [hasEndTime, setHasEndTime] = useState(false)
  const [endTime, setEndTime] = useState(nowLocal())
  const [mergeSpan, setMergeSpan] = useState('')
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const { data: uniqueTags } = useQuery({
    queryFn: fetchUniqueTags,
    queryKey: ['uniqueTags'],
    staleTime: 5 * 60 * 1000,
  })

  const [showSuggestions, setShowSuggestions] = useState(false)
  const filteredTags = (uniqueTags ?? []).filter(
    (t) => tagName && t.toLowerCase().includes(tagName.toLowerCase()) && t !== tagName,
  )

  const mutation = useMutation({
    mutationFn: () =>
      addTag({
        ...(hasEndTime ? { end_time: new Date(endTime).toISOString() } : {}),
        ...(mergeSpan ? { merge_span: parseInt(mergeSpan, 10) } : {}),
        start_time: new Date(startTime).toISOString(),
        tag: tagName,
      }),
    onError: (err: Error) => {
      setError(err.message)
      setSuccess('')
    },
    onSuccess: () => {
      setSuccess(`Tag "${tagName}" added`)
      setError('')
      setTagName('')
      setStartTime(nowLocal())
      setHasEndTime(false)
      setMergeSpan('')
      queryClient.invalidateQueries({ queryKey: ['dayview-tags'] })
      queryClient.invalidateQueries({ queryKey: ['uniqueTags'] })
    },
  })

  return (
    <div class="add-form">
      {success && <div class="add-success">{success}</div>}
      {error && <div class="add-error">{error}</div>}

      <div class="form-field" style={{ position: 'relative' }}>
        <label>Tag Name</label>
        <input
          type="text"
          value={tagName}
          onInput={(e) => {
            setTagName((e.target as HTMLInputElement).value)
            setShowSuggestions(true)
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder="e.g. coffee, gym, meeting"
        />
        {showSuggestions && filteredTags.length > 0 && (
          <ul
            class="tag-picker-dropdown"
            style={{ left: 0, position: 'absolute', right: 0, top: '100%', zIndex: 10 }}
          >
            {filteredTags.slice(0, 8).map((t) => (
              <li
                key={t}
                class="tag-picker-option"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setTagName(t)
                  setShowSuggestions(false)
                }}
              >
                <span class="tag-option-display">{t}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div class="form-field">
        <label>Start Time</label>
        <input
          type="datetime-local"
          value={startTime}
          onInput={(e) => setStartTime((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="form-check">
        <input
          type="checkbox"
          id="has-end-time"
          checked={hasEndTime}
          onChange={(e) => setHasEndTime((e.target as HTMLInputElement).checked)}
        />
        <label for="has-end-time">Has end time (span tag)</label>
      </div>

      {hasEndTime && (
        <div class="form-field">
          <label>End Time</label>
          <input
            type="datetime-local"
            value={endTime}
            onInput={(e) => setEndTime((e.target as HTMLInputElement).value)}
          />
        </div>
      )}

      <div class="form-field">
        <label>Merge Span (seconds)</label>
        <input
          type="number"
          value={mergeSpan}
          onInput={(e) => setMergeSpan((e.target as HTMLInputElement).value)}
          placeholder="Optional (1-3600)"
          min="1"
          max="3600"
        />
        <span class="form-hint">If set, extends an existing tag if it ended within this many seconds</span>
      </div>

      <div class="add-form-actions">
        <button
          class="btn-primary"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !tagName.trim() || !startTime}
          type="button"
        >
          {mutation.isPending ? 'Adding...' : 'Add Tag'}
        </button>
      </div>
    </div>
  )
}

const AddMetricForm = () => {
  const [metric, setMetric] = useState('')
  const [value, setValue] = useState('')
  const [time, setTime] = useState(nowLocal())
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      addMetric({
        metric,
        time: new Date(time).toISOString(),
        value: parseFloat(value),
      }),
    onError: (err: Error) => {
      setError(err.message)
      setSuccess('')
    },
    onSuccess: () => {
      setSuccess(`Metric "${metric}" recorded`)
      setError('')
      setValue('')
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
  const [activeTab, setActiveTab] = useState<Tab>('activity')

  const handleTabClick = useCallback((tab: Tab) => {
    setActiveTab(tab)
  }, [])

  return (
    <div class="add-data-page">
      <h1>Add Data</h1>

      <div class="add-data-tabs">
        <button
          class={`add-data-tab ${activeTab === 'activity' ? 'active' : ''}`}
          onClick={() => handleTabClick('activity')}
          type="button"
        >
          Activity
        </button>
        <button
          class={`add-data-tab ${activeTab === 'tag' ? 'active' : ''}`}
          onClick={() => handleTabClick('tag')}
          type="button"
        >
          Tag
        </button>
        <button
          class={`add-data-tab ${activeTab === 'metric' ? 'active' : ''}`}
          onClick={() => handleTabClick('metric')}
          type="button"
        >
          Metric
        </button>
      </div>

      {activeTab === 'activity' && <AddActivityForm />}
      {activeTab === 'tag' && <AddTagForm />}
      {activeTab === 'metric' && <AddMetricForm />}
    </div>
  )
}
