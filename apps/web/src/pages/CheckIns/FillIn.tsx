import type { CheckIn, CheckInForm, CheckInQuestion } from '@aurboda/api-spec'

import { useMutation, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { MiniTrendChart } from '../../components/MiniTrendChart'
import {
  deleteCheckIn,
  fetchCheckInForm,
  fetchCheckIns,
  restoreCheckIn,
  submitCheckIn,
  updateCheckIn,
} from '../../state/api'
import { auth } from '../../state/auth'
import { CHART_PRIMARY } from '../../theme'
import {
  type AnswerDrafts,
  answerProblems,
  answersToDrafts,
  draftsToAnswers,
  fromLocalInput,
  missingRequired,
  toLocalInput,
} from './answers'
import { checkInSeries, formatAnswer, formatNumber, whenLine } from './check-in-view'
import { checkInKeys, useRefreshCheckIns } from './queries'
import { QuestionInput } from './QuestionInput'
import { UndoBar } from './UndoBar'
import './style.css'

const HISTORY_LIMIT = 100

interface AnswerFieldsProps {
  questions: readonly CheckInQuestion[]
  drafts: AnswerDrafts
  setDrafts: (drafts: AnswerDrafts) => void
  showMissing: boolean
  idPrefix: string
}

function AnswerFields({ questions, drafts, setDrafts, showMissing, idPrefix }: AnswerFieldsProps) {
  const missing = new Set(showMissing ? missingRequired(questions, drafts).map((q) => q.key) : [])
  return (
    <>
      {questions.map((question) => (
        <QuestionInput
          key={question.key}
          idPrefix={idPrefix}
          question={question}
          value={drafts[question.key]}
          missing={missing.has(question.key)}
          onChange={(value) => setDrafts({ ...drafts, [question.key]: value })}
        />
      ))}
    </>
  )
}

function Saved({ checkIn, onAgain }: { checkIn: CheckIn; onAgain: () => void }) {
  return (
    <div class="checkins-card checkin-saved" role="status">
      <p class="checkin-saved-title">Saved.</p>
      {checkIn.score !== null && <p>Your score: {formatNumber(checkIn.score)}</p>}
      {checkIn.log_errors?.length ? (
        <p class="checkin-error">
          Not saved as a metric: {checkIn.log_errors.map((e) => `${e.question_key} (${e.error})`).join('; ')}
        </p>
      ) : null}
      <div class="checkin-actions">
        <a class="btn-primary" href="/check-ins">
          Back to check-ins
        </a>
        <button type="button" class="btn-secondary" onClick={onAgain}>
          Fill in again
        </button>
      </div>
    </div>
  )
}

function FillInForm({
  form,
  slot,
  onSaved,
}: {
  form: CheckInForm
  slot: string | undefined
  onSaved: (c: CheckIn) => void
}) {
  const refresh = useRefreshCheckIns()
  const [drafts, setDrafts] = useState<AnswerDrafts>({})
  const [note, setNote] = useState('')
  const [answeredAt, setAnsweredAt] = useState(() => toLocalInput(new Date()))
  const [timeChanged, setTimeChanged] = useState(false)
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const problems = answerProblems(form.questions, drafts)
  const ready = problems.length === 0

  const save = async (e: Event) => {
    e.preventDefault()
    setTried(true)
    if (!ready) return
    const at = timeChanged ? fromLocalInput(answeredAt) : null
    if (timeChanged && at === null) return setError('Pick the time you answered.')
    setSaving(true)
    setError(null)
    try {
      const checkIn = await submitCheckIn({
        answers: draftsToAnswers(form.questions, drafts),
        form_id: form.id,
        ...(at ? { answered_at: at } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(slot ? { scheduled_for: slot } : {}),
      })
      await refresh()
      onSaved(checkIn)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save the check-in. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form class="checkins-card checkin-fill-form" onSubmit={save} noValidate>
      {slot && <p class="checkins-muted">For the {format(new Date(slot), 'HH:mm')} check-in.</p>}
      <AnswerFields
        questions={form.questions}
        drafts={drafts}
        setDrafts={setDrafts}
        showMissing={tried}
        idPrefix="fill"
      />
      <label class="checkin-field">
        <span>
          Note <small>(optional)</small>
        </span>
        <textarea rows={2} maxLength={2000} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </label>
      <label class="checkin-field checkin-answered-at">
        <span>Answered at</span>
        <input
          type="datetime-local"
          value={answeredAt}
          onInput={(e) => {
            setAnsweredAt(e.currentTarget.value)
            setTimeChanged(true)
          }}
        />
        {!timeChanged && <small>Now. Change it when filling in late.</small>}
      </label>
      {tried && !ready && (
        <ul class="checkin-error" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {error && (
        <p class="checkin-error" role="alert">
          {error}
        </p>
      )}
      <div class="checkin-actions">
        <button
          type="submit"
          class={`btn-primary checkin-save${ready ? '' : ' is-disabled'}`}
          aria-disabled={!ready}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function EditCheckIn({ checkIn, onDone }: { checkIn: CheckIn; onDone: () => void }) {
  const refresh = useRefreshCheckIns()
  const [drafts, setDrafts] = useState<AnswerDrafts>(() =>
    answersToDrafts(checkIn.questions, checkIn.answers),
  )
  const [note, setNote] = useState(checkIn.note ?? '')
  const [answeredAt, setAnsweredAt] = useState(() => toLocalInput(new Date(checkIn.answered_at)))
  const [tried, setTried] = useState(false)
  const problems = answerProblems(checkIn.questions, drafts)
  const save = useMutation({
    mutationFn: () => {
      const at = fromLocalInput(answeredAt)
      if (at === null) throw new Error('Pick the time you answered.')
      return updateCheckIn(checkIn.id, {
        answered_at: at,
        answers: draftsToAnswers(checkIn.questions, drafts),
        note: note.trim() === '' ? null : note.trim(),
      })
    },
    onSuccess: async () => {
      await refresh()
      onDone()
    },
  })
  return (
    <form
      class="checkin-edit"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (problems.length === 0) save.mutate()
      }}
    >
      <AnswerFields
        questions={checkIn.questions}
        drafts={drafts}
        setDrafts={setDrafts}
        showMissing={tried}
        idPrefix={`edit-${checkIn.id}`}
      />
      <label class="checkin-field">
        <span>Note</span>
        <textarea rows={2} maxLength={2000} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </label>
      <label class="checkin-field checkin-answered-at">
        <span>Answered at</span>
        <input
          type="datetime-local"
          value={answeredAt}
          onInput={(e) => setAnsweredAt(e.currentTarget.value)}
        />
      </label>
      {tried && problems.length > 0 && (
        <ul class="checkin-error" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {save.error && (
        <p class="checkin-error" role="alert">
          {save.error.message}
        </p>
      )}
      <div class="checkin-actions">
        <button type="submit" class="btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" class="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function HistoryRow({
  checkIn,
  now,
  onDeleted,
}: {
  checkIn: CheckIn
  now: Date
  onDeleted: (c: CheckIn) => void
}) {
  const refresh = useRefreshCheckIns()
  const [editing, setEditing] = useState(false)
  const remove = useMutation({
    mutationFn: () => deleteCheckIn(checkIn.id),
    onSuccess: async () => {
      await refresh()
      onDeleted(checkIn)
    },
  })
  return (
    <li class="checkin-history-row">
      <div class="checkin-history-head">
        <strong>{whenLine(new Date(checkIn.answered_at), now)}</strong>
        {checkIn.score !== null && <span class="checkin-score">Score {formatNumber(checkIn.score)}</span>}
        {!editing && (
          <span class="checkin-history-actions">
            <button type="button" class="checkin-link-btn" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              class="checkin-link-btn danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <EditCheckIn checkIn={checkIn} onDone={() => setEditing(false)} />
      ) : (
        <dl class="checkin-answers">
          {checkIn.questions.map((question) => (
            <div key={question.key}>
              <dt>{question.prompt}</dt>
              <dd>{formatAnswer(question, checkIn.answers[question.key])}</dd>
            </div>
          ))}
          {checkIn.note && (
            <div>
              <dt>Note</dt>
              <dd>{checkIn.note}</dd>
            </div>
          )}
        </dl>
      )}
      {remove.error && (
        <p class="checkin-error" role="alert">
          {remove.error.message}
        </p>
      )}
    </li>
  )
}

function History({ form }: { form: CheckInForm }) {
  const refresh = useRefreshCheckIns()
  const [deleted, setDeleted] = useState<CheckIn | null>(null)
  const { data, isLoading } = useQuery({
    queryFn: () => fetchCheckIns({ form_id: form.id, limit: HISTORY_LIMIT }),
    queryKey: checkInKeys.history(form.id),
  })
  const checkIns = data?.check_ins ?? []
  const series = checkInSeries(form, checkIns)
  const now = new Date()
  return (
    <section class="checkins-section checkin-history">
      <h2>History</h2>
      {deleted && (
        <UndoBar
          message="Check-in deleted."
          onUndo={async () => {
            await restoreCheckIn(deleted.id)
            await refresh()
          }}
          onClose={() => setDeleted(null)}
        />
      )}
      {series && series.points.length >= 2 && (
        <div class="checkins-card checkin-chart">
          <p class="checkin-chart-title">
            {series.label}{' '}
            <a href={`/metric/${encodeURIComponent(series.metric)}`} class="checkin-chart-link">
              See {series.metric}
            </a>
          </p>
          <MiniTrendChart data={series.points} color={CHART_PRIMARY} />
        </div>
      )}
      {isLoading ? (
        <p class="checkins-muted">Loading…</p>
      ) : checkIns.length === 0 ? (
        <p class="checkins-muted">No answers yet.</p>
      ) : (
        <ul class="checkins-card checkins-list">
          {checkIns.map((checkIn) => (
            <HistoryRow key={checkIn.id} checkIn={checkIn} now={now} onDeleted={setDeleted} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function CheckInFill() {
  const isLoggedIn = Boolean(auth.value.token)
  const { params } = useRoute()
  const { query } = useLocation()
  const id = params.id
  const [saved, setSaved] = useState<CheckIn | null>(null)
  const [round, setRound] = useState(0)
  const {
    data: form,
    isLoading,
    error,
  } = useQuery({
    enabled: isLoggedIn && Boolean(id),
    queryFn: () => fetchCheckInForm(id),
    queryKey: checkInKeys.form(id),
  })

  if (!isLoggedIn) {
    return (
      <div class="checkins-page">
        <h1>Check-in</h1>
        <p>Please log in to fill in your check-ins.</p>
      </div>
    )
  }
  if (isLoading) return <div class="checkins-page checkins-muted">Loading…</div>
  if (error || !form) {
    return (
      <div class="checkins-page">
        <h1>Check-in</h1>
        <p>That form was not found.</p>
        <a href="/check-ins">Back to check-ins</a>
      </div>
    )
  }

  const slot = saved || round > 0 ? undefined : query.slot

  return (
    <div class="checkins-page checkin-fill-page">
      <p class="checkins-back">
        <a href="/check-ins">← Check-ins</a>
      </p>
      <div class="checkins-header">
        <h1>{form.name}</h1>
        <a class="btn-secondary" href={`/check-ins/${form.id}/edit`}>
          Edit form
        </a>
      </div>
      {form.description && <p class="checkin-form-description">{form.description}</p>}
      {form.deleted_at ? (
        <p class="checkins-muted">
          This form is deleted. Restore it from Check-ins → Recently deleted to fill it in.
        </p>
      ) : saved ? (
        <Saved
          checkIn={saved}
          onAgain={() => {
            setSaved(null)
            setRound((n) => n + 1)
          }}
        />
      ) : (
        <FillInForm key={round} form={form} slot={slot} onSaved={setSaved} />
      )}
      <History form={form} />
    </div>
  )
}
