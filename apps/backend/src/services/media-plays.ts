import type {
  Condition,
  MediaCondition,
  MediaKind,
  MediaPlay,
  MediaPlayInput,
  OutputMediaField,
} from '@aurboda/api-spec'

const LASTFM_DUPLICATE_WINDOW_MS = 5 * 60 * 1000
const POINT_PLAY_MS = 60 * 1000

export interface PlayRange {
  start: Date
  end: Date
}

export const playedRatio = (playedSecs: number | null, trackSecs: number | null): number | null =>
  playedSecs != null && trackSecs != null && trackSecs > 0 ? playedSecs / trackSecs : null

export const deriveMediaKind = (play: Pick<MediaPlay, 'source'>): MediaKind | null =>
  play.source === 'lastfm' ? 'music' : null

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null)

export const mprisRecordToPlay = (externalId: string, data: Record<string, unknown>): MediaPlay => {
  const played_secs = num(data.played_secs)
  const track_secs = num(data.track_secs)
  return {
    album: str(data.album),
    artist: str(data.artist),
    device: str(data.device),
    ended_at: typeof data.ended_at === 'string' ? data.ended_at : null,
    id: externalId,
    kind: deriveMediaKind({ source: 'mpris' }),
    max_position_secs: num(data.max_position_secs),
    played_ratio: playedRatio(played_secs, track_secs),
    played_secs,
    player: str(data.player),
    seek_count: num(data.seek_count),
    source: 'mpris',
    started_at: str(data.started_at),
    title: str(data.title),
    track_secs,
    url: str(data.url),
  }
}

export const scrobbleRecordToPlay = (
  externalId: string,
  recordedAt: Date,
  data: Record<string, unknown>,
): MediaPlay => ({
  album: str(data.album),
  artist: str(data.artist),
  device: '',
  ended_at: null,
  id: externalId,
  kind: deriveMediaKind({ source: 'lastfm' }),
  max_position_secs: null,
  played_ratio: null,
  played_secs: null,
  player: '',
  seek_count: null,
  source: 'lastfm',
  started_at: recordedAt.toISOString(),
  title: str(data.track),
  track_secs: null,
  url: '',
})

export const playInputToRecordData = (
  play: MediaPlayInput,
  deviceName: string | undefined,
): Record<string, unknown> => ({
  album: play.album,
  artist: play.artist,
  device: play.device,
  device_name: deviceName ?? '',
  ended_at: play.ended_at,
  max_position_secs: play.max_position_secs,
  played_secs: play.played_secs,
  player: play.player,
  seek_count: play.seek_count,
  started_at: play.started_at,
  title: play.title,
  track_secs: play.track_secs,
  url: play.url,
})

const norm = (s: string) => s.trim().toLowerCase()

const trackKey = (play: MediaPlay): string => JSON.stringify([norm(play.title), norm(play.artist)])

const byStartedAt = (a: MediaPlay, b: MediaPlay) =>
  Date.parse(a.started_at) - Date.parse(b.started_at) || a.id.localeCompare(b.id)

/** MPRIS plays win over Last.fm scrobbles of the same track within five minutes. */
export const dedupeAgainstLastfm = (mpris: MediaPlay[], lastfm: MediaPlay[]): MediaPlay[] => {
  const startsByTrack = new Map<string, number[]>()
  for (const m of mpris) {
    if (norm(m.artist) === '') continue
    const key = trackKey(m)
    const starts = startsByTrack.get(key) ?? []
    starts.push(Date.parse(m.started_at))
    startsByTrack.set(key, starts)
  }
  const kept = lastfm.filter((s) => {
    const scrobbledAt = Date.parse(s.started_at)
    const starts = startsByTrack.get(trackKey(s)) ?? []
    return !starts.some((start) => Math.abs(scrobbledAt - start) <= LASTFM_DUPLICATE_WINDOW_MS)
  })
  return [...mpris, ...kept].sort(byStartedAt)
}

export const playRange = (play: MediaPlay): PlayRange => {
  const start = new Date(play.started_at)
  const end = play.ended_at ? new Date(play.ended_at) : new Date(start.getTime() + POINT_PLAY_MS)
  return { end, start }
}

