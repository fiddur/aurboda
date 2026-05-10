import type {
  CaloriesBurnedPeriodStat,
  NutrientFieldDef,
  NutrientPeriodStat,
  NutrientRecommendation,
  ReportFlag,
} from '@aurboda/api-spec'

import { NUTRIENT_FIELDS } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { useMemo, useState } from 'preact/hooks'

import { ReferenceRangeBar } from '../../components/ReferenceRangeBar'
import { fetchMealsPeriodSummary, fetchNutrientRecommendations } from '../../state/api'
import { auth } from '../../state/auth'

type WindowKey = '7' | '14' | '30' | '90'

const WINDOWS: { key: WindowKey; label: string; days: number }[] = [
  { days: 7, key: '7', label: '7d' },
  { days: 14, key: '14', label: '14d' },
  { days: 30, key: '30', label: '30d' },
  { days: 90, key: '90', label: '90d' },
]

const NUTRIENT_CATEGORIES: { key: NutrientFieldDef['category']; label: string }[] = [
  { key: 'macro', label: 'Macros' },
  { key: 'extended_macro', label: 'Extended' },
  { key: 'fat_breakdown', label: 'Fats' },
  { key: 'vitamin', label: 'Vitamins' },
  { key: 'mineral', label: 'Minerals' },
  { key: 'amino_acid', label: 'Amino Acids' },
  { key: 'other', label: 'Other' },
]

const ymd = (d: Date): string => format(d, 'yyyy-MM-dd')

/**
 * Format a nutrient average for display. Picks decimals based on magnitude
 * so vitamins in µg/mg with sub-1 values (B12 ≈ 2 µg, vitamin K ≈ 80 µg,
 * folate ≈ 0.3 mg if mis-unit'd) stay legible — toFixed(1) would lose all
 * precision on the small end.
 */
const formatNutrientValue = (value: number, unit: string): string => {
  if (unit === 'kcal') return value.toFixed(0)
  const abs = Math.abs(value)
  let decimals: number
  if (abs >= 100) decimals = 0
  else if (abs >= 10) decimals = 1
  else if (abs >= 1) decimals = 2
  else decimals = 3
  return value.toFixed(decimals)
}

/**
 * Map a value against a recommended range to the same flag enum used by
 * report cards, so the existing ReferenceRangeBar marker color stays
 * consistent across the app. v1 doesn't surface "critical" thresholds —
 * that maps to a future tier on the override schema.
 */
const flagFor = (
  value: number,
  low: number | null | undefined,
  high: number | null | undefined,
): ReportFlag => {
  if (low !== null && low !== undefined && value < low) return 'low'
  if (high !== null && high !== undefined && value > high) return 'high'
  return 'normal'
}

interface NutrientRow {
  field: NutrientFieldDef
  stat: NutrientPeriodStat
  recommendation?: NutrientRecommendation
}

const userTz = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function WindowSelector({ windowKey, onChange }: { windowKey: WindowKey; onChange: (k: WindowKey) => void }) {
  return (
    <div class="window-selector" role="tablist" aria-label="Date range">
      {WINDOWS.map((w) => (
        <button
          key={w.key}
          type="button"
          class={`window-btn ${w.key === windowKey ? 'active' : ''}`}
          onClick={() => onChange(w.key)}
        >
          {w.label}
        </button>
      ))}
    </div>
  )
}

const balanceClass = (balance: number | null): string => {
  if (balance === null) return ''
  if (balance > 0) return 'positive'
  if (balance < 0) return 'negative'
  return ''
}

const balanceLabel = (balance: number): string => {
  if (balance > 0) return 'surplus'
  if (balance < 0) return 'deficit'
  return 'balanced'
}

function EnergySection({
  eaten,
  burned,
}: {
  eaten?: NutrientPeriodStat
  burned: CaloriesBurnedPeriodStat | null
}) {
  const eatenAvg = eaten?.avg ?? 0
  const burnedAvg = burned?.avg ?? null
  const balance = burnedAvg !== null ? eatenAvg - burnedAvg : null

  return (
    <section class="overview-energy">
      <h3>Energy balance</h3>
      <div class="energy-row">
        <div class="energy-cell">
          <span class="energy-label">Eaten / day</span>
          <span class="energy-value">{eatenAvg ? `${Math.round(eatenAvg)} kcal` : '—'}</span>
          {eaten && (
            <span class="energy-sub">
              over {eaten.days_with_data} {eaten.days_with_data === 1 ? 'day' : 'days'}
            </span>
          )}
        </div>
        <div class="energy-cell">
          <span class="energy-label">Burned / day</span>
          <span class="energy-value">{burnedAvg !== null ? `${Math.round(burnedAvg)} kcal` : '—'}</span>
          {burned ? (
            <span class="energy-sub">
              over {burned.days_with_data} {burned.days_with_data === 1 ? 'day' : 'days'}
            </span>
          ) : (
            <span class="energy-sub">
              No <code>calories_total</code> metric in window — connect Garmin / Health Connect to see burn
              comparison.
            </span>
          )}
        </div>
        <div class="energy-cell">
          <span class="energy-label">Balance</span>
          <span class={`energy-value ${balanceClass(balance)}`}>
            {balance !== null ? `${balance > 0 ? '+' : ''}${Math.round(balance)} kcal` : '—'}
          </span>
          {balance !== null && <span class="energy-sub">{balanceLabel(balance)}</span>}
        </div>
      </div>
    </section>
  )
}

