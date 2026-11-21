import type { RecentActivitiesData, RecentActivity } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { DURATION_ACTIVITY_COLORS } from '../../pages/Timeline/activityMerge'
import { fetchRecentActivities } from '../../state/api'
import { browserTz } from '../../state/api/client'
import { isEmoji, isIconPath, isUrl } from '../../utils/emojiLookup'
import {
  emptyMessage,
  recentActivitiesQuery,
  type RecentActivitiesCardConfig,
  recentActivitiesTitle,
  rowFigures,
  rowLabel,
  rowWhen,
} from './recentActivities'
import './RecentActivitiesWidget.css'

const DEFAULT_BADGE_COLOR = '#f59e0b'

function Badge({ activity }: { activity: RecentActivity }) {
  const color = activity.color ?? DURATION_ACTIVITY_COLORS[activity.activity_type] ?? DEFAULT_BADGE_COLOR
  const { icon } = activity
  const glyph =
    icon && isEmoji(icon) ? (
      <span class="recent-activities-emoji">{icon}</span>
    ) : icon && (isUrl(icon) || isIconPath(icon)) ? (
      <img src={icon} alt="" width={18} height={18} />
    ) : (
      <span class="recent-activities-initial">{rowLabel(activity).charAt(0).toUpperCase()}</span>
    )
  return (
    <span class="recent-activities-badge" style={{ background: color }} aria-hidden="true">
      {glyph}
    </span>
  )
}

function Row({ activity, now, tz }: { activity: RecentActivity; now: Date; tz: string }) {
  const figures = rowFigures(activity)
  const content = (
    <>
      <Badge activity={activity} />
      <span class="recent-activities-text">
        <span class="recent-activities-label">{rowLabel(activity)}</span>
        {figures && <span class="recent-activities-figures">{figures}</span>}
      </span>
      <time class="recent-activities-when" dateTime={activity.start_time}>
        {rowWhen(activity, now, tz)}
      </time>
    </>
  )
  return (
    <li>
      {activity.id ? (
        <a class="recent-activities-row" href={`/detail/activity/${encodeURIComponent(activity.id)}`}>
          {content}
        </a>
      ) : (
        <div class="recent-activities-row">{content}</div>
      )}
    </li>
  )
}

interface RecentActivitiesViewProps {
  config: RecentActivitiesCardConfig
  data: RecentActivitiesData | null
  loading?: boolean
  /** A period dashboard: the card lists the latest activities inside the period. */
  period?: boolean
  note?: string
  /** The owner's rolling card offers to log an activity when it is empty. */
  canLog?: boolean
}

const Body = ({
  canLog,
  config,
  data,
  loading,
  period,
}: Required<Pick<RecentActivitiesViewProps, 'canLog' | 'loading' | 'period'>> &
  Pick<RecentActivitiesViewProps, 'config' | 'data'>) => {
  if (loading) return <div class="chart-loading">Loading...</div>
  if (!data) return <div class="no-data">No data</div>
  if (data.activities.length === 0) {
    return (
      <div class="recent-activities-empty">
        <span class="no-data">{emptyMessage(config, period)}</span>
        {canLog && (
          <a class="recent-activities-log" href="/add">
            Log an activity
          </a>
        )}
      </div>
    )
  }
  const now = new Date()
  return (
    <ul class="recent-activities-list">
      {data.activities.map((a, i) => (
        <Row key={a.id ?? `${a.start_time}-${i}`} activity={a} now={now} tz={data.tz} />
      ))}
    </ul>
  )
}

export function RecentActivitiesView({
  config,
  data,
  loading = false,
  period = false,
  note,
  canLog = false,
}: RecentActivitiesViewProps) {
  return (
    <div class="chart-widget recent-activities">
      <div class="chart-widget-header">
        <h4>{recentActivitiesTitle(config, period)}</h4>
      </div>
      {note && <p class="recent-activities-note">{note}</p>}
      <Body canLog={canLog} config={config} data={data} loading={loading} period={period} />
    </div>
  )
}

export function RecentActivitiesWidget({
  config,
  note,
}: {
  config: RecentActivitiesCardConfig
  note?: string
}) {
  const params = recentActivitiesQuery(config, browserTz)
  const query = useQuery({
    queryFn: () => fetchRecentActivities(params),
    queryKey: [
      'recent-activities',
      params.limit,
      params.window,
      params.types,
      params.exclude_types,
      params.lookback_days,
      params.manual_only,
      params.tz,
    ],
    staleTime: 60 * 1000,
  })

  return (
    <RecentActivitiesView
      config={config}
      data={query.data ?? null}
      loading={query.isLoading}
      note={note}
      canLog={(config.window ?? 'today') === 'today'}
    />
  )
}
