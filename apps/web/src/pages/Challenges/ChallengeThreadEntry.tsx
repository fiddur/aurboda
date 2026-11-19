import type { ChallengeThreadEntry, ChallengeThreadReply, ChallengeThreadViewer } from '@aurboda/api-spec'

import { feedPostMessageMaxLength } from '@aurboda/api-spec'
import { formatDistanceToNow } from 'date-fns'
import { useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { apiErrorMessage, deleteFeedPost, setChallengeCommentHidden, updateFeedPost } from '../../state/api'
import { ActorName } from '../Feed/ActorName'
import { FALLBACK_AVATAR } from '../Feed/TimelineEntryHead'
import {
  allowedAudiences,
  audienceBadge,
  type EntryActions,
  entryActions,
  kindLabel,
} from './challenge-thread-view'
import { ChallengeCommentComposer } from './ChallengeCommentComposer'

function EntryHead({ entry }: { entry: ChallengeThreadReply }) {
  const { author } = entry
  const name = author.display_name ?? author.handle ?? author.actor_uri
  const published = new Date(entry.published_at)
  const time = (
    <time title={published.toLocaleString()}>{formatDistanceToNow(published, { addSuffix: true })}</time>
  )
  const kind = kindLabel(entry.kind)
  const badge = audienceBadge(entry.audience)
  return (
    <header class="feed-post-head">
      <img class="feed-post-avatar" src={author.avatar_url ?? FALLBACK_AVATAR} alt="" loading="lazy" />
      <div class="feed-post-ident">
        <span class="feed-post-name">
          <ActorName name={name} actorUri={author.actor_uri} />
          {kind && <span class="challenge-comment-kind"> · {kind}</span>}
        </span>
        <span class="feed-post-handle">
          {author.handle && <>{author.handle} · </>}
          {entry.url ? (
            <a href={entry.url} target="_blank" rel="noopener noreferrer nofollow">
              {time}
            </a>
          ) : (
            time
          )}
          {entry.edited_at && <span title={new Date(entry.edited_at).toLocaleString()}> · edited</span>}
        </span>
        {(badge || entry.hidden) && (
          <span class="challenge-comment-marks">
            {entry.hidden && <span class="challenge-comment-badge">Hidden</span>}
            {badge && <span class="challenge-comment-badge">{badge}</span>}
          </span>
        )}
      </div>
    </header>
  )
}

function EntryEditor({
  postId,
  initial,
  onSaved,
  onCancel,
}: {
  postId: string
  initial: string
  onSaved: () => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = () => {
    const message = text.trim()
    if (message === '' || saving) return
    setError(null)
    setSaving(true)
    updateFeedPost(postId, { message })
      .then(onSaved)
      .catch((cause: unknown) => setError(apiErrorMessage(cause, 'Couldn’t save the comment.')))
      .finally(() => setSaving(false))
  }

  return (
    <div class="feed-reply-composer challenge-comment-composer">
      <textarea
        class="feed-reply-text"
        value={text}
        rows={3}
        maxLength={feedPostMessageMaxLength}
        aria-label="Edit comment"
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />
      <div class="feed-reply-composer-actions">
        <button type="button" class="btn-primary" disabled={saving || text.trim() === ''} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" class="btn-secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p class="challenge-comment-error">{error}</p>}
    </div>
  )
}

function EntryActionsRow({
  entry,
  actions,
  challengeUrl,
  onChanged,
  onEdit,
  onReply,
}: {
  entry: ChallengeThreadReply
  actions: EntryActions
  challengeUrl: string
  onChanged: () => void
  onEdit: () => void
  onReply: (entry: ChallengeThreadReply) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const postId = entry.own_post_id

  const run = (request: () => Promise<unknown>) => {
    setError(null)
    setBusy(true)
    request()
      .then(onChanged)
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div class="challenge-comment-actions">
        {actions.reply && (
          <button type="button" class="challenge-comment-action" onClick={() => onReply(entry)}>
            Reply
          </button>
        )}
        {actions.edit && (
          <button type="button" class="challenge-comment-action" onClick={onEdit}>
            Edit
          </button>
        )}
        {actions.delete && postId && (
          <ConfirmButton
            label="Delete"
            confirmMessage="Delete this comment?"
            buttonClass="challenge-comment-action"
            isPending={busy}
            onConfirm={() =>
              run(() =>
                deleteFeedPost(postId).catch((cause: unknown) => {
                  throw new Error(apiErrorMessage(cause, 'Couldn’t delete the comment.'))
                }),
              )
            }
          />
        )}
        {(actions.hide || actions.unhide) && (
          <button
            type="button"
            class="challenge-comment-action"
            disabled={busy}
            onClick={() => run(() => setChallengeCommentHidden(challengeUrl, entry.id, actions.hide))}
          >
            {actions.hide ? 'Hide' : 'Unhide'}
          </button>
        )}
      </div>
      {error && <p class="challenge-comment-error">{error}</p>}
    </>
  )
}

function EntryBody({
  entry,
  viewer,
  challengeUrl,
  onChanged,
  onReply,
}: {
  entry: ChallengeThreadReply
  viewer: ChallengeThreadViewer | undefined
  challengeUrl: string
  onChanged: () => void
  onReply: (entry: ChallengeThreadReply) => void
}) {
  const [editing, setEditing] = useState(false)
  const actions = viewer ? entryActions(entry, viewer) : null

  return (
    <div class={`challenge-comment${entry.hidden ? ' challenge-comment-hidden' : ''}`}>
      <EntryHead entry={entry} />
      {editing && entry.own_post_id ? (
        <EntryEditor
          postId={entry.own_post_id}
          initial={entry.message ?? ''}
          onSaved={() => {
            setEditing(false)
            onChanged()
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        /* Sanitised server-side (the shared feed sanitiser, challenge-thread service) — safe to render. */
        <div
          class="feed-post-content challenge-comment-content"
          dangerouslySetInnerHTML={{ __html: entry.content }}
        />
      )}
      {actions && !editing && (
        <EntryActionsRow
          entry={entry}
          actions={actions}
          challengeUrl={challengeUrl}
          onChanged={onChanged}
          onEdit={() => setEditing(true)}
          onReply={onReply}
        />
      )}
    </div>
  )
}

export function ChallengeThreadItem({
  entry,
  viewer,
  challengeUrl,
  onChanged,
}: {
  entry: ChallengeThreadEntry
  viewer: ChallengeThreadViewer | undefined
  challengeUrl: string
  onChanged: () => void
}) {
  const [replyTo, setReplyTo] = useState<ChallengeThreadReply | null>(null)
  return (
    <li class="challenge-comment-item">
      <EntryBody
        entry={entry}
        viewer={viewer}
        challengeUrl={challengeUrl}
        onChanged={onChanged}
        onReply={setReplyTo}
      />
      {(entry.replies.length > 0 || replyTo) && (
        <ul class="challenge-comment-replies">
          {entry.replies.map((reply) => (
            <li key={reply.id}>
              <EntryBody
                entry={reply}
                viewer={viewer}
                challengeUrl={challengeUrl}
                onChanged={onChanged}
                onReply={setReplyTo}
              />
            </li>
          ))}
          {replyTo && viewer && (
            <li>
              <ChallengeCommentComposer
                key={replyTo.id}
                challengeUrl={challengeUrl}
                allowed={allowedAudiences(viewer, replyTo)}
                parent={replyTo}
                onPosted={() => {
                  setReplyTo(null)
                  onChanged()
                }}
                onCancel={() => setReplyTo(null)}
              />
            </li>
          )}
        </ul>
      )}
    </li>
  )
}
