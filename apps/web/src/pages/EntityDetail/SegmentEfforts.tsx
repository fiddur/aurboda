import type { ActivitySegmentEffort } from '@aurboda/api-spec'

import { segmentEffortRows } from './segmentEfforts'

export const SegmentEfforts = ({ efforts }: { efforts: ActivitySegmentEffort[] | undefined }) => {
  const rows = segmentEffortRows(efforts)
  if (rows.length === 0) return null
  return (
    <div class="segment-efforts">
      <h4>Segments</h4>
      <table class="activity-stats-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                <a href={`/segments/${r.segment_id}`}>{r.name}</a>
                {r.best && <span class="segment-best"> ★ best</span>}
              </th>
              <td>{r.time}</td>
              <td>{r.pace ?? ''}</td>
              <td>{r.avg_hr ?? ''}</td>
              <td>{r.approximate && <span class="segment-approximate">approximate</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
