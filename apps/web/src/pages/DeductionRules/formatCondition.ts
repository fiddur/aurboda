import type { DeductionRuleCondition } from '../../state/api'

const formatMedia = (c: DeductionRuleCondition): string => {
  const parts: string[] = []
  if (c.url_host?.length) parts.push(`host ${c.url_host.join(', ')}`)
  if (c.title) parts.push(`title "${c.title}"`)
  if (c.artist?.length) parts.push(`artist ${c.artist.join(', ')}`)
  if (c.player?.length) parts.push(`player ${c.player.join(', ')}`)
  if (c.min_played_secs != null) parts.push(`≥ ${c.min_played_secs} s`)
  if (c.min_played_ratio != null) parts.push(`≥ ${Math.round(c.min_played_ratio * 100)}%`)
  return `Media: ${parts.length ? parts.join(', ') : 'any'}`
}

export const formatCondition = (c: DeductionRuleCondition): string => {
  switch (c.kind) {
    case 'activity':
      return `Activity: ${c.activity_type}`
    case 'screentime_category':
      return `Screen: ${c.category?.join(' > ')}`
    case 'scrobble': {
      const parts: string[] = []
      if (c.artist?.length) parts.push(`artist: ${c.artist.join(', ')}`)
      if (c.track) parts.push(`track: ${c.track}`)
      return `Scrobble: ${parts.length ? parts.join(', ') : 'any'}`
    }
    case 'media':
      return formatMedia(c)
    default:
      return c.kind
  }
}

export const formatConditions = (conditions: DeductionRuleCondition[]): string =>
  conditions.map(formatCondition).join(' AND ')
