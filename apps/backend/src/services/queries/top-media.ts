import type { MediaPlay, MediaPlaySource, TopMedia, TopMediaBy, TopMediaItem } from '@aurboda/api-spec'

import { getMediaPlays } from '../../db/index.ts'

export interface TopMediaDeps {
  getMediaPlays: typeof getMediaPlays
}

const keyOf = (play: MediaPlay, by: TopMediaBy): string => {
  const artist = play.artist.trim()
  switch (by) {
    case 'artist':
      return artist
    case 'album': {
      const album = play.album.trim()
      return album ? (artist ? `${artist} — ${album}` : album) : ''
    }
    case 'track': {
      const title = play.title.trim()
      return title ? (artist ? `${artist} — ${title}` : title) : ''
    }
  }
}

/** Plays without the grouping key (no artist, album or title) count towards the total only. */
const rankPlays = (plays: MediaPlay[], by: TopMediaBy, limit: number): TopMedia => {
  const counts = new Map<string, number>()
  for (const play of plays) {
    const key = keyOf(play, by)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const items: TopMediaItem[] = [...counts]
    .map(([name, count]) => ({ name, plays: count }))
    .sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name))
    .slice(0, limit)
  return { distinct: counts.size, items, total_plays: plays.length }
}

export const getTopMedia = async (
  user: string,
  window: { start: Date; end: Date },
  by: TopMediaBy,
  limit: number,
  source?: MediaPlaySource,
  deps: TopMediaDeps = { getMediaPlays },
): Promise<TopMedia> => rankPlays(await deps.getMediaPlays(user, window, { source }), by, limit)
