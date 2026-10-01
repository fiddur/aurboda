import {
  type ChallengeSourceType,
  challengeRangeLabel,
  challengeTimePhrase,
  challengeTimeStatus,
  type ChallengeTimeStatus,
  getMetricDisplayName,
} from '@aurboda/api-spec'

import type { OgChallengeMember } from './og-image.ts'

import { type ChallengeTheme, challengeTheme } from './og-challenge-theme.ts'

/** A public challenge resolved far enough to describe it on a share card or in meta. */
export interface ResolvedChallenge {
  id: string
  name: string
  is_public: boolean
  spec: { source_type: ChallengeSourceType; pattern: string; unit: string }
  start_ts: string
  end_ts: string
  timezone: string
  /** ISO time the host last set the banner; null when there is none. */
  banner_updated_at: string | null
  /** Active members with their cached totals. */
  members: { display_name: string; cached_total: number | null }[]
}

export interface ChallengeDescription {
  measure: string
  unit: string
  range: string
  phrase: string
  status: ChallengeTimeStatus
  /** Best total first; members without a total yet go last. */
  members: OgChallengeMember[]
  theme: ChallengeTheme
}

const byTotalDesc = (a: OgChallengeMember, b: OgChallengeMember): number => {
  if (a.total === null) return b.total === null ? 0 : 1
  if (b.total === null) return -1
  return b.total - a.total
}

/** `trail_running` → `Trail running`; activity-type ids have no display name yet. */
const humanizeActivityType = (pattern: string): string => {
  const words = pattern.replaceAll(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const describeChallenge = (resolved: ResolvedChallenge, now: Date): ChallengeDescription => {
  const { end_ts, spec, start_ts, timezone } = resolved
  return {
    measure:
      spec.source_type === 'metric' ? getMetricDisplayName(spec.pattern) : humanizeActivityType(spec.pattern),
    members: resolved.members
      .map((m) => ({ name: m.display_name, total: m.cached_total }))
      .toSorted(byTotalDesc),
    phrase: challengeTimePhrase(start_ts, end_ts, timezone, now, 'en-GB'),
    range: challengeRangeLabel(start_ts, end_ts, timezone, 'en-GB'),
    status: challengeTimeStatus(start_ts, end_ts, now),
    theme: challengeTheme(spec),
    unit: spec.unit,
  }
}
