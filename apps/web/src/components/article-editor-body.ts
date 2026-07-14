/**
 * Pure state → request-body logic for the article editor, kept out of the JSX so
 * it is unit-testable without rendering (mirrors `feed-metrics.ts`'s
 * `buildShareBody`). Handles the `datetime-local` ⇄ ISO conversion, seeding the
 * editor from an existing post, and building/validating the create/update body.
 */
import type {
  ArticleBlock,
  CorrelationSelector,
  CreateArticleBody,
  FeedPost,
  FeedVisibility,
} from '@aurboda/api-spec'

import { isValidMetric } from '@aurboda/api-spec'

export interface ProseDraft {
  type: 'prose'
  markdown: string
}
export interface ChartDraft {
  type: 'chart'
  metric: string
  /** `datetime-local` value ('' = inherit the article default window). */
  start: string
  end: string
  bucket: string
  caption: string
}
/** A correlation block: a trigger×outcome scatter over the block's (or article's) window. */
export interface CorrelationDraft {
  type: 'correlation'
  trigger: CorrelationSelector
  outcome: CorrelationSelector
  /** `datetime-local` value ('' = inherit the article default window). */
  start: string
  end: string
  /** Number-input value ('' = no lag). */
  lagDays: string
  caption: string
}
export type BlockDraft = ChartDraft | CorrelationDraft | ProseDraft

/** A fresh correlation draft for the "+ Correlation" button (empty selectors). */
export const emptyCorrelationDraft = (): CorrelationDraft => ({
  caption: '',
  end: '',
  lagDays: '',
  outcome: { kind: 'metric', metric: '' },
  start: '',
  trigger: { kind: 'activity', pattern: '' },
  type: 'correlation',
})

/** A selector the author hasn't finished filling in (no metric / no pattern). */
const selectorIncomplete = (s: CorrelationSelector): boolean =>
  s.kind === 'metric' ? !s.metric.trim() : s.kind === 'nutrition' ? false : !s.pattern.trim()

export interface ArticleEditorState {
  title: string
  defaultStart: string
  defaultEnd: string
  blocks: BlockDraft[]
  visibility: FeedVisibility
}

export type BuildResult = { ok: true; body: CreateArticleBody } | { ok: false; error: string }

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO 8601 → a `datetime-local` input value (local time), or '' when absent. */
export const toInputValue = (iso?: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A `datetime-local` value → ISO 8601, or undefined when blank. */
export const toIso = (local: string): string | undefined =>
  local ? new Date(local).toISOString() : undefined

/** Seed the editor's block drafts from an existing article post (edit mode). */
export const draftsFromPost = (post?: FeedPost): BlockDraft[] => {
  if (!post?.article) return []
  return post.article.blocks.map((b): BlockDraft => {
    if (b.type === 'prose') return { markdown: b.markdown, type: 'prose' }
    if (b.type === 'correlation') {
      return {
        caption: b.caption ?? '',
        end: toInputValue(b.end),
        lagDays: b.lag_days != null ? String(b.lag_days) : '',
        outcome: b.outcome,
        start: toInputValue(b.start),
        trigger: b.trigger,
        type: 'correlation',
      }
    }
    return {
      bucket: b.bucket ?? '',
      caption: b.caption ?? '',
      end: toInputValue(b.end),
      metric: b.metric,
      start: toInputValue(b.start),
      type: 'chart',
    }
  })
}

/** Seed the whole editor state from an existing post (edit mode) or empty (compose). */
export const initialArticleEditorState = (post?: FeedPost): ArticleEditorState => ({
  blocks: draftsFromPost(post),
  defaultEnd: toInputValue(post?.article?.default_end),
  defaultStart: toInputValue(post?.article?.default_start),
  title: post?.article?.title ?? '',
  visibility: post?.visibility ?? 'public',
})

/**
 * The message to show under the editor: a form-validation error takes precedence,
 * then a real mutation failure (the internal `'validation'` rejection is not a
 * user-facing error — it just signals the form was invalid).
 */
export const deriveSubmitError = (validationError: string | null, mutationError: unknown): string | null => {
  if (validationError) return validationError
  if (mutationError instanceof Error && mutationError.message !== 'validation') return mutationError.message
  return null
}

type BlockResult = { block: ArticleBlock } | { error: string }

/** Build one chart block from its draft, or a validation error. */
const buildChartBlock = (b: ChartDraft, i: number): BlockResult => {
  if (!isValidMetric(b.metric)) {
    // An empty pick vs. an unsupported (custom) metric — article charts accept
    // only built-in metric types (the picker offers only those, but an article
    // edited elsewhere could still carry one).
    const error = b.metric
      ? `Chart block ${i + 1}: “${b.metric}” can't be charted in an article (custom metrics aren't supported yet).`
      : `Pick a metric for chart block ${i + 1}.`
    return { error }
  }
  return {
    block: {
      metric: b.metric,
      type: 'chart',
      ...(toIso(b.start) ? { start: toIso(b.start) } : {}),
      ...(toIso(b.end) ? { end: toIso(b.end) } : {}),
      ...(b.bucket ? { bucket: b.bucket } : {}),
      ...(b.caption.trim() ? { caption: b.caption.trim() } : {}),
    },
  }
}

/** Build one correlation block from its draft, or a validation error. */
const buildCorrelationBlock = (b: CorrelationDraft, i: number): BlockResult => {
  const missing = selectorIncomplete(b.trigger) ? 'trigger' : selectorIncomplete(b.outcome) ? 'outcome' : null
  if (missing) return { error: `Correlation block ${i + 1}: choose a ${missing} (metric or pattern).` }
  const lag = Number(b.lagDays)
  return {
    block: {
      outcome: b.outcome,
      trigger: b.trigger,
      type: 'correlation',
      ...(toIso(b.start) ? { start: toIso(b.start) } : {}),
      ...(toIso(b.end) ? { end: toIso(b.end) } : {}),
      ...(b.lagDays.trim() && Number.isFinite(lag) && lag !== 0 ? { lag_days: lag } : {}),
      ...(b.caption.trim() ? { caption: b.caption.trim() } : {}),
    },
  }
}

/**
 * Build the create/update request body from the editor state, or return a
 * validation error. Requires a title, a valid metric on every chart block, and a
 * filled-in trigger + outcome on every correlation block; empty optional fields
 * are omitted. The server re-validates windows (`buildArticleContent`), so this
 * only guards what the form can catch early.
 */
export const buildArticleBody = (state: ArticleEditorState): BuildResult => {
  if (!state.title.trim()) return { error: 'Give your article a title.', ok: false }

  const blocks: ArticleBlock[] = []
  for (const [i, b] of state.blocks.entries()) {
    if (b.type === 'prose') {
      blocks.push({ markdown: b.markdown, type: 'prose' })
      continue
    }
    const built = b.type === 'correlation' ? buildCorrelationBlock(b, i) : buildChartBlock(b, i)
    if ('error' in built) return { error: built.error, ok: false }
    blocks.push(built.block)
  }

  return {
    body: {
      blocks,
      title: state.title.trim(),
      visibility: state.visibility,
      ...(toIso(state.defaultStart) ? { default_start: toIso(state.defaultStart) } : {}),
      ...(toIso(state.defaultEnd) ? { default_end: toIso(state.defaultEnd) } : {}),
    },
    ok: true,
  }
}
