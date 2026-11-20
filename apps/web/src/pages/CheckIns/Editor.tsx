import type { CheckInForm, CheckInQuestionType, DataSchemaDefinition } from '@aurboda/api-spec'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useLocation, useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import {
  addCheckInForm,
  deleteCheckInForm,
  fetchActivityTypeCatalog,
  fetchActivityTypeDefinitions,
  fetchCheckInForm,
  fetchDue,
  updateCheckInForm,
} from '../../state/api'
import { auth } from '../../state/auth'
import { roundTime, toggleDay, WEEKDAYS } from '../Reminders/reminder-form'
import {
  type ActivityFieldDraft,
  buildForm,
  canLog,
  canLogActivity,
  canPreset,
  canScore,
  changeType,
  draftFromForm,
  draftIsRoutine,
  emptyFormDraft,
  emptyIntakeDraft,
  type FormDraft,
  type IntakeDraft,
  intakeProblems,
  intakeQuestion,
  isBlankQuestion,
  type LogAs,
  METRIC_NAME_RULE,
  moveQuestion,
  newQuestion,
  type OptionDraft,
  QUESTION_TYPES,
  type QuestionDraft,
  startsNewVersion,
  toAddBody,
  toUpdateBody,
} from './form-editor'
import { checkInKeys, useRefreshCheckIns } from './queries'
import './style.css'

type ActivitySchemas = Map<string, DataSchemaDefinition | undefined>

interface QuestionEditorProps {
  question: QuestionDraft
  index: number
  count: number
  activityTypes: ActivitySchemas
  onChange: (question: QuestionDraft) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}

function PresetInput({
  question,
  set,
}: {
  question: QuestionDraft
  set: (patch: Partial<QuestionDraft>) => void
}) {
  const label = (
    <span>
      Preset answer <small>(optional)</small>
    </span>
  )
  const hint = <small>Filled in already; a form with presets is confirmed in one tap.</small>
  switch (question.type) {
    case 'yes_no':
      return (
        <label class="checkin-field">
          {label}
          <select value={question.preset} onChange={(e) => set({ preset: e.currentTarget.value })}>
            <option value="">None</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
          {hint}
        </label>
      )
    case 'choice':
      return (
        <label class="checkin-field">
          {label}
          <select value={question.preset} onChange={(e) => set({ preset: e.currentTarget.value })}>
            <option value="">None</option>
            {question.options.map((option, index) => (
              <option key={index} value={String(index)}>
                {option.label || `Option ${index + 1}`}
              </option>
            ))}
          </select>
          {hint}
        </label>
      )
    default:
      return (
        <label class="checkin-field">
          {label}
          <input
            type="text"
            inputMode={question.type === 'text' ? 'text' : 'decimal'}
            class={question.type === 'text' ? '' : 'checkin-preset-number'}
            value={question.preset}
            maxLength={question.type === 'text' ? 2000 : 30}
            onInput={(e) => set({ preset: e.currentTarget.value })}
          />
          {hint}
        </label>
      )
  }
}

const scalarFields = (schema: DataSchemaDefinition | undefined) =>
  (schema?.fields ?? []).filter((field) => field.type !== 'list')

