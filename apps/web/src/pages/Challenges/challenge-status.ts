/**
 * Time-status helpers for the challenge list. A challenge window is
 * `[start_ts, end_ts)` (end exclusive), so its last included moment is just
 * before `end_ts` and the "last day" is the calendar day of `end_ts - 1ms`,
 * rendered in the viewer's local timezone.
 */

import type { Challenge, ChallengeParticipation } from '@aurboda/api-spec'

export type ChallengeTimeStatus = 'ended' | 'ongoing' | 'upcoming'

export const challengeTimeStatus = (startTs: string, endTs: string, now: Date): ChallengeTimeStatus => {
  const t = now.getTime()
  if (t < new Date(startTs).getTime()) return 'upcoming'
  if (t < new Date(endTs).getTime()) return 'ongoing'
  return 'ended'
}

/** The last calendar moment included in the window (end_ts is exclusive). */
export const lastIncludedMoment = (endTs: string): Date => new Date(new Date(endTs).getTime() - 1)

/** Local midnight of a date — anchors calendar-day arithmetic, DST-safe via rounding. */
const localMidnight = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** Whole calendar days from `now`'s local day to `target`'s local day (0 = same day). */
export const calendarDaysUntil = (target: Date, now: Date): number =>
  Math.round((localMidnight(target).getTime() - localMidnight(now).getTime()) / 86_400_000)

/**
 * Format in the challenge's IANA timezone so absolute dates read exactly as the
 * host chose them (matching `formatDateInZone` on the challenge page), falling
 * back to the viewer's timezone: the backend only validates `timezone` as a
 * non-empty string, so a crafted value would otherwise throw `RangeError`.
 */
const formatInZone = (
  d: Date,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions,
  locale?: string,
): string => {
  try {
    return d.toLocaleDateString(locale, { ...opts, timeZone })
  } catch {
    return d.toLocaleDateString(locale, opts)
  }
}

const formatDay = (d: Date, timeZone: string, locale?: string): string =>
  formatInZone(d, timeZone, { day: 'numeric', month: 'short', year: 'numeric' }, locale)

/** "3 Jun – 9 Jun 2026" (last included day, not the exclusive end instant), in the challenge's timezone. */
export const challengeRangeLabel = (
  startTs: string,
  endTs: string,
  timeZone: string,
  locale?: string,
): string =>
  `${formatInZone(new Date(startTs), timeZone, { day: 'numeric', month: 'short' }, locale)} – ${formatDay(
    lastIncludedMoment(endTs),
    timeZone,
    locale,
  )}`

const inDays = (days: number): string => (days === 1 ? 'tomorrow' : `in ${days} days`)

/**
 * Relative phrase for the row: "Ends today", "Starts tomorrow", "Ended 9 Jun 2026".
 * Relative day counts are viewer-local (that's what "tomorrow" means to the
 * reader); the absolute "Ended" date is in the challenge's timezone.
 */
export const challengeTimePhrase = (
  startTs: string,
  endTs: string,
  timeZone: string,
  now: Date,
  locale?: string,
): string => {
  const status = challengeTimeStatus(startTs, endTs, now)
  if (status === 'upcoming') {
    const days = calendarDaysUntil(new Date(startTs), now)
    return days === 0 ? 'Starts today' : `Starts ${inDays(days)}`
  }
  const lastDay = lastIncludedMoment(endTs)
  if (status === 'ongoing') {
    const days = calendarDaysUntil(lastDay, now)
    return days <= 0 ? 'Ends today' : `Ends ${inDays(days)}`
  }
  return `Ended ${formatDay(lastDay, timeZone, locale)}`
}

export type ChallengeItem =
  | { kind: 'hosted'; challenge: Challenge }
  | { kind: 'joined'; participation: ChallengeParticipation }

const itemWindow = (item: ChallengeItem): { end_ts: string; start_ts: string } =>
  item.kind === 'hosted' ? item.challenge : item.participation

export const challengeItemKey = (item: ChallengeItem): string =>
  item.kind === 'hosted' ? `hosted-${item.challenge.id}` : `joined-${item.participation.id}`

/** Group hosted + joined challenges by time status, soonest-relevant first. */
export const groupChallengeItems = (
  hosted: Challenge[],
  joined: ChallengeParticipation[],
  now: Date,
): Record<ChallengeTimeStatus, ChallengeItem[]> => {
  const groups: Record<ChallengeTimeStatus, ChallengeItem[]> = { ended: [], ongoing: [], upcoming: [] }
  const items: ChallengeItem[] = [
    ...hosted.map((challenge) => ({ challenge, kind: 'hosted' as const })),
    ...joined.map((participation) => ({ kind: 'joined' as const, participation })),
  ]
  for (const item of items) {
    const { end_ts, start_ts } = itemWindow(item)
    groups[challengeTimeStatus(start_ts, end_ts, now)].push(item)
  }
  const endMs = (i: ChallengeItem) => new Date(itemWindow(i).end_ts).getTime()
  const startMs = (i: ChallengeItem) => new Date(itemWindow(i).start_ts).getTime()
  groups.ongoing.sort((a, b) => endMs(a) - endMs(b)) // ending soonest first
  groups.upcoming.sort((a, b) => startMs(a) - startMs(b)) // starting soonest first
  groups.ended.sort((a, b) => endMs(b) - endMs(a)) // most recently ended first
  return groups
}
