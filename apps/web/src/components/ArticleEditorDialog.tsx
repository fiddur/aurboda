import type { ArticleDraft, CorrelationSelectorsData, FeedPost, FeedVisibility } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useEffect, useRef, useState } from 'preact/hooks'

import type {
  ArticleEditorState,
  BlockDraft,
  ChallengeDraft,
  ChartDraft,
  CorrelationDraft,
  ProseDraft,
} from './article-editor-body'

import {
  createArticle,
  createArticleDraft,
  fetchCorrelationSelectors,
  fetchUserSettings,
  listChallenges,
  listMyChallengeParticipations,
  publishArticleDraft,
  updateArticle,
  updateArticleDraft,
} from '../state/api'
import {
  buildArticleBody,
  buildDraftContent,
  challengePickerOptions,
  deriveSubmitError,
  draftSnapshot,
  draftUpdateBody,
  emptyChallengeDraft,
  emptyCorrelationDraft,
  initialArticleEditorState,
} from './article-editor-body'
import { autoTagsFor, formatTagsInput, parseTagsInput } from './hashtags'
import { MarkdownEditor } from './MarkdownEditor'
import { MetricPicker } from './MetricPicker'
import { ALL_SELECTOR_KINDS, SelectorPicker } from './SelectorPicker'
import { TagsInput } from './TagsInput'
import { FEED_VISIBILITY_OPTIONS, VisibilitySelector } from './VisibilitySelector'
import './ShareActivityDialog.css'
import './ArticleEditorDialog.css'

type BlockPatch = Partial<ChallengeDraft> &
  Partial<ChartDraft> &
  Partial<CorrelationDraft> &
  Partial<ProseDraft>

/**
 * A draft block plus a stable identity, used only as the React `key`. Blocks are
 * reorderable and their children (MarkdownEditor) hold internal tab/focus state,
 * so a positional key would strand that state on the wrong block after a move —
 * hence a per-block id that travels with the block instead of the array index.
 */
type KeyedBlock = { key: string; block: BlockDraft }

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
        step="1"
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

const PASTE_URL = 'paste'

