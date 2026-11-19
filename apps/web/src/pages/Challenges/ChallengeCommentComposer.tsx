import type { ChallengeThreadAudience, ChallengeThreadReply } from '@aurboda/api-spec'

import { feedPostMessageMaxLength } from '@aurboda/api-spec'
import { useState } from 'preact/hooks'

import { type VisibilityOption, VisibilitySelector } from '../../components/VisibilitySelector'
import { addChallengeComment } from '../../state/api'
import {
  AUDIENCE_LABEL,
  audienceNote,
  defaultAudience,
  readRememberedAudience,
  rememberAudience,
} from './challenge-thread-view'

const AUDIENCE_OPTIONS: VisibilityOption<ChallengeThreadAudience>[] = [
  {
    hint: 'Only the host and the members see it.',
    label: AUDIENCE_LABEL.participants,
    value: 'participants',
  },
  {
    hint: "Anyone who can see the challenge; sent to your followers' servers as an unlisted reply.",
    label: AUDIENCE_LABEL.public,
    value: 'public',
  },
]

const browserStorage = () => window.localStorage

export function ChallengeCommentComposer({
  challengeUrl,
  allowed,
  parent,
  onPosted,
  onCancel,
}: {
  challengeUrl: string
  allowed: ChallengeThreadAudience[]
  /** The entry being answered; absent for a top-level comment. */
  parent?: Pick<ChallengeThreadReply, 'audience' | 'id'>
  onPosted: () => void
  onCancel?: () => void
}) {
  const [text, setText] = useState('')
  const [audience, setAudience] = useState(() =>
    defaultAudience(allowed, readRememberedAudience(browserStorage)),
  )
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const note = audienceNote(allowed, parent)
  const chosen = audience && allowed.includes(audience) ? audience : defaultAudience(allowed, null)

  const choose = (next: ChallengeThreadAudience) => {
    setAudience(next)
    rememberAudience(browserStorage, next)
  }

  const submit = () => {
    const message = text.trim()
    if (message === '' || sending || !chosen) return
    setError(null)
    setSending(true)
    addChallengeComment({
      audience: chosen,
      challenge_url: challengeUrl,
      in_reply_to_id: parent?.id,
      message,
    })
      .then(() => {
        setText('')
        onPosted()
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setSending(false))
  }

  const label = parent ? 'Write a reply' : 'Write a comment'
  return (
    <div class="feed-reply-composer challenge-comment-composer">
      <textarea
        class="feed-reply-text"
        value={text}
        rows={3}
        maxLength={feedPostMessageMaxLength}
        placeholder={`${label}…`}
        aria-label={label}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />
      {note === null && chosen ? (
        <VisibilitySelector
          value={chosen}
          onChange={choose}
          options={AUDIENCE_OPTIONS}
          name={`challenge-comment-audience-${parent?.id ?? 'top'}`}
          legend="Who can see it"
          compact
        />
      ) : (
        note && <p class="challenge-comment-note">{note}</p>
      )}
      <div class="feed-reply-composer-actions">
        <button
          type="button"
          class="btn-primary"
          disabled={sending || text.trim() === '' || !chosen}
          onClick={submit}
        >
          {sending ? 'Posting…' : parent ? 'Post reply' : 'Post'}
        </button>
        {onCancel && (
          <button type="button" class="btn-secondary" disabled={sending} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error && <p class="challenge-comment-error">{error}</p>}
    </div>
  )
}
