/**
 * Pure state → request-body logic for the article editor, kept out of the JSX so
 * it is unit-testable without rendering (mirrors `feed-metrics.ts`'s
 * `buildShareBody`).
 */
import type {
  ActivityImpactType,
  ArticleBlock,
  ArticleContent,
  ArticleDraftBlock,
  Challenge,
  ChallengeParticipation,
  ArticleDraftContent,
  CorrelationSelector,
  CreateArticleBody,
  FeedVisibility,
  HrvActivitiesData,
  PreviewArticleBody,
  UpdateArticleDraftBody,
} from '@aurboda/api-spec'

import { DEFAULT_IMPACT_WINDOW_MINUTES, isValidMetric } from '@aurboda/api-spec'

import { stillUploading } from './MarkdownEditor/image-upload'

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
/** A challenge block: a challenge picked from the user's own or joined ones, or a pasted URL. */
export interface ChallengeDraft {
  type: 'challenge'
  /** The challenge's public URL ('' = not chosen yet). */
  url: string
  caption: string
}
/** An impact block: HRV, heart rate and stress around the sessions of one exact activity. */
export interface ImpactDraft {
  type: 'impact'
  /** The grouping key ('' = not chosen yet). */
  activity: string
  activityType: ActivityImpactType
  windowMinutes: number
  /** `datetime-local` value ('' = inherit the article default window). */
  start: string
  end: string
  caption: string
}
export type BlockDraft = ChallengeDraft | ChartDraft | CorrelationDraft | ImpactDraft | ProseDraft

export const emptyImpactDraft = (): ImpactDraft => ({
  activity: '',
  activityType: 'activity_type',
  caption: '',
  end: '',
  start: '',
  type: 'impact',
  windowMinutes: DEFAULT_IMPACT_WINDOW_MINUTES,
})

export interface ImpactOption {
  /** Encodes both the type and the name, so one `<select>` value picks the pair. */
  value: string
  activity: string
  activityType: ActivityImpactType
}

export interface ImpactOptionGroup {
  label: string
  options: ImpactOption[]
}

const impactOption = (activityType: ActivityImpactType, activity: string): ImpactOption => ({
  activity,
  activityType,
  value: `${activityType}\u0000${activity}`,
})

/** A picked option's value back to its pair, or null for the empty pick. */
export const parseImpactOptionValue = (
  value: string,
): { activity: string; activityType: ActivityImpactType } | null => {
  const at = value.indexOf('\u0000')
  if (at < 0) return null
  return { activity: value.slice(at + 1), activityType: value.slice(0, at) as ActivityImpactType }
}

/**
 * What an impact block's activity picker offers, grouped as the Analyze context
 * table lists them; a stored pair the list lacks (another period, or a `tag` or
 * `productivity_app` set through the API) comes back as `extra`, so it stays
 * selectable.
 */
export const impactPickerOptions = (
  correlations:
    | {
        activities: Pick<HrvActivitiesData['correlations']['activities'][number], 'activity_type'>[]
        locations: Pick<HrvActivitiesData['correlations']['locations'][number], 'location_name'>[]
        productivity: Pick<HrvActivitiesData['correlations']['productivity'][number], 'category'>[]
      }
    | undefined,
  selected: { activity: string; activityType: ActivityImpactType },
): { groups: ImpactOptionGroup[]; extra: ImpactOption | null } => {
  const groups: ImpactOptionGroup[] = [
    {
      label: 'Activities',
      options: (correlations?.activities ?? []).map((a) => impactOption('activity_type', a.activity_type)),
    },
    {
      label: 'Locations',
      options: (correlations?.locations ?? []).map((l) => impactOption('location', l.location_name)),
    },
    {
      label: 'Screen time',
      options: (correlations?.productivity ?? []).map((p) =>
        impactOption('productivity_category', p.category),
      ),
    },
  ].filter((group) => group.options.length > 0)
  if (!selected.activity) return { extra: null, groups }
  const wanted = impactOption(selected.activityType, selected.activity)
  const listed = groups.some((group) => group.options.some((o) => o.value === wanted.value))
  return { extra: listed ? null : wanted, groups }
}

