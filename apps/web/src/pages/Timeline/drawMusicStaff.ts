import * as d3 from 'd3'
import { format } from 'date-fns'
import type { Scrobble } from '../../state/api'

// ── Constants ─────────────────────────────────────────────────────────────────

const TRACK_DURATION_MS = 3.5 * 60 * 1000 // ~3.5 minutes per scrobble

/** Total pixel height of the music staff track */
export const MUSIC_STAFF_HEIGHT = 34

/** Spacing between adjacent staff lines */
const STAFF_LINE_SPACING = 6

/** Padding above the top staff line */
const STAFF_TOP_PADDING = 4

/** Pixels between note centers (constant regardless of zoom) */
const NOTE_SPACING_PX = 20

/** Note head ellipse x-radius */
const NOTE_HEAD_RX = 3.2

/** Note head ellipse y-radius */
const NOTE_HEAD_RY = 2.4

/** Stem length in pixels */
const STEM_HEIGHT = 14

/** Pixels reserved for the treble clef at session start */
const CLEF_WIDTH = 18

/** Staff line color opacity */
const STAFF_LINE_OPACITY = 0.2

/** Note / stem opacity */
const NOTE_OPACITY = 0.45

// ── Melody data ───────────────────────────────────────────────────────────────
// Approximate opening of "I Let the Music Speak" (ABBA), mapped to staff
// positions relative to the middle (3rd) line.  0 = 3rd line (B4 in treble
// clef), +1 = one half-space up (C5 space), +2 = next line (D5), etc.
// Negative values go below the middle line.

