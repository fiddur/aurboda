/**
 * Member line colours, in leaderboard order. Mirrored by `challengeMemberColor` in
 * `apps/android/.../widget/ChallengeWidgetModel.kt` so a member has the same colour on
 * the phone as on the web page — change both together.
 */
export const MEMBER_COLORS = [
  '#2b9ea7',
  '#f59e0b',
  '#a855f7',
  '#e11d48',
  '#84cc16',
  '#f472b6',
  '#3b82f6',
  '#a16207',
] as const

const LIGHTEN_PERCENT = 35

const hex2 = (n: number): string => n.toString(16).padStart(2, '0')

/** Integer arithmetic so the Kotlin twin rounds identically. */
const towardWhite = (channel: number): number =>
  Math.floor((channel * (100 - LIGHTEN_PERCENT) + 255 * LIGHTEN_PERCENT + 50) / 100)

const lighten = (color: string): string =>
  `#${[1, 3, 5].map((i) => hex2(towardWhite(Number.parseInt(color.slice(i, i + 2), 16)))).join('')}`

/**
 * The palette, then the same hues lightened for the next round of members, then
 * around again, so a ninth member does not share the first one's colour.
 */
export const memberColor = (index: number): string => {
  const base = MEMBER_COLORS[index % MEMBER_COLORS.length]
  return Math.floor(index / MEMBER_COLORS.length) % 2 === 1 ? lighten(base) : base
}