function NutrientRowView({ field, stat, recommendation }: NutrientRow) {
  const flag = recommendation
    ? flagFor(stat.avg, recommendation.recommended_low, recommendation.recommended_high)
    : undefined
  return (
    <tr>
      <td>
        <span class="nutrient-name">{field.label}</span>
        {recommendation?.source === 'user' && (
          <span class="rec-source" title="User-set range">
            ★
          </span>
        )}
      </td>
      <td class="num">
        {formatNutrientValue(stat.avg, field.unit)} {field.unit}
      </td>
      <td class="range-col">
        {recommendation && (
          <ReferenceRangeBar
            value={stat.avg}
            reference_low={recommendation.recommended_low ?? undefined}
            reference_high={recommendation.recommended_high ?? undefined}
            flag={flag}
          />
        )}
      </td>
    </tr>
  )
}

function CategorySection({ label, rows }: { label: string; rows: NutrientRow[] }) {
  return (
    <section class="overview-group">
      <h3>{label}</h3>
      <table class="overview-table">
        <thead>
          <tr>
            <th>Nutrient</th>
            <th class="num">Avg / day</th>
            <th class="range-col">Range</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <NutrientRowView key={row.field.name} {...row} />
          ))}
        </tbody>
      </table>
    </section>
  )
}

const groupRowsByCategory = (
  nutrients: Record<string, NutrientPeriodStat>,
  recByName: Map<string, NutrientRecommendation>,
): Map<NutrientFieldDef['category'], NutrientRow[]> => {
  const out = new Map<NutrientFieldDef['category'], NutrientRow[]>()
  for (const field of NUTRIENT_FIELDS) {
    const stat = nutrients[field.name]
    if (!stat) continue
    const list = out.get(field.category) ?? []
    list.push({ field, recommendation: recByName.get(field.name), stat })
    out.set(field.category, list)
  }
  return out
}

const daysForWindow = (key: WindowKey): number => WINDOWS.find((w) => w.key === key)?.days ?? 30

export function MealsOverview() {
  const isLoggedIn = auth.value.token
  const [windowKey, setWindowKey] = useState<WindowKey>('30')
  const days = daysForWindow(windowKey)

  const range = useMemo(() => {
    const today = new Date()
    return { end: ymd(today), start: ymd(subDays(today, days - 1)) }
  }, [days])

  const tz = userTz()

  const { data: summary, isLoading: isSummaryLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchMealsPeriodSummary({ end: range.end, start: range.start, tz }),
    queryKey: ['mealsPeriodSummary', range.start, range.end, tz],
    staleTime: 60_000,
  })

  const { data: recommendations = [] } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchNutrientRecommendations,
    queryKey: ['nutrientRecommendations'],
    staleTime: 5 * 60_000,
  })

  const recByName = useMemo(
    () => new Map(recommendations.map((r) => [r.nutrient_name, r])),
    [recommendations],
  )

  const nutrients = summary?.nutrients ?? {}
  const rowsByCategory = useMemo(() => groupRowsByCategory(nutrients, recByName), [nutrients, recByName])

  if (!isLoggedIn) return <p>Please log in to use meal tracking.</p>

  return (
    <div class="meals-overview">
      <div class="overview-controls">
        <WindowSelector windowKey={windowKey} onChange={setWindowKey} />
        <span class="overview-range">
          {range.start} → {range.end}
        </span>
      </div>

      {isSummaryLoading && <p class="loading">Loading…</p>}

      {!isSummaryLoading && summary && (
        <>
          <EnergySection eaten={summary.nutrients.calories} burned={summary.calories_burned ?? null} />
          {NUTRIENT_CATEGORIES.map(({ key, label }) => {
            const rows = rowsByCategory.get(key)
            if (!rows || rows.length === 0) return null
            return <CategorySection key={key} label={label} rows={rows} />
          })}
          {Object.keys(nutrients).length === 0 && (
            <p class="overview-empty">No meal nutrient data in this window.</p>
          )}
        </>
      )}
    </div>
  )
}
