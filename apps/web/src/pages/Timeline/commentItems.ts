import type { Note } from '@aurboda/api-spec'

import type { ChartItem } from './types'

import { COMMENT_COLOR } from './colors'
import { formatTime } from './formatting'

/** The glyph the comments track is drawn with, in both orientations. */
export const COMMENT_ICON = '💬'

/** Longest label drawn next to a 💬 bubble before it is cut with an ellipsis. */
export const COMMENT_LABEL_MAX = 60

/**
 * Flatten one line of markdown to the plain text a one-line label should show.
 * Deliberately shallow — this is a label, not a renderer, so it only strips the
 * syntax that would otherwise leak as punctuation noise.
 */
export const stripMarkdown = (line: string): string =>
  line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/, '')
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/(\*\*|__|~~)/g, '')
    .replaceAll(/[*_`]/g, '')
    .trim()

/** The non-empty, markdown-stripped lines of a comment, in order. */
export const contentLines = (content: string): string[] =>
  content
    .split('\n')
    .map((line) => stripMarkdown(line))
    .filter((line) => line.length > 0)

/** First meaningful line of a comment, truncated to fit beside its bubble. */
export const commentLabel = (content: string, maxLength = COMMENT_LABEL_MAX): string => {
  const first = contentLines(content)[0] ?? ''
  return first.length > maxLength ? `${first.slice(0, maxLength - 1)}…` : first
}

/**
 * Thread roots → Timeline chart items. Every root with a `start_time` gets a
 * bubble, whether it hangs off an activity or off a bare moment; replies never
 * do — they ride along inside their root's tooltip count and panel.
 */
export const buildCommentItems = (notes: Note[]): ChartItem[] =>
  notes.flatMap((note) => {
    if (!note.start_time || !note.id) return []

    const start = new Date(note.start_time)
    if (Number.isNaN(start.getTime())) return []

    const end = note.end_time ? new Date(note.end_time) : start
    const label = commentLabel(note.content)
    const replyCount = note.replies?.length ?? 0
    const details = [
      ...(replyCount > 0 ? [`${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`] : []),
      ...contentLines(note.content).slice(0, 2),
    ]

    return [
      {
        color: COMMENT_COLOR,
        column: 'Comments',
        comment_id: note.id,
        end,
        icon: COMMENT_ICON,
        isPoint: !note.end_time,
        label,
        start,
        tooltip: { details, time: formatTime(start), title: label },
      } satisfies ChartItem,
    ]
  })

/**
 * Chains of glyphs closer than `minPx` to their neighbour, in x order: each chain is
 * drawn as one glyph, so no comment hides under another.
 */
export const groupOverlappingComments = <T extends { x: number }>(points: T[], minPx: number): T[][] => {
  const groups: T[][] = []
  for (const point of [...points].sort((a, b) => a.x - b.x)) {
    const current = groups.at(-1)
    if (current && point.x - current.at(-1)!.x < minPx) current.push(point)
    else groups.push([point])
  }
  return groups
}

/** One glyph standing for several thread roots: its tooltip lists each one's first line. */
export const buildCommentGroupItem = (items: ChartItem[]): ChartItem => {
  const first = items[0]!
  const title = `${items.length} comments`
  return {
    ...first,
    comment_ids: items.flatMap((item) => (item.comment_id ? [item.comment_id] : [])),
    label: title,
    tooltip: {
      details: items.map((item) => `${formatTime(item.start)} ${item.label}`),
      time: formatTime(first.start),
      title,
    },
  }
}