export const emptyChallengeDraft = (): ChallengeDraft => ({ caption: '', type: 'challenge', url: '' })

export interface ChallengeOption {
  url: string
  label: string
}

/**
 * What a challenge block's picker offers: the user's own challenges (by their
 * public `share_url`) and the ones they have joined and not left (by the
 * challenge's URL), each URL once.
 */
export const challengePickerOptions = (
  own: Pick<Challenge, 'name' | 'share_url'>[],
  joined: Pick<ChallengeParticipation, 'challenge_url' | 'name' | 'status'>[],
): { own: ChallengeOption[]; joined: ChallengeOption[] } => {
  const ownOptions = own.map((c) => ({ label: c.name, url: c.share_url }))
  const seen = new Set(ownOptions.map((o) => o.url))
  const joinedOptions = joined
    .filter((p) => p.status === 'active' && !seen.has(p.challenge_url))
    .map((p) => ({ label: p.name, url: p.challenge_url }))
  return { joined: joinedOptions, own: ownOptions }
}

export const emptyCorrelationDraft = (): CorrelationDraft => ({
  caption: '',
  end: '',
  lagDays: '',
  outcome: { kind: 'metric', metric: '' },
  start: '',
  trigger: { kind: 'activity', pattern: '' },
  type: 'correlation',
})

const selectorIncomplete = (s: CorrelationSelector): boolean =>
  s.kind === 'metric' ? !s.metric.trim() : s.kind === 'nutrition' ? false : !s.pattern.trim()

