import type { CorrelationSelectorsData, FeedPost, FeedVisibility } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'preact/hooks'

/**
 * Compose or edit a long-form **article** feed post: a title, an optional
 * article-level default time window, and an ordered list of prose / chart /
 * correlation blocks. Passing an existing `post` (kind `article`) switches to
 * edit mode (PATCH); otherwise it creates one (POST). Prose is written in the
 * shared MarkdownEditor; a chart block picks a metric and an optional window; a
 * correlation block picks a trigger + outcome selector — the same shapes Claude
 * drafts over MCP. Windowed blocks inherit the article default when left blank.
 */
import type { BlockDraft, ChartDraft, CorrelationDraft, ProseDraft } from './article-editor-body'

import { createArticle, fetchCorrelationSelectors, updateArticle } from '../state/api'
import {
  buildArticleBody,
  deriveSubmitError,
  emptyCorrelationDraft,
  initialArticleEditorState,
} from './article-editor-body'
import { MarkdownEditor } from './MarkdownEditor'
import { MetricPicker } from './MetricPicker'
import { ALL_SELECTOR_KINDS, SelectorPicker } from './SelectorPicker'
import { FEED_VISIBILITY_OPTIONS, VisibilitySelector } from './VisibilitySelector'
import './ShareActivityDialog.css'
import './ArticleEditorDialog.css'

type BlockPatch = Partial<ChartDraft> & Partial<CorrelationDraft> & Partial<ProseDraft>

/**
 * A draft block plus a stable identity, used only as the React `key`. Blocks are
 * reorderable and their children (MarkdownEditor) hold internal tab/focus state,
 * so a positional key would strand that state on the wrong block after a move —
 * hence a per-block id that travels with the block instead of the array index.
 */
type KeyedBlock = { key: string; block: BlockDraft }

/** The editable fields of a correlation block: trigger + outcome selectors, window, lag, caption. */
const CorrelationBlockFields = ({
  block,
  selectors,
  onPatch,
}: {
  block: CorrelationDraft
  selectors: CorrelationSelectorsData | undefined
  onPatch: (patch: BlockPatch) => void
}) => (
  <div class="article-chart-fields">
    <label class="article-field">
      <span class="article-field-label">Trigger (predictor)</span>
      <SelectorPicker
        value={block.trigger}
        onChange={(s) => onPatch({ trigger: s })}
        selectors={selectors}
        allowedKinds={ALL_SELECTOR_KINDS}
      />
    </label>
    <label class="article-field">
      <span class="article-field-label">Outcome</span>
      <SelectorPicker
        value={block.outcome}
        onChange={(s) => onPatch({ outcome: s })}
        selectors={selectors}
        allowedKinds={ALL_SELECTOR_KINDS}
      />
    </label>
    <div class="article-window">
      <label class="article-field">
        <span class="article-field-label">From (optional)</span>
        <input
          type="datetime-local"
          class="article-input"
          value={block.start}
          onInput={(e) => onPatch({ start: (e.target as HTMLInputElement).value })}
        />
      </label>
      <label class="article-field">
        <span class="article-field-label">To (optional)</span>
        <input
          type="datetime-local"
          class="article-input"
          value={block.end}
          onInput={(e) => onPatch({ end: (e.target as HTMLInputElement).value })}
        />
      </label>
    </div>
    <label class="article-field">
      <span class="article-field-label">Lag days (optional)</span>
      <input
        type="number"
        class="article-input"
        value={block.lagDays}
        placeholder="0 — days the outcome lags the trigger"
        onInput={(e) => onPatch({ lagDays: (e.target as HTMLInputElement).value })}
      />
    </label>
    <label class="article-field">
      <span class="article-field-label">Caption (optional)</span>
      <input
        type="text"
        class="article-input"
        value={block.caption}
        onInput={(e) => onPatch({ caption: (e.target as HTMLInputElement).value })}
      />
    </label>
  </div>
)

/**
 * One content block with its reorder / remove controls. Prose, chart, and
 * correlation blocks are all editable inline.
 */
