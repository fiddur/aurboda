/**
 * An emulation of how Mastodon's web UI shows an article's status, in Mastodon's default dark
 * look whatever the app theme: the text Mastodon keeps, the first images in its cropped grid,
 * the hashtag bar, and the "Read more" fold of a tall status.
 */
import type { ArticlePreviewAttachment, FeedVisibility } from '@aurboda/api-spec'

import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { PostAuthor } from '../pages/Feed/FeedPostCard'

import { sanitizeRemoteHtml } from '../utils/markdown'
import { attachmentImageSrc, MASTODON_FOLD_HEIGHT, mastodonGridLayout } from './mastodon-preview'
import './MastodonStatusPreview.css'

const VISIBILITY_LABEL: Record<FeedVisibility, string> = {
  followers: '🔒 Followers only',
  public: '🌐 Public',
  unlisted: '🔓 Quiet public',
}

const MediaCell = ({ attachment }: { attachment: ArticlePreviewAttachment }) => {
  const src = attachmentImageSrc(attachment)
  return (
    <div class="mastodon-media-cell">
      {src ? (
        <img src={src} alt={attachment.name} loading="lazy" />
      ) : (
        <div class="mastodon-media-empty">No data to draw</div>
      )}
      <span class="mastodon-media-alt" title={attachment.name}>
        ALT
      </span>
    </div>
  )
}

const MediaGrid = ({ attachments }: { attachments: ArticlePreviewAttachment[] }) => {
  if (attachments.length === 0) return null
  const layout = mastodonGridLayout(attachments.length)
  const [only] = attachments
  const ratio =
    layout === 'single' && only.width && only.height
      ? { aspectRatio: `${only.width} / ${only.height}` }
      : undefined
  return (
    <div class={`mastodon-media mastodon-media--${layout}`} style={ratio}>
      {attachments.map((attachment) => (
        <MediaCell key={attachment.figure} attachment={attachment} />
      ))}
    </div>
  )
}

/** Whether the rendered text is taller than Mastodon lets a status be before folding it. */
const useTallContent = (html: string) => {
  const ref = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => setTall(node.scrollHeight > MASTODON_FOLD_HEIGHT)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [html])
  return { ref, tall }
}

export const MastodonStatusPreview = ({
  author,
  content,
  attachments,
  hashtagBar,
  visibility,
}: {
  author: PostAuthor
  /** `mastodon.content` from the preview: what Mastodon keeps of the Note text. */
  content: string
  attachments: ArticlePreviewAttachment[]
  hashtagBar: string[]
  visibility: FeedVisibility
}) => {
  const html = useMemo(() => sanitizeRemoteHtml(content), [content])
  const { ref, tall } = useTallContent(html)
  const [expanded, setExpanded] = useState(false)
  const folded = tall && !expanded
  return (
    <div class="mastodon-preview">
      <article class="mastodon-status" aria-label="As Mastodon shows it">
        <header class="mastodon-status-head">
          <img class="mastodon-status-avatar" src={author.avatarUrl} alt="" width={46} height={46} />
          <div class="mastodon-status-ident">
            <bdi class="mastodon-status-name">{author.displayName}</bdi>
            <span class="mastodon-status-handle">{author.handle}</span>
          </div>
          <span class="mastodon-status-time">now</span>
        </header>
        <div
          ref={ref}
          class={
            folded ? 'mastodon-status-content mastodon-status-content--folded' : 'mastodon-status-content'
          }
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {tall && (
          <button type="button" class="mastodon-status-read-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Read less' : 'Read more'}
          </button>
        )}
        <MediaGrid attachments={attachments.filter((a) => a.shown_in_mastodon)} />
        {hashtagBar.length > 0 && (
          <div class="mastodon-hashtag-bar">
            {hashtagBar.map((tag) => (
              <span key={tag} class="mastodon-hashtag">
                #{tag}
              </span>
            ))}
          </div>
        )}
        <footer class="mastodon-status-footer">{VISIBILITY_LABEL[visibility]}</footer>
      </article>
      {tall && (
        <p class="mastodon-preview-fold-note">Long posts are folded like this in Mastodon timelines.</p>
      )}
    </div>
  )
}
