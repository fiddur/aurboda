import { type ActivitySession, activityMeasureLabels } from '@aurboda/api-spec'
import { format } from 'date-fns'
import { useState } from 'preact/hooks'

import { formatMeasure, formatSet, formatSets, topSet } from '../../utils/measures'
import '../../components/sessions/sessions.css'

const PAGE = 25

/** Every session with one item value (an exercise): its sets, top set, e1RM, volume and the records it set. */
export const ItemSessionsTable = ({ sessions }: { sessions: ActivitySession[] }) => {
  const [shown, setShown] = useState(PAGE)
  const sorted = sessions.toSorted((a, b) => b.start_time.localeCompare(a.start_time))

  return (
    <div class="sessions-table-wrap">
      <table class="sessions-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Sets</th>
            <th scope="col" class="session-opt">
              Top set
            </th>
            <th scope="col" class="session-num" title="Estimated one-rep max (Epley)">
              e1RM
            </th>
            <th scope="col" class="session-num session-opt">
              Volume
            </th>
            <th scope="col" aria-label="Records" title="Records set in this session" />
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, shown).map((s) => {
            const items = s.items ?? []
            const top = topSet(items)
            const { e1rm, volume } = s.measures ?? {}
            return (
              <tr key={s.id}>
                <td class="session-date">
                  <a href={`/detail/activity/${s.id}`}>{format(new Date(s.start_time), 'yyyy-MM-dd')}</a>
                </td>
                <td class="activity-type-item-sets">{formatSets(items)}</td>
                <td class="session-opt">{top ? formatSet(top) : <span class="session-muted">–</span>}</td>
                <td class="session-num">{e1rm === undefined ? '–' : formatMeasure('e1rm', e1rm)}</td>
                <td class="session-num session-opt">
                  {volume === undefined ? '–' : formatMeasure('volume', volume)}
                </td>
                <td class="activity-type-item-badges">
                  {s.records?.map((m) => (
                    <span key={m} class="activity-type-item-pr" title={activityMeasureLabels[m]}>
                      PR
                    </span>
                  ))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {sorted.length > shown && (
        <button type="button" class="session-more" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({sorted.length - shown} left)
        </button>
      )}
    </div>
  )
}
