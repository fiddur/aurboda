import {
  type Challenge,
  type ChallengeParticipation,
  type ChallengeTimeStatus,
  challengeTimeStatus,
  type DiscoveredChallenge,
} from '@aurboda/api-spec'

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
  groups.ongoing.sort((a, b) => endMs(a) - endMs(b))
  groups.upcoming.sort((a, b) => startMs(a) - startMs(b))
  groups.ended.sort((a, b) => endMs(b) - endMs(a))
  return groups
}

/** Who hosts a discovered challenge, as people know them: handle, else display name, else identity URL. */
export const discoveredHostLabel = (c: DiscoveredChallenge): string =>
  c.host_handle ?? c.host_display_name ?? c.host_identity
