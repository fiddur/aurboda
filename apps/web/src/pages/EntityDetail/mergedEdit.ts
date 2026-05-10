import type { SourceRecord } from '../../state/api'

/**
 * On a merged-view detail page, decide what an Edit click should do.
 *
 * Two cases:
 *  - One of the merged sources is already aurboda → it's the editable row;
 *    the parent should navigate to its detail URL so the user edits it
 *    directly. (We don't trigger an in-place edit on the merged page because
 *    saving from there would create *another* override, leaving stale state.)
 *  - No aurboda source → the parent enables in-place edit; on save the PATCH
 *    creates a new aurboda override targeting one of the synced sources.
 *
 * Returns `{ kind: 'navigate', url }` for the first case, `null` for the
 * second (parent falls through to its existing in-place edit logic). Pure;
 * exported for unit testing.
 */
export const mergedEditAction = (
  sourceRecords: SourceRecord[] | undefined,
): { kind: 'navigate'; url: string } | null => {
  const aurboda = sourceRecords?.find((r) => r.source === 'aurboda')
  if (!aurboda) return null
  return { kind: 'navigate', url: `/detail/activity/${aurboda.id}` }
}

/**
 * When saving a brand-new override from a merged-view detail page, force the
 * `start_time` / `end_time` in the PATCH body to the merged span. The default
 * body construction only includes fields the user explicitly changed, but we
 * always want the new override to span the whole merged group (otherwise it
 * would only span the targeted source's individual times — confusing because
 * the merged view the user was just looking at showed a wider range).
 *
 * Returns `null` when forcing isn't appropriate (not a merged view, or the
 * activity already has an aurboda override target — in which case it gets
 * updated in place and merged-span is irrelevant).
 *
 * `mergedStart` / `mergedEnd` are the values the merged-view rendered.
 */
export const forceMergedSpanForOverride = (
  isMergedActivity: boolean,
  hasAurbodaSource: boolean,
  mergedStart: Date | undefined,
  mergedEnd: Date | undefined,
): { start_time?: string; end_time?: string } | null => {
  if (!isMergedActivity || hasAurbodaSource) return null
  const out: { start_time?: string; end_time?: string } = {}
  if (mergedStart) out.start_time = mergedStart.toISOString()
  if (mergedEnd) out.end_time = mergedEnd.toISOString()
  return Object.keys(out).length > 0 ? out : null
}
