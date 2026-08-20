/**
 * Share a challenge to the user's federated feed (#994): a personal note
 * (markdown, previewed through the shared sanitiser) plus the challenge's
 * canonical join-by-URL link, with the usual feed audience choice. The server
 * resolves the linked name/URL from the challenge (or joined participation)
 * itself — the dialog only sends which one to share.
 */
import type { FeedVisibility } from '@aurboda/api-spec'

import { feedPostMessageMaxLength } from '@aurboda/api-spec'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { shareChallenge } from '../state/api'
import { renderMarkdown } from '../utils/markdown'
import { FEED_VISIBILITY_OPTIONS, VisibilitySelector } from './VisibilitySelector'
import './ShareActivityDialog.css'

interface Props {
  /** One of the user's own challenges (exclusive with `participationId`). */
  challengeId?: string
  /** A challenge the user joined (exclusive with `challengeId`). */
  participationId?: string
  /** Shown in the dialog and the preview; the server resolves its own copy. */
  challengeName: string
  /** Shown in the preview; the server resolves its own copy. */
  challengeUrl: string
  onClose: () => void
}

export function ShareChallengeDialog({
  challengeId,
  participationId,
  challengeName,
  challengeUrl,
  onClose,
}: Props) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [visibility, setVisibility] = useState<FeedVisibility>('public')

  const mutation = useMutation({
    mutationFn: () =>
      shareChallenge({
        challenge_id: challengeId,
        message,
        participation_id: participationId,
        visibility,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      onClose()
    },
  })

  return (
    <div class="share-dialog-backdrop" onClick={onClose}>
      <div class="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="share-dialog-header">
          <h2>Share challenge</h2>
          <button type="button" class="share-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p class="share-dialog-subtitle">
          Invite your followers to <strong>{challengeName}</strong> — the post links to the challenge page,
          where anyone can join.
        </p>

        <fieldset class="share-dialog-group">
          <legend>Message</legend>
          <p class="share-dialog-note">Optional note shown above the link. Markdown works.</p>
          <textarea
            class="share-dialog-message"
            rows={4}
            maxLength={feedPostMessageMaxLength}
            value={message}
            onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
            placeholder="Why should people join?"
          />
        </fieldset>

        <fieldset class="share-dialog-group">
          <legend>Preview</legend>
          <div class="share-dialog-preview">
            <p>
              <strong>{challengeName}</strong>
            </p>
            {message.trim() !== '' && (
              // Same sanitising renderer as article prose (#910) — the backend
              // runs the authored markdown through its own equivalent boundary.
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message) }} />
            )}
            <p>
              <a href={challengeUrl} target="_blank" rel="noopener noreferrer">
                {challengeUrl}
              </a>
            </p>
          </div>
        </fieldset>

        <VisibilitySelector
          name="challenge-share-visibility"
          options={FEED_VISIBILITY_OPTIONS}
          value={visibility}
          onChange={setVisibility}
        />

        {mutation.error && (
          <p class="share-dialog-error">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to share'}
          </p>
        )}

        <div class="share-dialog-actions">
          <button type="button" class="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  )
}
