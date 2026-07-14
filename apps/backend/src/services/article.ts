/**
 * Article business logic shared by the REST `/feed/articles` routes and the MCP
 * `create_article` / `update_article` tools (parity).
 *
 * An article's chart blocks each render over a locked `[start, end]` window. A
 * block may carry its own window or inherit the article-level default; this
 * module resolves that inheritance and validates that every chart block ends up
 * with a sane bounded window, so a malformed article is rejected at the write
 * boundary rather than failing later at render time. Pure and synchronous —
 * unit-testable without a DB.
 */
import type { ArticleContent, UpdateArticleBody } from '@aurboda/api-spec'

export type BuildArticleResult = { ok: true; article: ArticleContent } | { ok: false; error: string }

/** A chart block's effective window: its own override, else the article default. */
export const chartBlockWindow = (
  block: { start?: string; end?: string },
  content: { default_start?: string; default_end?: string },
): { start?: string; end?: string } => ({
  end: block.end ?? content.default_end,
  start: block.start ?? content.default_start,
})

/**
 * Validate a fully-formed article's content: every chart block must resolve to a
 * bounded window (its own override or the article default) with start < end.
 * Returns the content to persist, or an error message for a 400.
 */
export const buildArticleContent = (content: ArticleContent): BuildArticleResult => {
  for (const [i, block] of content.blocks.entries()) {
    if (block.type !== 'chart') continue
    const { end, start } = chartBlockWindow(block, content)
    if (start == null || end == null) {
      return {
        error: `Chart block ${i + 1} (${block.metric}) has no time window — set its start/end or an article default_start/default_end.`,
        ok: false,
      }
    }
    if (new Date(start).getTime() >= new Date(end).getTime()) {
      return { error: `Chart block ${i + 1} (${block.metric}) has start on or after end.`, ok: false }
    }
  }
  return { article: content, ok: true }
}

/**
 * Apply an update patch onto the stored article, replacing only the provided
 * fields (title / blocks / default window); an omitted field keeps its stored
 * value. `visibility` is a separate post column, handled by the caller. The
 * merged content still goes through `buildArticleContent` for validation.
 */
export const mergeArticleContent = (existing: ArticleContent, patch: UpdateArticleBody): ArticleContent => {
  const merged: ArticleContent = {
    blocks: patch.blocks ?? existing.blocks,
    title: patch.title ?? existing.title,
  }
  const defaultStart = patch.default_start ?? existing.default_start
  const defaultEnd = patch.default_end ?? existing.default_end
  if (defaultStart !== undefined) merged.default_start = defaultStart
  if (defaultEnd !== undefined) merged.default_end = defaultEnd
  return merged
}
