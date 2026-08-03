/**
 * One inline correlation block of an article: a scatter of a `trigger` predictor
 * against an `outcome`, both resolved **live** over the block's locked
 * `[start, end]` window (no snapshot) via the owner-authenticated continuous
 * correlation endpoint. The caller (`ArticleContent`) resolves the effective
 * window (block override else the article default) and passes concrete ISO
 * strings. The scatter reuses the shared correlation maths (`linearRegression`,
 * `describeSelectorAxis`) — a purpose-built, compact in-card render rather than
 * the full Correlations-explorer visualisation.
 */
import type { ContinuousCorrelationData, CorrelationSelector } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchContinuousCorrelation } from '../../state/api'
import { describeSelectorAxis, linearRegression } from '../Correlations/exploreCharts'

const W = 520
const H = 300
const PAD = { bottom: 44, left: 52, right: 16, top: 16 }
const POINT_COLOR = '#673ab8'
const REG_COLOR = '#e0457b'

const fmt = (value: number | null | undefined, digits = 2): string =>
  value == null ? '—' : value.toFixed(digits)

const fmtP = (p: number | null | undefined): string => (p == null ? '—' : p < 0.001 ? '<0.001' : p.toFixed(3))

/**
 * The subset of a continuous-correlation result the scatter draws — the same
 * fields `ContinuousCorrelationData` and a resolved `FeedStructuredArticleCorrelationBlock`
 * both carry, so this component renders either a live fetch result or a
 * structured-enrichment payload without an adapter.
 */
export interface CorrelationScatterData {
  series: { date: string; trigger: number; outcome: number }[]
  pearson: number | null
  spearman: number | null
  pearson_p: number | null
  n: number
  group_comparison: ContinuousCorrelationData['group_comparison']
  trigger: CorrelationSelector
  outcome: CorrelationSelector
}

/** The scatter itself: points + OLS regression line + r/ρ/n/p annotation + axes. */
export const CorrelationScatterSvg = ({ data }: { data: CorrelationScatterData }) => {
  const xs = data.series.map((p) => p.trigger)
  const ys = data.series.map((p) => p.outcome)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const sx = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD.left - PAD.right)
  const sy = (y: number) => H - PAD.bottom - ((y - yMin) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom)
  const reg = linearRegression(xs, ys)

  // For a binary/presence trigger (0/1 — tags, activities, apps) a Pearson r is
  // misleading, so lead with the present-vs-absent group comparison instead, the
  // same call the Correlations explorer makes.
  const gc = data.group_comparison
  const headline = gc?.trigger_is_binary
    ? `Δ(present−absent)=${fmt(gc.difference)} · d=${fmt(gc.cohens_d)} · n=${data.n} · p=${fmtP(gc.welch?.p_value)}`
    : `r=${fmt(data.pearson)} · ρ=${fmt(data.spearman)} · n=${data.n} · p=${fmtP(data.pearson_p)}`
  const label = `Scatter of ${describeSelectorAxis(data.trigger)} versus ${describeSelectorAxis(data.outcome)}; ${headline}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="article-scatter" role="img" aria-label={label}>
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="#ccc" />
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} stroke="#ccc" />
      {data.series.map((p) => (
        <circle key={p.date} cx={sx(p.trigger)} cy={sy(p.outcome)} r={3} fill={POINT_COLOR} opacity={0.45} />
      ))}
      {reg && (
        <line
          x1={sx(xMin)}
          y1={sy(reg.slope * xMin + reg.intercept)}
          x2={sx(xMax)}
          y2={sy(reg.slope * xMax + reg.intercept)}
          stroke={REG_COLOR}
          stroke-width={2}
        />
      )}
      <text x={PAD.left + 6} y={PAD.top + 12} class="article-scatter-annot">
        {headline}
      </text>
      <text x={(PAD.left + (W - PAD.right)) / 2} y={H - 8} text-anchor="middle" class="article-scatter-axis">
        {describeSelectorAxis(data.trigger)}
      </text>
      <text
        x={14}
        y={(PAD.top + (H - PAD.bottom)) / 2}
        text-anchor="middle"
        class="article-scatter-axis"
        transform={`rotate(-90 14 ${(PAD.top + (H - PAD.bottom)) / 2})`}
      >
        {describeSelectorAxis(data.outcome)}
      </text>
    </svg>
  )
}

/**
 * ISO instant → inclusive `YYYY-MM-DD` regime bound for the correlation query.
 * Take the date straight off the ISO string (every ISO 8601 datetime starts with
 * `YYYY-MM-DD`) so the bound is the author's wall-clock day — not a UTC day that
 * could roll back for a window authored with a non-UTC offset near midnight.
 */
const toDay = (iso: string): string => iso.slice(0, 10)

export const ArticleCorrelationBlock = ({
  trigger,
  outcome,
  lagDays,
  start,
  end,
  caption,
}: {
  trigger: CorrelationSelector
  outcome: CorrelationSelector
  lagDays?: number
  start: string
  end: string
  caption?: string
}) => {
  const { data, isLoading, isError } = useQuery({
    queryFn: () =>
      fetchContinuousCorrelation({
        outcome,
        period_end: toDay(end),
        period_start: toDay(start),
        trigger,
        ...(lagDays ? { lag_days: lagDays } : {}),
      }),
    queryKey: ['article-correlation', JSON.stringify(trigger), JSON.stringify(outcome), lagDays, start, end],
  })

  return (
    <figure class="article-chart">
      {isLoading ? (
        <p class="article-chart-note">Loading correlation…</p>
      ) : isError ? (
        <p class="article-chart-note">Couldn't load this correlation.</p>
      ) : !data || data.n < 3 ? (
        <p class="article-chart-note">Not enough overlapping data in this window.</p>
      ) : (
        <CorrelationScatterSvg data={data} />
      )}
      {caption && <figcaption class="article-chart-caption">{caption}</figcaption>}
    </figure>
  )
}