function ActivityLogEditor({
  question,
  activityTypes,
  set,
}: {
  question: QuestionDraft
  activityTypes: ActivitySchemas
  set: (patch: Partial<QuestionDraft>) => void
}) {
  const schema = activityTypes.get(question.activity_type.trim())
  const fields = scalarFields(schema)
  const numberFields = fields.filter((field) => field.type === 'number')
  const fieldValue = (name: string) =>
    question.activity_fields.find((field) => field.name === name)?.value ?? ''
  const setField = (field: ActivityFieldDraft) =>
    set({
      activity_fields: [...question.activity_fields.filter((f) => f.name !== field.name), field].filter(
        (f) => f.value.trim() !== '',
      ),
    })
  const listId = `activity-types-${question.id}`
  const takesAnswer = question.type !== 'yes_no'
  return (
    <div class="checkin-activity-log">
      <label class="checkin-field">
        <span>Activity type</span>
        <input
          type="text"
          list={listId}
          value={question.activity_type}
          placeholder="supplement"
          onInput={(e) => {
            const type = e.currentTarget.value
            const numbers = scalarFields(activityTypes.get(type.trim())).filter((f) => f.type === 'number')
            set({
              activity_type: type,
              answer_field:
                question.answer_field || (numbers.find((f) => f.name === 'dose') ?? numbers[0])?.name || '',
            })
          }}
        />
        <datalist id={listId}>
          {[...activityTypes.keys()].map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <small>
          {question.type === 'yes_no'
            ? 'A yes logs one activity of this type.'
            : 'Each answer above 0 logs one activity of this type.'}
        </small>
      </label>
      {takesAnswer && (
        <label class="checkin-field">
          <span>The answer goes in the field</span>
          {numberFields.length > 0 ? (
            <select
              value={question.answer_field}
              onChange={(e) => set({ answer_field: e.currentTarget.value })}
            >
              <option value="">None</option>
              {numberFields.map((field) => (
                <option key={field.name} value={field.name}>
                  {field.label ?? field.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={question.answer_field}
              placeholder="dose"
              onInput={(e) => set({ answer_field: e.currentTarget.value })}
            />
          )}
        </label>
      )}
      {fields.length > 0 ? (
        <fieldset class="checkin-field">
          <legend>Fixed fields</legend>
          <div class="checkin-field-row">
            {fields
              .filter((field) => field.name !== question.answer_field)
              .map((field) => (
                <label key={field.name} class="checkin-field">
                  <span>{field.label ?? field.name}</span>
                  {field.type === 'boolean' ? (
                    <select
                      value={fieldValue(field.name)}
                      onChange={(e) =>
                        setField({ kind: 'boolean', name: field.name, value: e.currentTarget.value })
                      }
                    >
                      <option value="">—</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      inputMode={field.type === 'number' ? 'decimal' : 'text'}
                      value={fieldValue(field.name)}
                      onInput={(e) =>
                        setField({
                          kind: field.type === 'number' ? 'number' : 'string',
                          name: field.name,
                          value: e.currentTarget.value,
                        })
                      }
                    />
                  )}
                </label>
              ))}
          </div>
        </fieldset>
      ) : (
        <fieldset class="checkin-field">
          <legend>Fixed fields</legend>
          {question.activity_fields.map((field, index) => (
            <div key={index} class="checkin-option-row">
              <input
                type="text"
                value={field.name}
                placeholder="Field"
                aria-label={`Field ${index + 1}`}
                onInput={(e) =>
                  set({
                    activity_fields: question.activity_fields.map((f, i) =>
                      i === index ? { ...f, name: e.currentTarget.value } : f,
                    ),
                  })
                }
              />
              <input
                type="text"
                value={field.value}
                placeholder="Value"
                aria-label={`Value of field ${index + 1}`}
                onInput={(e) =>
                  set({
                    activity_fields: question.activity_fields.map((f, i) =>
                      i === index ? { ...f, value: e.currentTarget.value } : f,
                    ),
                  })
                }
              />
              <button
                type="button"
                class="checkin-icon-btn"
                aria-label={`Remove field ${index + 1}`}
                onClick={() =>
                  set({ activity_fields: question.activity_fields.filter((_, i) => i !== index) })
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            class="checkin-link-btn"
            onClick={() =>
              set({ activity_fields: [...question.activity_fields, { kind: 'string', name: '', value: '' }] })
            }
          >
            + Add field
          </button>
        </fieldset>
      )}
    </div>
  )
}

type SaveAs = 'none' | LogAs

function SaveAnswerAs({
  question,
  activityTypes,
  set,
}: {
  question: QuestionDraft
  activityTypes: ActivitySchemas
  set: (patch: Partial<QuestionDraft>) => void
}) {
  const metricOk = canLog(question)
  const activityOk = canLogActivity(question)
  if (!metricOk && !activityOk) return null
  const saveAs: SaveAs = question.logs ? question.log_as : 'none'
  return (
    <>
      <label class="checkin-field">
        <span>Save the answer as</span>
        <select
          value={saveAs}
          onChange={(e) => {
            const next = e.currentTarget.value as SaveAs
            set(next === 'none' ? { logs: false } : { log_as: next, logs: true })
          }}
        >
          <option value="none">Nothing</option>
          {metricOk && <option value="metric">A metric (charted with your data)</option>}
          {activityOk && <option value="activity">An activity (shown on the Timeline)</option>}
        </select>
      </label>
      {saveAs === 'metric' && (
        <label class="checkin-field">
          <span>Metric name</span>
          <input
            type="text"
            value={question.metric}
            maxLength={50}
            placeholder="rested"
            onInput={(e) => set({ metric: e.currentTarget.value })}
          />
          <small>
            {METRIC_NAME_RULE} An existing metric of yours is added to; a new name becomes a custom metric.
          </small>
        </label>
      )}
      {saveAs === 'activity' && (
        <ActivityLogEditor question={question} activityTypes={activityTypes} set={set} />
      )}
    </>
  )
}

function IntakeShortcut({
  onAdd,
  onCancel,
}: {
  onAdd: (question: QuestionDraft) => void
  onCancel: () => void
}) {
  const [intake, setIntake] = useState<IntakeDraft>(() => emptyIntakeDraft())
  const [tried, setTried] = useState(false)
  const set = (patch: Partial<IntakeDraft>) => setIntake((current) => ({ ...current, ...patch }))
  const problems = intakeProblems(intake)
  return (
    <section class="checkins-card checkin-editor-section checkin-intake">
      <strong>Add medication or supplement</strong>
      <div class="checkin-options checkin-intake-kind" role="radiogroup" aria-label="Kind">
        {(['supplement', 'medication'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={intake.kind === kind}
            class={`checkin-choice${intake.kind === kind ? ' active' : ''}`}
            onClick={() => set({ kind })}
          >
            {kind === 'supplement' ? 'Supplement' : 'Medication'}
          </button>
        ))}
      </div>
      <div class="checkin-field-row">
        <label class="checkin-field checkin-field-wide">
          <span>Name</span>
          <input
            type="text"
            maxLength={100}
            value={intake.substance}
            placeholder={intake.kind === 'supplement' ? 'Vitamin D' : 'Ibuprofen'}
            onInput={(e) => set({ substance: e.currentTarget.value })}
          />
        </label>
        <label class="checkin-field">
          <span>Dose</span>
          <input
            type="text"
            inputMode="decimal"
            value={intake.dose}
            placeholder={intake.kind === 'supplement' ? '50' : '400'}
            onInput={(e) => set({ dose: e.currentTarget.value })}
          />
        </label>
        <label class="checkin-field">
          <span>Unit</span>
          <input
            type="text"
            maxLength={20}
            value={intake.unit}
            placeholder="mg"
            onInput={(e) => set({ unit: e.currentTarget.value })}
          />
        </label>
      </div>
      <fieldset class="checkin-field">
        <legend>Log it as</legend>
        <label class="checkin-check">
          <input
            type="radio"
            name="intake-log-as"
            checked={intake.log_as === 'activity'}
            onChange={() => set({ log_as: 'activity' })}
          />
          An activity: it shows on the Timeline
        </label>
        <label class="checkin-check">
          <input
            type="radio"
            name="intake-log-as"
            checked={intake.log_as === 'metric'}
            onChange={() => set({ log_as: 'metric' })}
          />
          A metric: the dose per day can be charted
        </label>
      </fieldset>
      {tried && problems.length > 0 && (
        <ul class="checkin-error" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div class="checkin-actions">
        <button
          type="button"
          class="btn-primary"
          onClick={() => {
            setTried(true)
            if (problems.length === 0) onAdd(intakeQuestion(intake))
          }}
        >
          Add it
        </button>
        <button type="button" class="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}

function OptionsEditor({
  options,
  withValues,
  onChange,
}: {
  options: OptionDraft[]
  withValues: boolean
  onChange: (options: OptionDraft[]) => void
}) {
  const set = (index: number, patch: Partial<OptionDraft>) =>
    onChange(options.map((option, i) => (i === index ? { ...option, ...patch } : option)))
  return (
    <fieldset class="checkin-field checkin-options-editor">
      <legend>Options</legend>
      {options.map((option, index) => (
        <div key={index} class="checkin-option-row">
          <input
            type="text"
            value={option.label}
            maxLength={100}
            placeholder={`Option ${index + 1}`}
            aria-label={`Option ${index + 1}`}
            onInput={(e) => set(index, { label: e.currentTarget.value })}
          />
          {withValues && (
            <input
              type="text"
              inputMode="decimal"
              class="checkin-option-value"
              value={option.value}
              placeholder="Value"
              aria-label={`Value of option ${index + 1}`}
              onInput={(e) => set(index, { value: e.currentTarget.value })}
            />
          )}
          <button
            type="button"
            class="checkin-icon-btn"
            aria-label={`Remove option ${index + 1}`}
            disabled={options.length <= 2}
            onClick={() => onChange(options.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        class="checkin-link-btn"
        onClick={() => onChange([...options, { key: null, label: '', value: '' }])}
      >
        + Add option
      </button>
      {withValues && (
        <small>A number per option (optional) lets the answer be saved as a metric or scored.</small>
      )}
    </fieldset>
  )
}

function QuestionEditor({
  question,
  index,
  count,
  activityTypes,
  onChange,
  onMove,
  onRemove,
}: QuestionEditorProps) {
  const set = (patch: Partial<QuestionDraft>) => onChange({ ...question, ...patch })
  return (
    <li class="checkins-card checkin-question-editor">
      <div class="checkin-question-editor-head">
        <strong>Question {index + 1}</strong>
        <span class="checkin-question-editor-tools">
          <button
            type="button"
            class="checkin-icon-btn"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            class="checkin-icon-btn"
            aria-label="Move down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button
            type="button"
            class="checkin-icon-btn"
            aria-label="Remove question"
            disabled={count <= 1}
            onClick={onRemove}
          >
            ×
          </button>
        </span>
      </div>
      <label class="checkin-field">
        <span>Question</span>
        <input
          type="text"
          value={question.prompt}
          maxLength={300}
          placeholder="How rested do you feel?"
          onInput={(e) => set({ prompt: e.currentTarget.value })}
        />
      </label>
      <label class="checkin-field">
        <span>Answer</span>
        <select
          value={question.type}
          onChange={(e) => onChange(changeType(question, e.currentTarget.value as CheckInQuestionType))}
        >
          {QUESTION_TYPES.map((type) => (
            <option key={type.type} value={type.type}>
              {type.label}
            </option>
          ))}
        </select>
      </label>
      {question.type === 'scale' && (
        <div class="checkin-field-row">
          <label class="checkin-field">
            <span>From</span>
            <input
              type="number"
              step={1}
              value={question.min}
              onInput={(e) => set({ min: e.currentTarget.value })}
            />
          </label>
          <label class="checkin-field checkin-field-wide">
            <span>Label</span>
            <input
              type="text"
              maxLength={60}
              value={question.min_label}
              placeholder="Exhausted"
              onInput={(e) => set({ min_label: e.currentTarget.value })}
            />
          </label>
          <label class="checkin-field">
            <span>To</span>
            <input
              type="number"
              step={1}
              value={question.max}
              onInput={(e) => set({ max: e.currentTarget.value })}
            />
          </label>
          <label class="checkin-field checkin-field-wide">
            <span>Label</span>
            <input
              type="text"
              maxLength={60}
              value={question.max_label}
              placeholder="Fully rested"
              onInput={(e) => set({ max_label: e.currentTarget.value })}
            />
          </label>
        </div>
      )}
      {question.type === 'number' && (
        <div class="checkin-field-row">
          <label class="checkin-field">
            <span>Lowest</span>
            <input
              type="text"
              inputMode="decimal"
              value={question.min}
              onInput={(e) => set({ min: e.currentTarget.value })}
            />
          </label>
          <label class="checkin-field">
            <span>Highest</span>
            <input
              type="text"
              inputMode="decimal"
              value={question.max}
              onInput={(e) => set({ max: e.currentTarget.value })}
            />
          </label>
          <label class="checkin-field">
            <span>Step</span>
            <input
              type="text"
              inputMode="decimal"
              value={question.step}
              placeholder="1"
              onInput={(e) => set({ step: e.currentTarget.value })}
            />
          </label>
          <label class="checkin-field">
            <span>Unit</span>
            <input
              type="text"
              maxLength={20}
              value={question.unit}
              placeholder="mg"
              onInput={(e) => set({ unit: e.currentTarget.value })}
            />
          </label>
        </div>
      )}
      {(question.type === 'choice' || question.type === 'multi_choice') && (
        <OptionsEditor
          options={question.options}
          withValues={question.type === 'choice'}
          onChange={(options) =>
            set({
              logs: question.logs && (question.log_as === 'activity' || canLog({ ...question, options })),
              options,
              preset: Number(question.preset) < options.length ? question.preset : '',
            })
          }
        />
      )}
      <label class="checkin-check">
        <input
          type="checkbox"
          checked={question.required}
          onChange={(e) => set({ required: e.currentTarget.checked })}
        />
        Required
      </label>
      {canPreset(question) && <PresetInput question={question} set={set} />}
      <SaveAnswerAs question={question} activityTypes={activityTypes} set={set} />
    </li>
  )
}

function ScheduleEditor({
  draft,
  set,
  timezone,
}: {
  draft: FormDraft
  set: (patch: Partial<FormDraft>) => void
  timezone: string | undefined
}) {
  return (
    <section class="checkins-card checkin-editor-section">
      <label class="checkin-check checkin-section-toggle">
        <input
          type="checkbox"
          checked={draft.schedule_on}
          onChange={(e) => set({ schedule_on: e.currentTarget.checked })}
        />
        <strong>Ask for it on a schedule</strong>
      </label>
      {draft.schedule_on && (
        <>
          <fieldset class="checkin-field">
            <legend>Times</legend>
            <div class="checkin-times">
              {draft.times.map((time, index) => (
                <span key={index} class="checkin-time">
                  <input
                    type="time"
                    step={300}
                    value={time}
                    aria-label={`Time ${index + 1}`}
                    onInput={(e) =>
                      set({ times: draft.times.map((t, i) => (i === index ? e.currentTarget.value : t)) })
                    }
                    onBlur={(e) => {
                      const rounded = roundTime(e.currentTarget.value)
                      if (rounded) set({ times: draft.times.map((t, i) => (i === index ? rounded : t)) })
                    }}
                  />
                  <button
                    type="button"
                    class="checkin-icon-btn"
                    aria-label={`Remove time ${index + 1}`}
                    disabled={draft.times.length <= 1}
                    onClick={() => set({ times: draft.times.filter((_, i) => i !== index) })}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                class="checkin-link-btn"
                onClick={() => set({ times: [...draft.times, '20:00'] })}
              >
                + Add time
              </button>
            </div>
          </fieldset>
          <fieldset class="checkin-field">
            <legend>Days</legend>
            <div class="checkin-days">
              {WEEKDAYS.map(({ day, short }) => (
                <button
                  key={day}
                  type="button"
                  class={`checkin-day${draft.weekdays.includes(day) ? ' active' : ''}`}
                  aria-pressed={draft.weekdays.includes(day)}
                  onClick={() => set({ weekdays: toggleDay(draft.weekdays, day) })}
                >
                  {short}
                </button>
              ))}
            </div>
          </fieldset>
          <div class="checkin-field-row">
            <label class="checkin-field">
              <span>
                Start <small>(optional)</small>
              </span>
              <input
                type="date"
                value={draft.start_date}
                onInput={(e) => set({ start_date: e.currentTarget.value })}
              />
            </label>
            <label class="checkin-field">
              <span>
                End <small>(optional)</small>
              </span>
              <input
                type="date"
                value={draft.end_date}
                onInput={(e) => set({ end_date: e.currentTarget.value })}
              />
            </label>
          </div>
          <label class="checkin-field">
            <span>The day starts at</span>
            <input
              type="time"
              step={300}
              class="checkin-day-start"
              value={draft.day_starts_at}
              onInput={(e) => set({ day_starts_at: e.currentTarget.value })}
            />
            <small>A slot before this hour counts for the evening before.</small>
          </label>
          <label class="checkin-check">
            <input
              type="checkbox"
              checked={draft.notify}
              onChange={(e) => set({ notify: e.currentTarget.checked })}
            />
            Notify me when it is due
          </label>
          <p class="checkins-muted checkin-small">
            Times follow your time zone{timezone ? ` (${timezone})` : ''}, set in{' '}
            <a href="/settings#time-zone">Settings</a>.
          </p>
        </>
      )}
    </section>
  )
}

function ScoreEditor({ draft, set }: { draft: FormDraft; set: (patch: Partial<FormDraft>) => void }) {
  const scorable = draft.questions.filter(canScore)
  return (
    <section class="checkins-card checkin-editor-section">
      <label class="checkin-check checkin-section-toggle">
        <input
          type="checkbox"
          checked={draft.score_on}
          onChange={(e) => set({ score_on: e.currentTarget.checked })}
        />
        <strong>Add up answers into a score</strong>
      </label>
      {draft.score_on && (
        <>
          {scorable.length === 0 ? (
            <p class="checkins-muted checkin-small">Add a scale, number or yes/no question to score.</p>
          ) : (
            <fieldset class="checkin-field">
              <legend>Questions to add up</legend>
              {scorable.map((question) => (
                <label key={question.id} class="checkin-check">
                  <input
                    type="checkbox"
                    checked={draft.score_questions.includes(question.id)}
                    onChange={(e) =>
                      set({
                        score_questions: e.currentTarget.checked
                          ? [...draft.score_questions, question.id]
                          : draft.score_questions.filter((id) => id !== question.id),
                      })
                    }
                  />
                  {question.prompt || 'Untitled question'}
                </label>
              ))}
            </fieldset>
          )}
          <div class="checkin-field-row">
            <label class="checkin-field">
              <span>Multiply by</span>
              <input
                type="text"
                inputMode="decimal"
                value={draft.score_factor}
                onInput={(e) => set({ score_factor: e.currentTarget.value })}
              />
            </label>
            <label class="checkin-field checkin-field-wide">
              <span>Metric name</span>
              <input
                type="text"
                maxLength={50}
                value={draft.score_metric}
                placeholder="wellbeing_score"
                onInput={(e) => set({ score_metric: e.currentTarget.value })}
              />
            </label>
          </div>
          <small class="checkins-muted">{METRIC_NAME_RULE}</small>
        </>
      )}
    </section>
  )
}

function AddQuestions({
  questions,
  wasRoutine,
  onQuestions,
}: {
  questions: QuestionDraft[]
  wasRoutine: boolean
  onQuestions: (questions: QuestionDraft[]) => void
}) {
  const [addingIntake, setAddingIntake] = useState(false)
  const kept = questions.length === 1 && isBlankQuestion(questions[0]) ? [] : questions
  return (
    <>
      {addingIntake ? (
        <IntakeShortcut
          onAdd={(question) => {
            onQuestions([...kept, question])
            setAddingIntake(false)
          }}
          onCancel={() => setAddingIntake(false)}
        />
      ) : (
        <div class="checkin-actions checkin-add-questions">
          <button
            type="button"
            class="btn-secondary checkin-add-question"
            onClick={() => onQuestions([...questions, newQuestion('scale')])}
          >
            + Add question
          </button>
          <button
            type="button"
            class="btn-secondary checkin-add-question"
            onClick={() => setAddingIntake(true)}
          >
            + Add medication or supplement
          </button>
        </div>
      )}
      {draftIsRoutine(questions) && (
        <p class="checkin-routine-note" role="note">
          {wasRoutine
            ? 'This form is a routine: every required question has a preset answer, so it is confirmed in one tap.'
            : 'Every required question now has a preset answer, so this form becomes a routine: it can be confirmed in one tap.'}
        </p>
      )}
    </>
  )
}

function useActivitySchemas(): ActivitySchemas {
  const definitions = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
  })
  const catalog = useQuery({ queryFn: fetchActivityTypeCatalog, queryKey: ['activityTypeCatalog'] })
  const schemas: ActivitySchemas = new Map()
  for (const entry of catalog.data?.entries ?? []) schemas.set(entry.name, entry.data_schema)
  for (const definition of definitions.data ?? []) {
    schemas.set(definition.name, definition.data_schema ?? schemas.get(definition.name))
  }
  return new Map([...schemas].sort(([a], [b]) => a.localeCompare(b)))
}

function FormEditor({ existing, timezone }: { existing: CheckInForm | null; timezone: string | undefined }) {
  const { route } = useLocation()
  const refresh = useRefreshCheckIns()
  const activityTypes = useActivitySchemas()
  const [draft, setDraft] = useState<FormDraft>(() => (existing ? draftFromForm(existing) : emptyFormDraft()))
  const [errors, setErrors] = useState<string[]>([])
  const set = (patch: Partial<FormDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const setQuestions = (questions: QuestionDraft[]) =>
    set({
      questions,
      score_questions: draft.score_questions.filter((id) =>
        questions.some((q) => q.id === id && canScore(q)),
      ),
    })

  const built = buildForm(draft)
  const newVersion = existing !== null && built.ok && startsNewVersion(existing, built.value)

  const save = useMutation({
    mutationFn: async () => {
      if (!built.ok) throw new Error(built.errors[0])
      if (!existing) return addCheckInForm(toAddBody(built.value))
      const body = toUpdateBody(existing, built.value)
      return Object.keys(body).length === 0 ? existing : updateCheckInForm(existing.id, body)
    },
    onSuccess: async () => {
      await refresh()
      route('/check-ins')
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteCheckInForm(existing!.id),
    onSuccess: async () => {
      await refresh()
      route(`/check-ins?deleted=${encodeURIComponent(existing!.id)}`)
    },
  })

  const submit = (e: Event) => {
    e.preventDefault()
    if (!built.ok) return setErrors(built.errors)
    setErrors([])
    save.mutate()
  }

  return (
    <form class="checkin-editor" onSubmit={submit} noValidate>
      <section class="checkins-card checkin-editor-section">
        <label class="checkin-field">
          <span>Name</span>
          <input
            type="text"
            value={draft.name}
            maxLength={120}
            placeholder="Morning check-in"
            onInput={(e) => set({ name: e.currentTarget.value })}
          />
        </label>
        <label class="checkin-field">
          <span>
            Description <small>(optional)</small>
          </span>
          <textarea
            rows={2}
            maxLength={1000}
            value={draft.description}
            placeholder="Shown above the questions"
            onInput={(e) => set({ description: e.currentTarget.value })}
          />
        </label>
      </section>

      <h2>Questions</h2>
      <ol class="checkin-questions-editor">
        {draft.questions.map((question, index) => (
          <QuestionEditor
            key={question.id}
            question={question}
            index={index}
            count={draft.questions.length}
            activityTypes={activityTypes}
            onChange={(next) => setQuestions(draft.questions.map((q) => (q.id === question.id ? next : q)))}
            onMove={(by) => setQuestions(moveQuestion(draft.questions, index, by))}
            onRemove={() => setQuestions(draft.questions.filter((q) => q.id !== question.id))}
          />
        ))}
      </ol>
      <AddQuestions
        questions={draft.questions}
        wasRoutine={existing?.is_routine ?? false}
        onQuestions={setQuestions}
      />

      <h2>Score and schedule</h2>
      <ScoreEditor draft={draft} set={set} />
      <ScheduleEditor draft={draft} set={set} timezone={timezone} />

      {newVersion && (
        <p class="checkin-version-note" role="note">
          These changes start a new version of the form. Earlier answers keep the questions they answered.
        </p>
      )}
      {errors.length > 0 && (
        <ul class="checkin-error" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {save.error && (
        <p class="checkin-error" role="alert">
          {save.error.message}
        </p>
      )}
      <div class="checkin-actions checkin-editor-actions">
        <button type="submit" class="btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : existing ? 'Save' : 'Create form'}
        </button>
        <a class="btn-secondary" href={existing ? `/check-ins/${existing.id}` : '/check-ins'}>
          Cancel
        </a>
        {existing && !existing.deleted_at && (
          <button
            type="button"
            class="btn-danger checkin-delete-form"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? 'Deleting…' : 'Delete form'}
          </button>
        )}
      </div>
      {remove.error && (
        <p class="checkin-error" role="alert">
          {remove.error.message}
        </p>
      )}
    </form>
  )
}

export function CheckInEditor() {
  const isLoggedIn = Boolean(auth.value.token)
  const { params } = useRoute()
  const id = params.id as string | undefined
  const form = useQuery({
    enabled: isLoggedIn && Boolean(id),
    queryFn: () => fetchCheckInForm(id!),
    queryKey: checkInKeys.form(id ?? 'new'),
  })
  const due = useQuery({ enabled: isLoggedIn, queryFn: fetchDue, queryKey: checkInKeys.due })

  if (!isLoggedIn) {
    return (
      <div class="checkins-page">
        <h1>Check-in form</h1>
        <p>Please log in to edit your check-ins.</p>
      </div>
    )
  }
  if (id && form.isLoading) return <div class="checkins-page checkins-muted">Loading…</div>
  if (id && !form.data) {
    return (
      <div class="checkins-page">
        <h1>Check-in form</h1>
        <p>That form was not found.</p>
        <a href="/check-ins">Back to check-ins</a>
      </div>
    )
  }

  return (
    <div class="checkins-page checkin-editor-page">
      <p class="checkins-back">
        <a href="/check-ins">← Check-ins</a>
      </p>
      <h1>{id ? `Edit ${form.data!.name}` : 'New check-in form'}</h1>
      <FormEditor key={id ?? 'new'} existing={form.data ?? null} timezone={due.data?.timezone} />
    </div>
  )
}