const hostMatches = (url: string, hosts: string[]): boolean => {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (!hostname) return false
  return hosts.some((h) => {
    const host = norm(h)
    return host !== '' && (hostname === host || hostname.endsWith(`.${host}`))
  })
}

const textMatches = (value: string, pattern: string, mode: 'exact' | 'contains'): boolean =>
  mode === 'exact' ? norm(value) === norm(pattern) : norm(value).includes(norm(pattern))

const mediaMatchers: Array<(play: MediaPlay, c: MediaCondition) => boolean> = [
  (play, c) => !c.url_host?.length || hostMatches(play.url, c.url_host),
  (play, c) => !c.title || textMatches(play.title, c.title, c.match_mode ?? 'contains'),
  (play, c) =>
    !c.artist?.length || c.artist.some((a) => textMatches(play.artist, a, c.match_mode ?? 'contains')),
  (play, c) => !c.player?.length || c.player.some((p) => norm(p) === norm(play.player)),
  (play, c) =>
    c.min_played_secs == null || (play.played_secs != null && play.played_secs >= c.min_played_secs),
  (play, c) =>
    c.min_played_ratio == null || play.played_ratio == null || play.played_ratio >= c.min_played_ratio,
]

export const matchesMediaCondition = (play: MediaPlay, condition: MediaCondition): boolean =>
  mediaMatchers.every((matches) => matches(play, condition))

export const mediaConditionsOf = (conditions: Condition[]): MediaCondition[] =>
  conditions.filter((c): c is MediaCondition => c.kind === 'media')

export const stripTitle = (title: string, stripPattern?: string): string => {
  const stripped = stripPattern ? title.replaceAll(new RegExp(stripPattern, 'giu'), '') : title
  return stripped.replaceAll(/\s+/gu, ' ').trim()
}

const overlapMs = (a: PlayRange, b: PlayRange): number =>
  Math.max(0, Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime()))

/**
 * Among plays overlapping any window, the one with the most played seconds (plays without
 * played_secs count their overlap with the windows); ties go to the earliest start.
 */
export const pickLongestPlay = (plays: MediaPlay[], windows: PlayRange[]): MediaPlay | null => {
  let best: { play: MediaPlay; score: number } | null = null
  for (const play of plays) {
    const range = playRange(play)
    const overlap = windows.reduce((sum, w) => sum + overlapMs(range, w), 0)
    if (overlap <= 0) continue
    const score = play.played_secs ?? overlap / 1000
    if (
      !best ||
      score > best.score ||
      (score === best.score && Date.parse(play.started_at) < Date.parse(best.play.started_at))
    ) {
      best = { play, score }
    }
  }
  return best?.play ?? null
}

export const validateOutputMediaField = (rule: {
  mode?: string
  conditions: Condition[]
  output_media_field?: OutputMediaField | null
}): string | null => {
  const field = rule.output_media_field
  if (!field) return null
  if (rule.mode !== 'enrich') return 'output_media_field requires mode "enrich"'
  if (mediaConditionsOf(rule.conditions).length === 0) {
    return 'output_media_field requires at least one "media" condition'
  }
  if (field.strip_pattern !== undefined) {
    try {
      new RegExp(field.strip_pattern, 'giu')
    } catch (error) {
      return `Invalid strip_pattern: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  return null
}

type MediaFieldRuleShape = Parameters<typeof validateOutputMediaField>[0]

/** Mode-specific checks the schema cannot express, for the REST API and MCP alike. */
export const validateRuleShape = (rule: MediaFieldRuleShape): string | null => {
  if (rule.mode === 'retype' && rule.conditions.filter((c) => c.kind === 'activity').length !== 1) {
    return 'mode "retype" requires exactly one "activity" condition, which selects the activities to retype'
  }
  return validateOutputMediaField(rule)
}

/** The parts of a rule validateOutputMediaField checks, as they will be after a partial update. */
export const mergeRuleUpdate = (
  existing: MediaFieldRuleShape,
  updates: Partial<MediaFieldRuleShape>,
): MediaFieldRuleShape => ({
  conditions: updates.conditions ?? existing.conditions,
  mode: updates.mode ?? existing.mode,
  output_media_field:
    updates.output_media_field === undefined ? existing.output_media_field : updates.output_media_field,
})
