import { useQuery } from '@tanstack/react-query'

import type { ActivityTypeDefinition, MediaPlay } from '../../state/api'

import { fetchActivities, fetchActivityTypeDefinitions } from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { formatTime } from './format-utils'
import {
  activitiesDuringPlay,
  activitiesFetchWindow,
  buildMediaPlayFields,
  isWebUrl,
  mediaPlayHeading,
  OVERLAP_EXCLUDED_TYPES,
} from './mediaPlayFields'

const typeName = (type: string, definitions: ActivityTypeDefinition[] | undefined): string =>
  definitions?.find((d) => d.name === type)?.display_name ?? toDisplayName(type)

const ActivitiesDuringPlay = ({ play }: { play: MediaPlay }) => {
  const { start, end } = activitiesFetchWindow(play)
  const activitiesQuery = useQuery({
    queryFn: () => fetchActivities(start, end, undefined, OVERLAP_EXCLUDED_TYPES),
    queryKey: ['detail-media-activities', start.toISOString(), end.toISOString()],
    staleTime: 5 * 60 * 1000,
  })
  const { data: typeDefinitions } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activity-type-definitions'],
    staleTime: 30 * 60 * 1000,
  })

  const activities = activitiesDuringPlay(activitiesQuery.data ?? [], play)
  if (activities.length === 0) return null

  return (
    <div class="source-records">
      <h3>During this play</h3>
      {activities.map((activity) => {
        const sessionName = activity.data?.session_name
        return (
          <a
            key={activity.id}
            href={activity.id ? `/detail/activity/${encodeURIComponent(activity.id)}` : undefined}
            class="source-record"
          >
            <span class="source-record-source">
              {activity.title || typeName(activity.activity_type, typeDefinitions)}
            </span>
            <span class="source-record-time">
              {formatTime(activity.start_time)}
              {activity.end_time ? ` – ${formatTime(activity.end_time)}` : ''}
            </span>
            {typeof sessionName === 'string' && sessionName && (
              <span class="source-record-title">{sessionName}</span>
            )}
          </a>
        )
      })}
    </div>
  )
}

export const MediaPlayDetail = ({ play }: { play: MediaPlay }) => {
  const { title, subtitle } = mediaPlayHeading(play)

  return (
    <>
      <div class="entity-info">
        <div class="entity-meta">
          <span class="entity-type-badge">media</span>
        </div>

        <h2>{title}</h2>
        {subtitle && <p class="entity-subtitle">{subtitle}</p>}

        <div class="entity-fields">
          {buildMediaPlayFields(play).map((field) => (
            <div class="field-row" key={field.label}>
              <span class="field-label">{field.label}</span>
              <span class="field-value">{field.value}</span>
            </div>
          ))}
          {isWebUrl(play.url) && (
            <div class="field-row">
              <span class="field-label">URL</span>
              <span class="field-value media-play-url">
                <a href={play.url} target="_blank" rel="noopener noreferrer">
                  {play.url}
                </a>
              </span>
            </div>
          )}
        </div>
      </div>

      <ActivitiesDuringPlay play={play} />
    </>
  )
}
