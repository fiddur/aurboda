import { sessionUrl } from './constants'
import { type SessionDraft, sessionSummary } from './sessionModel'
import { lastSetLabel, startedLabel, type UnfinishedAction, unfinishedAction } from './startModel'

export const continueUrl = (draft: Pick<SessionDraft, 'id'>): string =>
  draft.id ? sessionUrl(draft.id) : '/strength/live'

export const UnfinishedCard = ({
  draft,
  busy,
  error,
  onFinish,
  onDiscard,
}: {
  draft: SessionDraft
  busy?: UnfinishedAction
  error?: string
  onFinish: () => void
  onDiscard: () => void
}) => {
  const now = new Date()
  return (
    <section class="strength-card strength-unfinished">
      <h2>Unfinished session</h2>
      <p>{startedLabel(new Date(draft.start_time), now)}</p>
      <p class="strength-muted">
        {sessionSummary(draft.blocks)}. {lastSetLabel(draft.last_set_at, now) ?? ''}
      </p>
      {error && <p class="strength-error">{error}</p>}
      <div class="strength-row-actions">
        <a class="btn-primary" href={continueUrl(draft)}>
          Continue
        </a>
        {unfinishedAction(draft) === 'finish' && (
          <button type="button" class="btn-secondary" onClick={onFinish} disabled={busy !== undefined}>
            {busy === 'finish' ? 'Finishing…' : 'Finish it'}
          </button>
        )}
        <button type="button" class="btn-secondary" onClick={onDiscard} disabled={busy !== undefined}>
          {busy === 'discard' ? 'Discarding…' : 'Discard'}
        </button>
      </div>
    </section>
  )
}

export const UnfinishedLine = ({ draft }: { draft: SessionDraft }) => (
  <section class="strength-card strength-unfinished strength-unfinished-line">
    <p>
      Unfinished session — {startedLabel(new Date(draft.start_time), new Date())} ·{' '}
      {sessionSummary(draft.blocks)}
    </p>
    <a class="btn-primary" href={continueUrl(draft)}>
      Continue
    </a>
  </section>
)
