/**
 * Compact playlist card showing Last.fm scrobbles during an activity's time range.
 */
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fetchScrobbles } from '../../state/api'

interface MusicPlaylistProps {
  start: Date
  end: Date
}

export const MusicPlaylist = ({ start, end }: MusicPlaylistProps) => {
  const scrobblesQuery = useQuery({
    queryFn: () => fetchScrobbles(start, end),
    queryKey: ['detail-scrobbles', start.toISOString(), end.toISOString()],
    staleTime: 5 * 60 * 1000,
  })

  const scrobbles = scrobblesQuery.data ?? []

  if (scrobblesQuery.isLoading) return null
  if (scrobbles.length === 0) return null

  return (
    <div class="music-playlist">
      <h3>Music</h3>
      <div class="music-playlist-list">
        {scrobbles.map((s, i) => (
          <div class="music-playlist-item" key={i}>
            <span class="music-playlist-time">{format(s.recorded_at, 'HH:mm')}</span>
            <span class="music-playlist-track">
              <span class="music-playlist-artist">{s.artist}</span>
              {' – '}
              {s.track}
              {s.album && <span class="music-playlist-album"> ({s.album})</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