export interface ArticleEditorState {
  title: string
  defaultStart: string
  defaultEnd: string
  blocks: BlockDraft[]
  visibility: FeedVisibility
  /** Explicit tags; undefined leaves the post's automatic (or, when editing, stored) ones. */
  tags?: string[]
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

/** What the editor opens: a published article post, a saved draft, or nothing for a new one. */
export interface ArticleEditorSource {
  article?: ArticleDraftContent
  visibility: FeedVisibility
}

const impactDraftOf = (b: Extract<ArticleDraftBlock, { type: 'impact' }>): ImpactDraft => ({
  activity: b.activity ?? '',
  activityType: b.activity_type,
  caption: b.caption ?? '',
  end: toInputValue(b.end),
  start: toInputValue(b.start),
  type: 'impact',
  windowMinutes: b.window_minutes ?? DEFAULT_IMPACT_WINDOW_MINUTES,
})

export const draftsFromPost = (source?: { article?: ArticleDraftContent }): BlockDraft[] => {
  if (!source?.article) return []
  return source.article.blocks.map((b): BlockDraft => {
    if (b.type === 'prose') return { markdown: b.markdown, type: 'prose' }
    if (b.type === 'challenge') {
      return { caption: b.caption ?? '', type: 'challenge', url: b.challenge_url ?? '' }
    }
    if (b.type === 'impact') return impactDraftOf(b)
    if (b.type === 'correlation') {
      const empty = emptyCorrelationDraft()
      return {
        caption: b.caption ?? '',
        end: toInputValue(b.end),
        lagDays: b.lag_days != null ? String(b.lag_days) : '',
        outcome: b.outcome ?? empty.outcome,
        start: toInputValue(b.start),
        trigger: b.trigger ?? empty.trigger,
        type: 'correlation',
      }
    }
    return {
      bucket: b.bucket ?? '',
      caption: b.caption ?? '',
      end: toInputValue(b.end),
      metric: b.metric ?? '',
      start: toInputValue(b.start),
      type: 'chart',
    }
  })
}

export const initialArticleEditorState = (source?: ArticleEditorSource): ArticleEditorState => ({
  blocks: draftsFromPost(source),
  defaultEnd: toInputValue(source?.article?.default_end),
  defaultStart: toInputValue(source?.article?.default_start),
  title: source?.article?.title ?? '',
  visibility: source?.visibility ?? 'public',
  ...(source?.article?.tags ? { tags: source.article.tags } : {}),
})

const windowFields = (b: { start: string; end: string }) => ({
  ...(toIso(b.start) ? { start: toIso(b.start) } : {}),
  ...(toIso(b.end) ? { end: toIso(b.end) } : {}),
})

const impactBlockFields = (b: ImpactDraft) => ({
  activity_type: b.activityType,
  type: 'impact' as const,
  ...(b.activity ? { activity: b.activity } : {}),
  window_minutes: b.windowMinutes,
  ...windowFields(b),
  ...(b.caption.trim() ? { caption: b.caption.trim() } : {}),
})

const draftBlock = (b: BlockDraft): ArticleDraftBlock => {
  if (b.type === 'prose') return { markdown: b.markdown, type: 'prose' }
  if (b.type === 'challenge') {
    return {
      type: 'challenge',
      ...(b.url.trim() ? { challenge_url: b.url.trim() } : {}),
      ...(b.caption.trim() ? { caption: b.caption.trim() } : {}),
    }
  }
  if (b.type === 'impact') return impactBlockFields(b)
  if (b.type === 'chart') {
    return {
      type: 'chart',
      ...(isValidMetric(b.metric) ? { metric: b.metric } : {}),
      ...windowFields(b),
      ...(b.bucket ? { bucket: b.bucket } : {}),
      ...(b.caption.trim() ? { caption: b.caption.trim() } : {}),
    }
  }
  const lag = Number(b.lagDays)
  return {
    outcome: b.outcome,
    trigger: b.trigger,
    type: 'correlation',
    ...windowFields(b),
    ...(b.lagDays.trim() && Number.isInteger(lag) && lag !== 0 ? { lag_days: lag } : {}),
    ...(b.caption.trim() ? { caption: b.caption.trim() } : {}),
  }
}

/**
 * Editor state → draft content, with no completeness checks: a draft may lack a
 * title, a chart metric, a correlation selector or an impact activity. Publishing validates.
 */
export const buildDraftContent = (state: ArticleEditorState): ArticleDraftContent => ({
  blocks: state.blocks.map(draftBlock),
  title: state.title.trim(),
  ...(toIso(state.defaultStart) ? { default_start: toIso(state.defaultStart) } : {}),
  ...(toIso(state.defaultEnd) ? { default_end: toIso(state.defaultEnd) } : {}),
  ...(state.tags ? { tags: state.tags } : {}),
})

const hasBoundedWindow = (block: { start?: string; end?: string }, content: ArticleDraftContent): boolean => {
  const start = block.start ?? content.default_start
  const end = block.end ?? content.default_end
  return start !== undefined && end !== undefined && new Date(start).getTime() < new Date(end).getTime()
}

/** An http(s) `<base>/u/<username>/<slug>` link, as the server's challenge-URL parse requires. */
const isChallengeUrl = (url: string | undefined): boolean => {
  if (url === undefined || !URL.canParse(url)) return false
  const { protocol } = new URL(url)
  const at = url.indexOf('/u/')
  return (
    (protocol === 'http:' || protocol === 'https:') &&
    at > 0 &&
    url
      .slice(at + 3)
      .split('/')
      .filter(Boolean).length >= 2
  )
}

const isCompleteBlock = (block: ArticleDraftBlock, content: ArticleDraftContent): block is ArticleBlock => {
  switch (block.type) {
    case 'prose':
      return true
    case 'challenge':
      return isChallengeUrl(block.challenge_url)
    case 'chart':
      return block.metric !== undefined && hasBoundedWindow(block, content)
    case 'correlation':
      return (
        block.trigger !== undefined &&
        block.outcome !== undefined &&
        !selectorIncomplete(block.trigger) &&
        !selectorIncomplete(block.outcome) &&
        hasBoundedWindow(block, content)
      )
    case 'impact':
      return Boolean(block.activity) && hasBoundedWindow(block, content)
  }
}

/**
 * The editor state as the article a preview card shows: its complete blocks only (the server's
 * preview rule), windows as ISO, the title trimmed or `Untitled`.
 */
export const buildPreviewArticle = (state: ArticleEditorState): ArticleContent => {
  const content = buildDraftContent(state)
  return {
    blocks: content.blocks.filter((block) => isCompleteBlock(block, content)),
    title: content.title || 'Untitled',
    ...(content.default_start ? { default_start: content.default_start } : {}),
    ...(content.default_end ? { default_end: content.default_end } : {}),
  }
}

/** The body asking the server what the editor's article would federate as, with its figures drawn. */
export const previewRequest = (state: ArticleEditorState): PreviewArticleBody => ({
  article: buildDraftContent(state),
  include_images: true,
  visibility: state.visibility,
})

/**
 * The PATCH body that saves the editor's content over an existing draft. An
 * empty default window bound, or no explicit tags, is sent as `null`, so clearing
 * it in the editor clears it on the server (an omitted field would keep the stored value).
 */
export const draftUpdateBody = (state: ArticleEditorState): UpdateArticleDraftBody => {
  const content = buildDraftContent(state)
  return {
    ...content,
    default_end: content.default_end ?? null,
    default_start: content.default_start ?? null,
    tags: content.tags ?? null,
    visibility: state.visibility,
  }
}

/** A comparable fingerprint of what saving a draft would store, to tell whether there are unsaved changes. */
/** True while any prose block still holds a picture placeholder, so nothing saves it. */
export const blocksStillUploading = (blocks: readonly BlockDraft[]): boolean =>
  blocks.some((block) => block.type === 'prose' && stillUploading(block.markdown))

export const draftSnapshot = (state: ArticleEditorState): string =>
  JSON.stringify({ article: buildDraftContent(state), visibility: state.visibility })

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

const buildCorrelationBlock = (b: CorrelationDraft, i: number): BlockResult => {
  const missing = selectorIncomplete(b.trigger) ? 'trigger' : selectorIncomplete(b.outcome) ? 'outcome' : null
  if (missing) return { error: `Correlation block ${i + 1}: choose a ${missing} (metric or pattern).` }
  const lag = Number(b.lagDays)
  if (b.lagDays.trim() && !Number.isInteger(lag)) {
    return { error: `Correlation block ${i + 1}: lag days must be a whole number.` }
  }
  return {
    block: {
      outcome: b.outcome,
      trigger: b.trigger,
      type: 'correlation',
      ...(toIso(b.start) ? { start: toIso(b.start) } : {}),
      ...(toIso(b.end) ? { end: toIso(b.end) } : {}),
      ...(b.lagDays.trim() && lag !== 0 ? { lag_days: lag } : {}),
      ...(b.caption.trim() ? { caption: b.caption.trim() } : {}),
    },
  }
}

const buildChallengeBlock = (b: ChallengeDraft, i: number): BlockResult => {
  if (!b.url.trim()) return { error: `Pick a challenge or paste its link for challenge block ${i + 1}.` }
  return {
    block: {
      challenge_url: b.url.trim(),
      type: 'challenge',
      ...(b.caption.trim() ? { caption: b.caption.trim() } : {}),
    },
  }
}

const buildImpactBlock = (b: ImpactDraft, i: number): BlockResult => {
  if (!b.activity) return { error: `Pick an activity for impact block ${i + 1}.` }
  return { block: { ...impactBlockFields(b), activity: b.activity } }
}

const buildBlock = (b: Exclude<BlockDraft, ProseDraft>, i: number): BlockResult => {
  if (b.type === 'challenge') return buildChallengeBlock(b, i)
  if (b.type === 'impact') return buildImpactBlock(b, i)
  return b.type === 'correlation' ? buildCorrelationBlock(b, i) : buildChartBlock(b, i)
}

/**
 * The server re-validates windows and challenge links (`buildArticleContent`),
 * so this only guards what the form can catch early.
 */
export const buildArticleBody = (state: ArticleEditorState): BuildResult => {
  if (!state.title.trim()) return { error: 'Give your article a title.', ok: false }

  const blocks: ArticleBlock[] = []
  for (const [i, b] of state.blocks.entries()) {
    if (b.type === 'prose') {
      blocks.push({ markdown: b.markdown, type: 'prose' })
      continue
    }
    const built = buildBlock(b, i)
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
      ...(state.tags ? { tags: state.tags } : {}),
    },
    ok: true,
  }
}