export const MELODY: number[] = [
  0,
  2,
  4,
  3,
  2,
  1,
  0,
  -1, // "I let the mu-sic speak..."
  0,
  1,
  2,
  1,
  0,
  -1,
  -2,
  -1, // continuing phrase
  0,
  2,
  3,
  4,
  3,
  2,
  1,
  2, // second phrase ascending
  0,
  -1,
  -2,
  -1,
  0,
  1, // resolution
]

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MusicSession {
  start: Date
  end: Date
  scrobbles: Scrobble[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SvgParent = d3.Selection<any, unknown, null, undefined>

// ── Session merging ───────────────────────────────────────────────────────────

/**
 * Merge scrobbles into listening sessions.  Scrobbles within `mergeGapMs` of
 * each other (measured from one scrobble's end to the next's start) are grouped
 * into the same session.
 *
 * Expects scrobbles to be sorted ascending by `recorded_at`.
 */
export const mergeScrobblesIntoSessions = (scrobbles: Scrobble[], mergeGapMs: number): MusicSession[] => {
  if (scrobbles.length === 0) return []

  const sessions: MusicSession[] = []
  let sessionScrobbles: Scrobble[] = [scrobbles[0]!]
  let sessionStart = scrobbles[0]!.recorded_at
  let lastEnd = new Date(sessionStart.getTime() + TRACK_DURATION_MS)

  for (let i = 1; i < scrobbles.length; i++) {
    const s = scrobbles[i]!
    const gap = s.recorded_at.getTime() - lastEnd.getTime()

    if (gap <= mergeGapMs) {
      // Continue current session
      sessionScrobbles.push(s)
      lastEnd = new Date(s.recorded_at.getTime() + TRACK_DURATION_MS)
    } else {
      // Finalize previous session, start new one
      sessions.push({ end: lastEnd, scrobbles: sessionScrobbles, start: sessionStart })
      sessionScrobbles = [s]
      sessionStart = s.recorded_at
      lastEnd = new Date(s.recorded_at.getTime() + TRACK_DURATION_MS)
    }
  }

  // Finalize last session
  sessions.push({ end: lastEnd, scrobbles: sessionScrobbles, start: sessionStart })
  return sessions
}

// ── Merge gap selection ───────────────────────────────────────────────────────

/** Pick a merge gap based on the current zoom level (pixels per hour). */
export const getMergeGapMs = (pixelsPerHour: number): number => {
  if (pixelsPerHour > 100) return 10 * 60 * 1000 // 10 min — zoomed in
  if (pixelsPerHour > 20) return 30 * 60 * 1000 // 30 min — medium
  return 2 * 60 * 60 * 1000 // 2 hours — zoomed out
}

// ── Staff position → y-coordinate ─────────────────────────────────────────────

/**
 * Convert a melody position to a y-coordinate on the staff.
 * Position 0 = middle (3rd) staff line.
 * Each +1 moves half a line-spacing up (alternating line/space).
 */
export const staffPositionToY = (staffY: number, position: number): number => {
  const middleLineY = staffY + STAFF_TOP_PADDING + 2 * STAFF_LINE_SPACING
  return middleLineY - position * (STAFF_LINE_SPACING / 2)
}

// ── Drawing ───────────────────────────────────────────────────────────────────

const formatTime = (date: Date): string => format(date, 'HH:mm')

/** Draw ledger lines for notes that extend above or below the 5-line staff. */
const drawLedgerLines = (g: SvgParent, staffY: number, noteX: number, position: number): void => {
  if (position > 4) {
    // Notes above top line: draw ledger lines at even positions (6, 8, ...)
    for (let p = 5; p <= position; p++) {
      if (p % 2 !== 0) continue
      const ledgerY = staffPositionToY(staffY, p)
      g.append('line')
        .attr('x1', noteX - NOTE_HEAD_RX - 2)
        .attr('x2', noteX + NOTE_HEAD_RX + 2)
        .attr('y1', ledgerY)
        .attr('y2', ledgerY)
        .attr('class', 'music-staff-line')
        .attr('stroke', 'currentColor')
        .attr('stroke-opacity', STAFF_LINE_OPACITY)
        .attr('stroke-width', 0.75)
        .attr('pointer-events', 'none')
    }
  } else if (position < -4) {
    // Notes below bottom line: draw ledger lines at even positions (-6, -8, ...)
    for (let p = -5; p >= position; p--) {
      if (p % 2 !== 0) continue
      const ledgerY = staffPositionToY(staffY, p)
      g.append('line')
        .attr('x1', noteX - NOTE_HEAD_RX - 2)
        .attr('x2', noteX + NOTE_HEAD_RX + 2)
        .attr('y1', ledgerY)
        .attr('y2', ledgerY)
        .attr('class', 'music-staff-line')
        .attr('stroke', 'currentColor')
        .attr('stroke-opacity', STAFF_LINE_OPACITY)
        .attr('stroke-width', 0.75)
        .attr('pointer-events', 'none')
    }
  }
}

/** Draw simplified colored bars for music sessions (used when zoomed out). */
const drawSimplifiedMusicBars = (
  chartGroup: SvgParent,
  sessions: MusicSession[],
  currentXScale: d3.ScaleTime<number, number>,
  staffY: number,
  showTooltip: (event: MouseEvent, session: MusicSession) => void,
  hideTooltip: () => void,
): void => {
  const barHeight = MUSIC_STAFF_HEIGHT - 4
  const barY = staffY + 2

  for (const session of sessions) {
    const sx = currentXScale(session.start)
    const ex = currentXScale(session.end)
    const sw = Math.max(2, ex - sx)

    chartGroup
      .append('rect')
      .attr('x', sx)
      .attr('y', barY)
      .attr('width', sw)
      .attr('height', barHeight)
      .attr('fill', '#ec4899')
      .attr('opacity', 0.5)
      .attr('rx', 2)
      .attr('cursor', 'default')
      .on('mouseenter', (event: MouseEvent) => showTooltip(event, session))
      .on('mouseleave', hideTooltip)
  }
}

/** Draw all music sessions as sheet-music notation onto `chartGroup`. */
export const drawMusicSessions = (
  chartGroup: SvgParent,
  sessions: MusicSession[],
  currentXScale: d3.ScaleTime<number, number>,
  staffY: number,
  showTooltip: (event: MouseEvent, session: MusicSession) => void,
  hideTooltip: () => void,
  pixelsPerHour?: number,
): void => {
  // Simplified mode when zoomed out: colored bars instead of staff notation
  if (pixelsPerHour !== undefined && pixelsPerHour < 20) {
    drawSimplifiedMusicBars(chartGroup, sessions, currentXScale, staffY, showTooltip, hideTooltip)
    return
  }

  const topLineY = staffY + STAFF_TOP_PADDING
  const bottomLineY = topLineY + 4 * STAFF_LINE_SPACING

  for (const session of sessions) {
    const sx = currentXScale(session.start)
    const ex = currentXScale(session.end)
    const sw = ex - sx

    if (sw < 2) continue // too small to render

    const g = chartGroup.append('g').attr('class', 'music-session')

    // ── Invisible hover target ──
    g.append('rect')
      .attr('x', sx)
      .attr('y', staffY)
      .attr('width', sw)
      .attr('height', MUSIC_STAFF_HEIGHT)
      .attr('fill', 'transparent')
      .attr('cursor', 'default')
      .on('mouseenter', (event: MouseEvent) => showTooltip(event, session))
      .on('mouseleave', hideTooltip)

    // ── Staff lines (5 lines) ──
    for (let i = 0; i < 5; i++) {
      const ly = topLineY + i * STAFF_LINE_SPACING
      g.append('line')
        .attr('x1', sx)
        .attr('x2', ex)
        .attr('y1', ly)
        .attr('y2', ly)
        .attr('class', 'music-staff-line')
        .attr('stroke', 'currentColor')
        .attr('stroke-opacity', STAFF_LINE_OPACITY)
        .attr('stroke-width', 0.75)
        .attr('pointer-events', 'none')
    }

    // ── Left barline ──
    g.append('line')
      .attr('x1', sx)
      .attr('x2', sx)
      .attr('y1', topLineY)
      .attr('y2', bottomLineY)
      .attr('class', 'music-barline')
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', 1)
      .attr('pointer-events', 'none')

    // ── Treble clef (𝄞) ──
    g.append('text')
      .attr('x', sx + 3)
      .attr('y', staffY + MUSIC_STAFF_HEIGHT / 2 + 1)
      .attr('dy', '0.35em')
      .attr('font-size', '20px')
      .attr('class', 'music-clef')
      .attr('fill', 'currentColor')
      .attr('opacity', 0.35)
      .attr('pointer-events', 'none')
      .text('𝄞')

    // ── Right barline ──
    g.append('line')
      .attr('x1', ex)
      .attr('x2', ex)
      .attr('y1', topLineY)
      .attr('y2', bottomLineY)
      .attr('class', 'music-barline')
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', 1)
      .attr('pointer-events', 'none')

    // ── Notes ──
    const noteStartX = sx + CLEF_WIDTH
    const availableWidth = sw - CLEF_WIDTH - 4 // 4px padding before right barline
    if (availableWidth <= 0) continue

    const noteCount = Math.floor(availableWidth / NOTE_SPACING_PX)

    // Global offset: use absolute pixel position to keep melody continuous
    // across sessions and stable within a zoom frame.
    const globalOffset = Math.floor(sx / NOTE_SPACING_PX)

    for (let i = 0; i < noteCount; i++) {
      const noteX = noteStartX + i * NOTE_SPACING_PX + NOTE_SPACING_PX / 2
      const melodyIdx = (((globalOffset + i) % MELODY.length) + MELODY.length) % MELODY.length
      const position = MELODY[melodyIdx]!
      const noteY = staffPositionToY(staffY, position)

      // Note head (tilted ellipse)
      g.append('ellipse')
        .attr('cx', noteX)
        .attr('cy', noteY)
        .attr('rx', NOTE_HEAD_RX)
        .attr('ry', NOTE_HEAD_RY)
        .attr('transform', `rotate(-15, ${noteX}, ${noteY})`)
        .attr('class', 'music-note')
        .attr('fill', 'currentColor')
        .attr('opacity', NOTE_OPACITY)
        .attr('pointer-events', 'none')

      // Stem: notes at/above middle → stem goes down from right;
      //        notes below middle → stem goes up from left
      if (position >= 0) {
        // Stem down from right side of note head
        const stemX = noteX + NOTE_HEAD_RX * 0.8
        g.append('line')
          .attr('x1', stemX)
          .attr('x2', stemX)
          .attr('y1', noteY)
          .attr('y2', noteY + STEM_HEIGHT)
          .attr('class', 'music-stem')
          .attr('stroke', 'currentColor')
          .attr('stroke-opacity', NOTE_OPACITY)
          .attr('stroke-width', 0.8)
          .attr('pointer-events', 'none')
      } else {
        // Stem up from left side of note head
        const stemX = noteX - NOTE_HEAD_RX * 0.8
        g.append('line')
          .attr('x1', stemX)
          .attr('x2', stemX)
          .attr('y1', noteY)
          .attr('y2', noteY - STEM_HEIGHT)
          .attr('class', 'music-stem')
          .attr('stroke', 'currentColor')
          .attr('stroke-opacity', NOTE_OPACITY)
          .attr('stroke-width', 0.8)
          .attr('pointer-events', 'none')
      }

      // Ledger lines for notes above or below the staff
      drawLedgerLines(g, staffY, noteX, position)
    }
  }
}

// ── Tooltip builder ───────────────────────────────────────────────────────────

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Build tooltip HTML for a music session. */
export const buildMusicTooltipHtml = (session: MusicSession): string => {
  const startStr = formatTime(session.start)
  const endStr = formatTime(session.end)
  const count = session.scrobbles.length

  let html = `<div class="tooltip-title">♪ Music</div>`
  html += `<div class="tooltip-time">${escapeHtml(startStr)} – ${escapeHtml(endStr)}</div>`
  html += `<div class="tooltip-detail">${count} track${count !== 1 ? 's' : ''}</div>`
  html += `<div class="tooltip-tracks">`
  for (const s of session.scrobbles) {
    html += `<div>${escapeHtml(s.artist)} – ${escapeHtml(s.track)}</div>`
  }
  html += `</div>`
  return html
}
