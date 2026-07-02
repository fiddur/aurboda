import type {
  CaloriesBurnedPeriodStat,
  NutrientFieldDef,
  NutrientPeriodStat,
  NutrientPeriodSummary,
  NutrientRecommendation,
  ReportFlag,
} from '@aurboda/api-spec'

import { NUTRIENT_FIELDS } from '@aurboda/api-spec'
import { useQueries, useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { useMemo, useState } from 'preact/hooks'

import type { RangeMarker } from '../../components/ReferenceRangeBar'

import { DateNav } from '../../components/DateNav'
import { ReferenceRangeBar } from '../../components/ReferenceRangeBar'
import { fetchMealsPeriodSummary, fetchNutrientRecommendations } from '../../state/api'
import { auth } from '../../state/auth'

type WindowKey = '1' | '7' | '30' | '90'

interface WindowDef {
  key: WindowKey
  label: string
  days: number
}

const WINDOWS: WindowDef[] = [
  { days: 1, key: '1', label: '1d' },
  { days: 7, key: '7', label: '7d' },
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

const flagFor = (
  value: number,
  low: number | null | undefined,
  high: number | null | undefined,
): ReportFlag => {
  if (low !== null && low !== undefined && value < low) return 'low'
  if (high !== null && high !== undefined && value > high) return 'high'
  return 'normal'
}

const userTz = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
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

interface WindowData {
  window: WindowDef
  start: string
  end: string
  summary: NutrientPeriodSummary | undefined
}

/**
 * Shared <colgroup> so every <table class="overview-table"> on the page lays
 * its columns out identically — that's what lines the 1d/7d/30d/90d numbers
 * up across the Energy Balance section and the per-category nutrient tables.
 * Requires `table-layout: fixed` on .overview-table.
 */
function OverviewColgroup() {
  return (
    <colgroup>
      <col class="col-name" />
      <col class="col-window" data-window="1" />
      <col class="col-window" data-window="7" />
      <col class="col-window" data-window="30" />
      <col class="col-window" data-window="90" />
      <col class="col-range" />
    </colgroup>
  )
}

function WindowHeaderCell({
  w,
  activeKey,
  countOnlyCompleted,
}: {
  w: WindowData
  activeKey: WindowKey
  countOnlyCompleted: boolean
}) {
  // The actual avg denominator is `days_with_meals` (after the optional
  // completed-day filter), not `days_completed` — a day marked complete with
  // no meal logged doesn't contribute to the average, so showing the bare
  // completed count would overstate it. `days_completed` is still useful as
  // the "marked complete" hint when the filter is off.
  const showSub = w.window.days > 1 && w.summary !== undefined
  const denominator = w.summary?.days_with_meals
  const completed = w.summary?.days_completed
  return (
    <th
      class="num window-col"
      data-window={w.window.key}
      data-active={w.window.key === activeKey ? 'true' : 'false'}
    >
      <span class="window-label">{w.window.label}</span>
      <span class="window-tick" aria-hidden="true" data-window={w.window.key} />
      {showSub && (
        <span class="window-sub">
          {countOnlyCompleted
            ? `avg from ${denominator} completed`
            : `${completed} of ${denominator} completed`}
        </span>
      )}
    </th>
  )
}

function OverviewThead({
  windows,
  activeKey,
  countOnlyCompleted,
  nameLabel,
  showRangeHeader,
}: {
  windows: WindowData[]
  activeKey: WindowKey
  countOnlyCompleted: boolean
  nameLabel: string
  showRangeHeader: boolean
}) {
  return (
    <thead>
      <tr>
        <th class="col-name-header">{nameLabel}</th>
        {windows.map((w) => (
          <WindowHeaderCell
            key={w.window.key}
            w={w}
            activeKey={activeKey}
            countOnlyCompleted={countOnlyCompleted}
          />
        ))}
        <th class="range-col">{showRangeHeader ? 'Range' : ''}</th>
      </tr>
    </thead>
  )
}

function EnergySection({
  windows,
  activeKey,
  countOnlyCompleted,
}: {
  windows: WindowData[]
  activeKey: WindowKey
  countOnlyCompleted: boolean
}) {
  return (
    <section class="overview-group overview-energy">
      <h3>Energy balance</h3>
      <table class="overview-table">
        <OverviewColgroup />
        <OverviewThead
          windows={windows}
          activeKey={activeKey}
          countOnlyCompleted={countOnlyCompleted}
          nameLabel=""
          showRangeHeader={false}
        />
        <tbody>
          <EnergyRow label="Eaten / day" windows={windows} activeKey={activeKey} kind="eaten" />
          <EnergyRow label="Burned / day" windows={windows} activeKey={activeKey} kind="burned" />
          <EnergyRow label="Balance" windows={windows} activeKey={activeKey} kind="balance" />
        </tbody>
      </table>
    </section>
  )
}

type EnergyKind = 'eaten' | 'burned' | 'balance'

const energyValueFor = (w: WindowData, kind: EnergyKind): number | null => {
  const eaten = w.summary?.nutrients.calories?.avg ?? null
  const burned: CaloriesBurnedPeriodStat | null = w.summary?.calories_burned ?? null
  const burnedAvg = burned?.avg ?? null
  if (kind === 'eaten') return eaten
  if (kind === 'burned') return burnedAvg
  return eaten !== null && burnedAvg !== null ? eaten - burnedAvg : null
}

function EnergyCell({ w, kind, activeKey }: { w: WindowData; kind: EnergyKind; activeKey: WindowKey }) {
  const value = energyValueFor(w, kind)
  const cls = kind === 'balance' ? balanceClass(value) : ''
  return (
    <td
      class={`num window-col energy-cell ${cls}`}
      data-window={w.window.key}
      data-active={w.window.key === activeKey ? 'true' : 'false'}
    >
      {value !== null ? (
        <>
          <span class="energy-num">
            {kind === 'balance' && value > 0 ? '+' : ''}
            {Math.round(value)} kcal
          </span>
          {kind === 'balance' && <span class="energy-sub">{balanceLabel(value)}</span>}
        </>
      ) : (
        <span class="energy-num muted">—</span>
      )}
    </td>
  )
}

function EnergyRow({
  label,
  windows,
  activeKey,
  kind,
}: {
  label: string
  windows: WindowData[]
  activeKey: WindowKey
  kind: EnergyKind
}) {
  return (
    <tr>
      <td class="energy-row-label">{label}</td>
      {windows.map((w) => (
        <EnergyCell key={w.window.key} w={w} kind={kind} activeKey={activeKey} />
      ))}
      <td class="range-col" />
    </tr>
  )
}

interface NutrientCellInfo {
  windowKey: WindowKey
  label: string
  stat: NutrientPeriodStat | undefined
}

function NutrientRowView({
  field,
  cells,
  recommendation,
  activeKey,
}: {
  field: NutrientFieldDef
  cells: NutrientCellInfo[]
  recommendation?: NutrientRecommendation
  activeKey: WindowKey
}) {
  const markers: RangeMarker[] = recommendation
    ? cells.flatMap((c) =>
        c.stat
          ? [
              {
                flag: flagFor(c.stat.avg, recommendation.recommended_low, recommendation.recommended_high),
                label: c.label,
                value: c.stat.avg,
                windowKey: c.windowKey,
              },
            ]
          : [],
      )
    : []

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
      {cells.map((c) => (
        <td
          key={c.windowKey}
          class="num window-col"
          data-window={c.windowKey}
          data-active={c.windowKey === activeKey ? 'true' : 'false'}
        >
          {c.stat ? (
            <>
              {formatNutrientValue(c.stat.avg, field.unit)} <span class="nutrient-unit">{field.unit}</span>
            </>
          ) : (
            <span class="muted">—</span>
          )}
        </td>
      ))}
      <td class="range-col">
        {recommendation && markers.length > 0 && (
          <ReferenceRangeBar
            markers={markers}
            reference_low={recommendation.recommended_low ?? undefined}
            reference_high={recommendation.recommended_high ?? undefined}
          />
        )}
      </td>
    </tr>
  )
}

interface CategoryRow {
  field: NutrientFieldDef
  cells: NutrientCellInfo[]
  recommendation?: NutrientRecommendation
}

function CategorySection({
  label,
  rows,
  windows,
  activeKey,
  countOnlyCompleted,
}: {
  label: string
  rows: CategoryRow[]
  windows: WindowData[]
  activeKey: WindowKey
  countOnlyCompleted: boolean
}) {
  return (
    <section class="overview-group">
      <h3>{label}</h3>
      <table class="overview-table">
        <OverviewColgroup />
        <OverviewThead
          windows={windows}
          activeKey={activeKey}
          countOnlyCompleted={countOnlyCompleted}
          nameLabel="Nutrient"
          showRangeHeader
        />
        <tbody>
          {rows.map((row) => (
            <NutrientRowView key={row.field.name} {...row} activeKey={activeKey} />
          ))}
        </tbody>
      </table>
    </section>
  )
}

const groupRowsByCategory = (
  windows: WindowData[],
  recByName: Map<string, NutrientRecommendation>,
): Map<NutrientFieldDef['category'], CategoryRow[]> => {
  const out = new Map<NutrientFieldDef['category'], CategoryRow[]>()
  for (const field of NUTRIENT_FIELDS) {
    const cells: NutrientCellInfo[] = windows.map((w) => ({
      label: w.window.label,
      stat: w.summary?.nutrients[field.name],
      windowKey: w.window.key,
    }))
    if (!cells.some((c) => c.stat)) continue
    const list = out.get(field.category) ?? []
    list.push({ cells, field, recommendation: recByName.get(field.name) })
    out.set(field.category, list)
  }
  return out
}

const rangeFor = (endDate: string, days: number): { start: string; end: string } => {
  const end = new Date(endDate)
  return { end: endDate, start: ymd(subDays(end, days - 1)) }
}

export function MealsOverview() {
  const isLoggedIn = auth.value.token
  const [endDate, setEndDate] = useState<string>(ymd(new Date()))
  const [activeKey, setActiveKey] = useState<WindowKey>('30')
  const [countOnlyCompleted, setCountOnlyCompleted] = useState<boolean>(true)
  const tz = userTz()

  const ranges = useMemo(() => WINDOWS.map((w) => ({ window: w, ...rangeFor(endDate, w.days) })), [endDate])

  // 1D never filters by completion — a single day is either logged or not, the
  // toggle would just blank the column. Longer windows pass the user's
  // preference through.
  const queries = useQueries({
    queries: ranges.map((r) => {
      const filterCompleted = countOnlyCompleted && r.window.days > 1
      return {
        enabled: !!isLoggedIn,
        queryFn: () =>
          fetchMealsPeriodSummary({
            count_only_completed: filterCompleted,
            end: r.end,
            start: r.start,
            tz,
          }),
        queryKey: ['mealsPeriodSummary', r.start, r.end, tz, filterCompleted],
        staleTime: 60_000,
      }
    }),
  })

  const isAnyLoading = queries.some((q) => q.isLoading)

  const windowsData: WindowData[] = ranges.map((r, i) => ({
    end: r.end,
    start: r.start,
    summary: queries[i]?.data,
    window: r.window,
  }))

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

  const rowsByCategory = groupRowsByCategory(windowsData, recByName)

  if (!isLoggedIn) return <p>Please log in to use meal tracking.</p>

  const anyNutrientData = windowsData.some((w) => w.summary && Object.keys(w.summary.nutrients).length > 0)

  return (
    <div class="meals-overview" data-active={activeKey}>
      <div class="overview-controls">
        <DateNav value={endDate} onChange={setEndDate} maxToday />
        <div class="overview-window-control">
          <WindowSelector windowKey={activeKey} onChange={setActiveKey} />
        </div>
        <label class="overview-completed-toggle" data-hide-when-active="1">
          <input
            type="checkbox"
            checked={countOnlyCompleted}
            onChange={(e) => setCountOnlyCompleted((e.target as HTMLInputElement).checked)}
          />
          <span>Only include completed days</span>
        </label>
      </div>

      {isAnyLoading && <p class="loading">Loading…</p>}

      {!isAnyLoading && (
        <>
          <EnergySection
            windows={windowsData}
            activeKey={activeKey}
            countOnlyCompleted={countOnlyCompleted}
          />
          {NUTRIENT_CATEGORIES.map(({ key, label }) => {
            const rows = rowsByCategory.get(key)
            if (!rows || rows.length === 0) return null
            return (
              <CategorySection
                key={key}
                label={label}
                rows={rows}
                windows={windowsData}
                activeKey={activeKey}
                countOnlyCompleted={countOnlyCompleted}
              />
            )
          })}
          {!anyNutrientData && <p class="overview-empty">No meal nutrient data in this window.</p>}
        </>
      )}
    </div>
  )
}