const ChallengeBlockFields = ({
  block,
  onPatch,
}: {
  block: ChallengeDraft
  onPatch: (patch: BlockPatch) => void
}) => {
  const own = useQuery({ queryFn: listChallenges, queryKey: ['challenges'], staleTime: 60_000 })
  const joined = useQuery({
    queryFn: listMyChallengeParticipations,
    queryKey: ['challengeParticipations'],
    staleTime: 60_000,
  })
  const options = challengePickerOptions(own.data ?? [], joined.data ?? [])
  const known = [...options.own, ...options.joined].some((o) => o.url === block.url)
  const [pasting, setPasting] = useState(false)
  const selected = pasting || (block.url !== '' && !known) ? PASTE_URL : block.url

  const onSelect = (value: string) => {
    if (value === PASTE_URL) {
      setPasting(true)
      return
    }
    setPasting(false)
    onPatch({ url: value })
  }

  return (
    <div class="article-chart-fields">
      <label class="article-field">
        <span class="article-field-label">Challenge</span>
        <select
          class="article-input"
          value={selected}
          onChange={(e) => onSelect((e.target as HTMLSelectElement).value)}
        >
          <option value="">Choose a challenge…</option>
          {options.own.length > 0 && (
            <optgroup label="Your challenges">
              {options.own.map((o) => (
                <option key={o.url} value={o.url}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {options.joined.length > 0 && (
            <optgroup label="Joined">
              {options.joined.map((o) => (
                <option key={o.url} value={o.url}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          <option value={PASTE_URL}>Paste a URL…</option>
        </select>
      </label>
      {selected === PASTE_URL && (
        <label class="article-field">
          <span class="article-field-label">Challenge URL</span>
          <input
            type="url"
            class="article-input"
            value={block.url}
            placeholder="https://…/u/username/challenge"
            onInput={(e) => onPatch({ url: (e.target as HTMLInputElement).value })}
          />
        </label>
      )}
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
}

const blockKindLabel = (block: BlockDraft): string => {
  switch (block.type) {
    case 'prose':
      return '¶ Prose'
    case 'correlation':
      return '🔗 Correlation'
    case 'challenge':
      return '🏁 Challenge'
    default:
      return '📈 Chart'
  }
}

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
      <span class="article-block-kind">{blockKindLabel(block)}</span>
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
    ) : block.type === 'challenge' ? (
      <ChallengeBlockFields block={block} onPatch={onPatch} />
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

type CloseState = 'open' | 'confirming'

const CloseConfirm = ({
  busy,
  saving,
  onSave,
  onDiscard,
  onKeepEditing,
}: {
  busy: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  onKeepEditing: () => void
}) => (
  <div class="article-close-confirm" role="alertdialog" aria-label="Unsaved changes">
    <span>Save as draft?</span>
    <div class="article-close-confirm-actions">
      <button type="button" class="btn-primary" disabled={busy} onClick={onSave}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" class="btn-danger" disabled={busy} onClick={onDiscard}>
        Discard
      </button>
      <button type="button" class="btn-secondary" onClick={onKeepEditing}>
        Keep editing
      </button>
    </div>
  </div>
)

const publishLabel = (editing: boolean, pending: boolean): string => {
  if (editing) return pending ? 'Saving…' : 'Save changes'
  return pending ? 'Publishing…' : 'Publish'
}

const EditorActions = ({
  editing,
  savedAt,
  busy,
  canPublish,
  savingDraft,
  publishing,
  onCancel,
  onSaveDraft,
  onPublish,
}: {
  editing: boolean
  /** When the draft was last saved, shown only while nothing has changed since. */
  savedAt: Date | undefined
  busy: boolean
  canPublish: boolean
  savingDraft: boolean
  publishing: boolean
  onCancel: () => void
  onSaveDraft: () => void
  onPublish: () => void
}) => (
  <div class="share-dialog-actions">
    {savedAt && <span class="article-saved-at">Saved {format(savedAt, 'HH:mm')}</span>}
    <button type="button" class="btn-secondary" onClick={onCancel}>
      Cancel
    </button>
    {!editing && (
      <button type="button" class="btn-secondary" disabled={busy} onClick={onSaveDraft}>
        {savingDraft ? 'Saving…' : 'Save draft'}
      </button>
    )}
    <button type="button" class="btn-primary" disabled={busy || !canPublish} onClick={onPublish}>
      {publishLabel(editing, publishing)}
    </button>
  </div>
)

/**
 * The editor's tags field. A draft's own tags, or tags once typed in, are
 * explicit and sent; otherwise the field shows what the post has (`stored`) or
 * would get from the settings, and nothing is sent.
 */
const useArticleTags = (draftTags: string[] | undefined, stored: string[] | undefined) => {
  const [text, setText] = useState(() => formatTagsInput(draftTags ?? stored ?? []))
  const [edited, setEdited] = useState(false)
  const automatic = draftTags === undefined && stored === undefined
  const { data: settings } = useQuery({
    enabled: automatic,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })
  const autoTags = automatic && settings ? autoTagsFor(settings, null) : undefined
  useEffect(() => {
    if (!edited && autoTags) setText(formatTagsInput(autoTags))
  }, [autoTags?.join(' ')])
  return {
    explicit: edited ? parseTagsInput(text) : draftTags,
    onInput: (value: string) => {
      setText(value)
      setEdited(true)
    },
    text,
  }
}

/**
 * The article composer. With a published `post` it edits that article (PATCH)
 * as before. Otherwise it works on a draft: `draft` reopens a saved one, and
 * nothing starts a new article that becomes a draft on its first save.
 */
export const ArticleEditorDialog = ({
  post,
  draft,
  onClose,
}: {
  post?: FeedPost
  draft?: ArticleDraft
  onClose: () => void
}) => {
  const queryClient = useQueryClient()
  const editing = post?.kind === 'article'
  const [initial] = useState(() => initialArticleEditorState(editing ? post : draft))
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
  const [draftId, setDraftId] = useState<string | undefined>(draft?.id)
  const [savedAt, setSavedAt] = useState<Date | undefined>(undefined)
  const [savedSnapshot, setSavedSnapshot] = useState(() => draftSnapshot(initial))
  const [closeState, setCloseState] = useState<CloseState>('open')
  const tags = useArticleTags(initial.tags, editing ? post?.tags : undefined)

  const editorState = (): ArticleEditorState => ({
    blocks: blocks.map((kb) => kb.block),
    defaultEnd,
    defaultStart,
    title,
    visibility,
    ...(tags.explicit ? { tags: tags.explicit } : {}),
  })
  const dirty = !editing && draftSnapshot(editorState()) !== savedSnapshot

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
  const addChallenge = () => setBlocks((bs) => [...bs, keyed(emptyChallengeDraft())])

  /** Create the draft on first save, PATCH it after; returns its id. */
  const persistDraft = async (): Promise<string> => {
    const state = editorState()
    const saved = draftId
      ? await updateArticleDraft(draftId, draftUpdateBody(state))
      : await createArticleDraft({ article: buildDraftContent(state), visibility: state.visibility })
    setDraftId(saved.id)
    setSavedAt(new Date(saved.updated_at))
    setSavedSnapshot(draftSnapshot(state))
    queryClient.invalidateQueries({ queryKey: ['articleDrafts'] })
    return saved.id
  }

  const saveDraft = useMutation({
    mutationFn: persistDraft,
    onSuccess: () => setValidationError(null),
  })

  const saveAndClose = useMutation({
    mutationFn: persistDraft,
    onSuccess: onClose,
  })

  const publish = useMutation({
    mutationFn: async () => {
      const result = buildArticleBody(editorState())
      if (!result.ok) {
        setValidationError(result.error)
        throw new Error('validation')
      }
      setValidationError(null)
      if (editing && post) return updateArticle(post.id, result.body)
      if (!draftId) return createArticle(result.body)
      const id = await persistDraft()
      return publishArticleDraft(id, result.body.visibility)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['articleDrafts'] })
      onClose()
    },
  })

  const requestClose = () => {
    if (dirty) setCloseState('confirming')
    else onClose()
  }
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose
  useEffect(() => {
    if (editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const busy = publish.isPending || saveDraft.isPending || saveAndClose.isPending
  const submitError =
    deriveSubmitError(validationError, publish.error) ??
    deriveSubmitError(null, saveDraft.error) ??
    deriveSubmitError(null, saveAndClose.error)

  return (
    <div class="share-dialog-backdrop" onClick={requestClose}>
      <div class="share-dialog article-editor" onClick={(e) => e.stopPropagation()}>
        <div class="share-dialog-header">
          <h2>{editing ? 'Edit article' : draftId ? 'Edit draft' : 'New article'}</h2>
          <button type="button" class="share-dialog-close" onClick={requestClose} aria-label="Close">
            ×
          </button>
        </div>

        <label class="article-field">
          <span class="article-field-label">Title</span>
          <input
            type="text"
            class="article-input"
            value={title}
            maxLength={200}
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
          <button type="button" class="btn-secondary" onClick={addChallenge}>
            + Challenge
          </button>
        </div>

        <TagsInput value={tags.text} onInput={tags.onInput} />

        <VisibilitySelector
          name="article-visibility"
          options={FEED_VISIBILITY_OPTIONS}
          value={visibility}
          onChange={setVisibility}
        />

        {submitError && <p class="share-dialog-error">{submitError}</p>}

        {closeState === 'confirming' ? (
          <CloseConfirm
            busy={busy}
            saving={saveAndClose.isPending}
            onSave={() => saveAndClose.mutate()}
            onDiscard={onClose}
            onKeepEditing={() => setCloseState('open')}
          />
        ) : (
          <EditorActions
            editing={editing}
            savedAt={dirty ? undefined : savedAt}
            busy={busy}
            canPublish={!!title.trim()}
            savingDraft={saveDraft.isPending}
            publishing={publish.isPending}
            onCancel={requestClose}
            onSaveDraft={() => saveDraft.mutate()}
            onPublish={() => publish.mutate()}
          />
        )}
      </div>
    </div>
  )
}
