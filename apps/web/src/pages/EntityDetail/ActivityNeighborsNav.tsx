import type { ActivityNeighbor, DataFieldDefinition } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation } from 'preact-iso'
import { useEffect } from 'preact/hooks'

import { fieldLabel } from '../../components/sessions/sessionView'
import { fetchActivityNeighbors } from '../../state/api'
import '../../components/sessions/sessions.css'

const neighborLabel = (n: ActivityNeighbor) =>
  `${format(new Date(n.start_time), 'EEE d MMM yyyy')}${n.title ? ` · ${n.title}` : ''}`

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))

const NeighborsRow = ({
  activityId,
  scope,
  sameField,
  keyboard,
}: {
  activityId: string
  scope: string
  sameField?: string
  keyboard?: boolean
}) => {
  const { route } = useLocation()
  const { data } = useQuery({
    queryFn: () => fetchActivityNeighbors(activityId, sameField ? { same_field: sameField } : {}),
    queryKey: ['activity-neighbors', activityId, sameField ?? null],
    staleTime: 60_000,
  })
  const previous = data?.previous
  const next = data?.next

  useEffect(() => {
    if (!keyboard) return
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTyping(e.target)) return
      const target = e.key === 'ArrowLeft' ? previous : e.key === 'ArrowRight' ? next : undefined
      if (!target) return
      e.preventDefault()
      route(`/detail/activity/${target.id}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard, previous, next, route])

  if (!previous && !next) return null

  return (
    <div class="activity-neighbors-row">
      {previous ? (
        <a href={`/detail/activity/${previous.id}`} title={`Previous: ${neighborLabel(previous)}`}>
          ← {neighborLabel(previous)}
        </a>
      ) : (
        <span class="session-muted">No earlier</span>
      )}
      <span class="activity-neighbors-scope" title={scope}>
        {scope}
      </span>
      {next ? (
        <a href={`/detail/activity/${next.id}`} title={`Next: ${neighborLabel(next)}`}>
          {neighborLabel(next)} →
        </a>
      ) : (
        <span class="session-muted">No later</span>
      )}
    </div>
  )
}

/**
 * Previous/next activity of the same type (also on ←/→), and of the same value for each
 * categorical field this one has (e.g. the same session_name).
 */
export const ActivityNeighborsNav = ({
  activityId,
  typeLabel,
  values,
}: {
  activityId: string
  typeLabel: string
  values: { field: DataFieldDefinition; value: string }[]
}) => (
  <nav class="activity-neighbors-nav" aria-label="Previous and next activities">
    <NeighborsRow activityId={activityId} scope={typeLabel} keyboard />
    {values.map(({ field, value }) => (
      <NeighborsRow
        key={field.name}
        activityId={activityId}
        scope={`${fieldLabel(field)}: ${value}`}
        sameField={field.name}
      />
    ))}
  </nav>
)
