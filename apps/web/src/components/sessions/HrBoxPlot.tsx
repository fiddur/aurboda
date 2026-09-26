import type { ValueDistribution } from '@aurboda/api-spec'

const WIDTH = 150
const HEIGHT = 18
const PAD = 3

/** Horizontal box-and-whisker of HR samples on a shared bpm axis, so rows compare at a glance. */
export const HrBoxPlot = ({
  dist,
  domain,
}: {
  dist?: ValueDistribution
  domain: [number, number] | null
}) => {
  if (!dist || !domain) return <span class="session-muted">–</span>
  const [lo, hi] = domain
  const x = (v: number) => PAD + ((v - lo) / (hi - lo || 1)) * (WIDTH - 2 * PAD)
  const mid = HEIGHT / 2
  const title = `HR ${Math.round(dist.min)} · ${Math.round(dist.q1)}–${Math.round(dist.q3)} (median ${Math.round(dist.median)}) · ${Math.round(dist.max)} bpm, ${dist.sample_count} samples`

  return (
    <svg
      class="hr-box-plot"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <line class="hr-box-whisker" x1={x(dist.min)} x2={x(dist.max)} y1={mid} y2={mid} />
      <line class="hr-box-whisker" x1={x(dist.min)} x2={x(dist.min)} y1={mid - 4} y2={mid + 4} />
      <line class="hr-box-whisker" x1={x(dist.max)} x2={x(dist.max)} y1={mid - 4} y2={mid + 4} />
      <rect
        class="hr-box-box"
        x={x(dist.q1)}
        y={mid - 6}
        width={Math.max(1, x(dist.q3) - x(dist.q1))}
        height={12}
        rx={2}
      />
      <line class="hr-box-median" x1={x(dist.median)} x2={x(dist.median)} y1={mid - 6} y2={mid + 6} />
    </svg>
  )
}

/** The shared axis's ends, for a column header. */
export const HrAxisLabel = ({ domain }: { domain: [number, number] | null }) => (
  <span class="hr-box-axis">{domain ? `HR ${domain[0]}–${domain[1]} bpm` : 'HR'}</span>
)
