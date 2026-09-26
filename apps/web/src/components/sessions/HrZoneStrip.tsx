import type { HrZoneSecs } from '@aurboda/api-spec'

import { formatZoneTime, hrZoneColors } from '../../utils/hrZones'
import { zoneTotal } from './sessionView'

const ZONES = [0, 1, 2, 3, 4, 5] as const

/** Share of time per HR zone as one thin stacked bar. */
export const HrZoneStrip = ({ zones }: { zones?: HrZoneSecs }) => {
  const total = zones ? zoneTotal(zones) : 0
  if (!zones || total <= 0) return <span class="session-muted">–</span>
  const title = ZONES.filter((z) => zones[z] > 0)
    .map((z) => `Z${z}: ${formatZoneTime(zones[z])}`)
    .join(', ')

  return (
    <span class="hr-zone-strip" title={title} role="img" aria-label={title}>
      {ZONES.map((z) =>
        zones[z] > 0 ? (
          <span key={z} style={{ background: hrZoneColors[z], width: `${(zones[z] / total) * 100}%` }} />
        ) : null,
      )}
    </span>
  )
}
