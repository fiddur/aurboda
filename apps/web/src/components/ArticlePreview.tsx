/**
 * The article editor's preview: the post as Aurboda's feed draws it (the real `FeedPostCard`) and
 * as Mastodon's web UI would show what Aurboda sends. `ArticleEditorPanes` lays the form and the
 * preview out: side by side on a wide screen, one pane at a time below that.
 */
import type { FeedPost } from '@aurboda/api-spec'
import type { ComponentChildren } from 'preact'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import type { PostAuthor } from '../pages/Feed/FeedPostCard'
import type { ArticleEditorState } from './article-editor-body'

import { FeedPostCard } from '../pages/Feed/FeedPostCard'
import { previewArticle } from '../state/api'
import { buildPreviewArticle, previewRequest } from './article-editor-body'
import { MastodonStatusPreview } from './MastodonStatusPreview'
import './ArticlePreview.css'

export type PreviewView = 'aurboda' | 'mastodon'
export type EditorPane = 'write' | PreviewView

/** At least this wide, the editor shows the form and the preview side by side. */
export const WIDE_EDITOR_QUERY = '(min-width: 1280px)'

const PANE_LABELS: Record<EditorPane, string> = { aurboda: 'Aurboda', mastodon: 'Mastodon', write: 'Write' }

const PREVIEW_DEBOUNCE_MS = 500

const useDebounced = <T,>(value: T, key: string): T => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key])
  return debounced
}

const previewPost = (state: ArticleEditorState, tags: string[]): FeedPost => {
  const now = new Date().toISOString()
  return {
    activity_id: null,
    article: buildPreviewArticle(state),
    created_at: now,
    id: 'preview',
    include_chart: false,
    include_exercises: false,
    include_map: false,
    included_metrics: [],
    kind: 'article',
    series_metrics: [],
    tags,
    updated_at: now,
    visibility: state.visibility,
  }
}

export const ArticlePreview = ({
  state,
  view,
  author,
}: {
  state: ArticleEditorState
  view: PreviewView
  author: PostAuthor
}) => {
  const debounced = useDebounced(state, JSON.stringify(state))
  const request = previewRequest(debounced)
  const requestKey = JSON.stringify(request)
  const { data, isError } = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => previewArticle(request),
    queryKey: ['article-preview', requestKey],
    staleTime: 60_000,
  })
  const tags = data?.tags ?? debounced.tags ?? []

  return (
    <div class="article-preview">
      {data?.publish_error && <p class="article-preview-error">Not publishable yet: {data.publish_error}</p>}
      {view === 'aurboda' ? (
        <FeedPostCard post={previewPost(debounced, tags)} author={author} permalink={false} />
      ) : data?.mastodon ? (
        <>
          <MastodonStatusPreview
            author={author}
            content={data.mastodon.content}
            attachments={data.attachments ?? []}
            hashtagBar={data.mastodon.hashtag_bar}
            visibility={debounced.visibility}
          />
          {(data.notes ?? []).length > 0 && (
            <ul class="article-preview-notes">
              {data.notes?.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p class="article-preview-status">
          {isError ? 'The preview could not be loaded.' : 'Loading preview…'}
        </p>
      )}
    </div>
  )
}

const PaneSwitch = ({
  panes,
  value,
  onChange,
}: {
  panes: EditorPane[]
  value: EditorPane
  onChange: (pane: EditorPane) => void
}) => (
  <div class="article-pane-switch" role="tablist" aria-label="Editor view">
    {panes.map((pane) => (
      <button
        key={pane}
        type="button"
        role="tab"
        aria-selected={pane === value}
        class={pane === value ? 'article-pane-tab article-pane-tab--active' : 'article-pane-tab'}
        onClick={() => onChange(pane)}
      >
        {PANE_LABELS[pane]}
      </button>
    ))}
  </div>
)

/**
 * The form (`children`) and the preview. The form stays mounted while a preview shows, since its
 * block editors hold state; on a wide screen the preview is always on beside it.
 */
export const ArticleEditorPanes = ({
  wide,
  state,
  author,
  children,
}: {
  wide: boolean
  state: ArticleEditorState
  author: PostAuthor
  children: ComponentChildren
}) => {
  const [pane, setPane] = useState<EditorPane>('write')
  const view: PreviewView = pane === 'write' ? 'aurboda' : pane
  const showPreview = wide || pane !== 'write'
  return (
    <div class={wide ? 'article-editor-panes article-editor-panes--wide' : 'article-editor-panes'}>
      {!wide && <PaneSwitch panes={['write', 'aurboda', 'mastodon']} value={pane} onChange={setPane} />}
      <div class="article-editor-form" hidden={!wide && pane !== 'write'}>
        {children}
      </div>
      {showPreview && (
        <div class="article-editor-preview">
          {wide && <PaneSwitch panes={['aurboda', 'mastodon']} value={view} onChange={setPane} />}
          <ArticlePreview state={state} view={view} author={author} />
        </div>
      )}
    </div>
  )
}