const ArticleBlockEditor = ({
  block,
  index,
  total,
  selectors,
  onPatch,
  onMove,
  onRemove,
}: {
  block: BlockDraft
  index: number
  total: number
  selectors: CorrelationSelectorsData | undefined
  onPatch: (patch: BlockPatch) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) => (
  <div class="article-block">
    <div class="article-block-head">
      <span class="article-block-kind">
        {block.type === 'prose' ? '¶ Prose' : block.type === 'correlation' ? '🔗 Correlation' : '📈 Chart'}
      </span>
      <div class="article-block-controls">
        <button
          type="button"
          class="btn-icon"
          aria-label="Move up"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          class="btn-icon"
          aria-label="Move down"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        >
          ↓
        </button>
        <button type="button" class="btn-icon" aria-label="Remove block" onClick={onRemove}>
          ✕
        </button>
      </div>
    </div>

    {block.type === 'prose' ? (
      <MarkdownEditor
        value={block.markdown}
        onChange={(v) => onPatch({ markdown: v })}
        placeholder="Write your analysis (markdown supported)…"
      />
    ) : block.type === 'correlation' ? (
      <CorrelationBlockFields block={block} selectors={selectors} onPatch={onPatch} />
    ) : (
      <div class="article-chart-fields">
        <label class="article-field">
          <span class="article-field-label">Metric</span>
          <MetricPicker builtinOnly value={block.metric} onChange={(m) => onPatch({ metric: m })} />
        </label>
        <div class="article-window">
          <label class="article-field">
            <span class="article-field-label">From (optional)</span>
            <input
              type="datetime-local"
              class="article-input"
              value={block.start}
              onInput={(e) => onPatch({ start: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="article-field">
            <span class="article-field-label">To (optional)</span>
            <input
              type="datetime-local"
              class="article-input"
              value={block.end}
              onInput={(e) => onPatch({ end: (e.target as HTMLInputElement).value })}
            />
          </label>
        </div>
        <label class="article-field">
          <span class="article-field-label">Caption (optional)</span>
          <input
            type="text"
            class="article-input"
            value={block.caption}
            onInput={(e) => onPatch({ caption: (e.target as HTMLInputElement).value })}
          />
        </label>
      </div>
    )}
  </div>
)

export const ArticleEditorDialog = ({ post, onClose }: { post?: FeedPost; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const editing = post?.kind === 'article'
  const [initial] = useState(() => initialArticleEditorState(post))
  const { data: selectors } = useQuery({
    queryFn: fetchCorrelationSelectors,
    queryKey: ['correlationSelectors'],
    staleTime: 5 * 60 * 1000,
  })

  const [title, setTitle] = useState(initial.title)
  const [defaultStart, setDefaultStart] = useState(initial.defaultStart)
  const [defaultEnd, setDefaultEnd] = useState(initial.defaultEnd)
  const nextKey = useRef(0)
  const keyed = (block: BlockDraft): KeyedBlock => ({ block, key: String(nextKey.current++) })
  const [blocks, setBlocks] = useState<KeyedBlock[]>(() => initial.blocks.map(keyed))
  const [visibility, setVisibility] = useState<FeedVisibility>(initial.visibility)
  const [validationError, setValidationError] = useState<string | null>(null)

  const patchBlock = (i: number, patch: BlockPatch) =>
    setBlocks((bs) =>
      bs.map((kb, j) => (j === i ? { ...kb, block: { ...kb.block, ...patch } as BlockDraft } : kb)),
    )
  const removeBlock = (i: number) => setBlocks((bs) => bs.filter((_, j) => j !== i))
  const moveBlock = (i: number, dir: -1 | 1) =>
    setBlocks((bs) => {
      const j = i + dir
      if (j < 0 || j >= bs.length) return bs
      const next = [...bs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const addProse = () => setBlocks((bs) => [...bs, keyed({ markdown: '', type: 'prose' })])
  const addChart = () =>
    setBlocks((bs) => [
      ...bs,
      keyed({ bucket: '', caption: '', end: '', metric: '', start: '', type: 'chart' }),
    ])
  const addCorrelation = () => setBlocks((bs) => [...bs, keyed(emptyCorrelationDraft())])

  const mutation = useMutation({
    mutationFn: () => {
      const result = buildArticleBody({
        blocks: blocks.map((kb) => kb.block),
        defaultEnd,
        defaultStart,
        title,
        visibility,
      })
      if (!result.ok) {
        setValidationError(result.error)
        return Promise.reject(new Error('validation'))
      }
      setValidationError(null)
      return editing && post ? updateArticle(post.id, result.body) : createArticle(result.body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      onClose()
    },
  })

  const submitError = deriveSubmitError(validationError, mutation.error)

  return (
    <div class="share-dialog-backdrop" onClick={onClose}>
      <div class="share-dialog article-editor" onClick={(e) => e.stopPropagation()}>
        <div class="share-dialog-header">
          <h2>{editing ? 'Edit article' : 'New article'}</h2>
          <button type="button" class="share-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <label class="article-field">
          <span class="article-field-label">Title</span>
          <input
            type="text"
            class="article-input"
            value={title}
            placeholder="e.g. A week of sleep and HRV"
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
        </label>

        <fieldset class="share-dialog-group">
          <legend>Default chart window</legend>
          <p class="share-dialog-note">
            Chart blocks use this window unless they set their own. Leave blank if every chart sets its own.
          </p>
          <div class="article-window">
            <label class="article-field">
              <span class="article-field-label">From</span>
              <input
                type="datetime-local"
                class="article-input"
                value={defaultStart}
                onInput={(e) => setDefaultStart((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="article-field">
              <span class="article-field-label">To</span>
              <input
                type="datetime-local"
                class="article-input"
                value={defaultEnd}
                onInput={(e) => setDefaultEnd((e.target as HTMLInputElement).value)}
              />
            </label>
          </div>
        </fieldset>

        <div class="article-blocks">
          {blocks.map((kb, i) => (
            <ArticleBlockEditor
              key={kb.key}
              block={kb.block}
              index={i}
              total={blocks.length}
              selectors={selectors}
              onPatch={(patch) => patchBlock(i, patch)}
              onMove={(dir) => moveBlock(i, dir)}
              onRemove={() => removeBlock(i)}
            />
          ))}
        </div>

        <div class="article-add-block">
          <button type="button" class="btn-secondary" onClick={addProse}>
            + Prose
          </button>
          <button type="button" class="btn-secondary" onClick={addChart}>
            + Chart
          </button>
          <button type="button" class="btn-secondary" onClick={addCorrelation}>
            + Correlation
          </button>
        </div>

        <VisibilitySelector
          name="article-visibility"
          options={FEED_VISIBILITY_OPTIONS}
          value={visibility}
          onChange={setVisibility}
        />

        {submitError && <p class="share-dialog-error">{submitError}</p>}

        <div class="share-dialog-actions">
          <button type="button" class="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary"
            disabled={mutation.isPending || !title.trim()}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Publish article'}
          </button>
        </div>
      </div>
    </div>
  )
}
