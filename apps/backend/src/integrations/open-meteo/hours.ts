export const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** How long a location fix stands for where the user was. */
export const MAX_FIX_CARRY_MS = 7 * DAY_MS
/** Open-Meteo's forecast API serves the recent past; older days come from its archive. */
export const FORECAST_PAST_DAYS = 90
export const MAX_CELLS_PER_RUN = 20

export interface WeatherCell {
  lat: number
  lon: number
}

export interface Fix {
  lat: number
  lon: number
  time: Date
}

const roundToTenth = (value: number): number => Math.round(value * 10) / 10 + 0

/** About 11 km: the only coordinates that ever leave the server. */
export const weatherCell = (lat: number, lon: number): WeatherCell => ({
  lat: roundToTenth(lat),
  lon: roundToTenth(lon),
})

export const cellKey = (cell: WeatherCell): string => `${cell.lat.toFixed(1)},${cell.lon.toFixed(1)}`

export const floorHour = (time: Date): Date => new Date(Math.floor(time.getTime() / HOUR_MS) * HOUR_MS)

/** UTC hour starts from the hour holding `start` through the last hour that has begun by `end`. */
export const hourStarts = (start: Date, end: Date): Date[] => {
  const hours: Date[] = []
  for (let t = floorHour(start).getTime(); t <= end.getTime(); t += HOUR_MS) hours.push(new Date(t))
  return hours
}

/**
 * The cell of each hour: that of the last fix at or before the hour's middle, when it is at most
 * `MAX_FIX_CARRY_MS` old, else null. `fixes` and `hours` ascending.
 */
export const hourCells = (fixes: readonly Fix[], hours: readonly Date[]): (WeatherCell | null)[] => {
  let next = 0
  let last: Fix | undefined
  return hours.map((hour) => {
    const middle = hour.getTime() + HOUR_MS / 2
    while (next < fixes.length && fixes[next].time.getTime() <= middle) last = fixes[next++]
    return last && middle - last.time.getTime() <= MAX_FIX_CARRY_MS ? weatherCell(last.lat, last.lon) : null
  })
}

export type OpenMeteoApi = 'forecast' | 'archive'

export interface WeatherRequest {
  cell: WeatherCell
  api: OpenMeteoApi
  /** UTC dates, inclusive. */
  start_date: string
  end_date: string
  /** The hour starts (epoch ms) to keep from the answer. */
  hours: ReadonlySet<number>
}

export interface WeatherPlan {
  requests: WeatherRequest[]
  cells: number
  cells_deferred: number
}

const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

const nextUtcDate = (date: string): string => utcDate(Date.parse(`${date}T00:00:00Z`) + DAY_MS)

const contiguousRuns = (dates: readonly string[]): string[][] =>
  dates.reduce<string[][]>((runs, date, i) => {
    const current = runs.at(-1)
    if (current && i > 0 && nextUtcDate(dates[i - 1]) === date) current.push(date)
    else runs.push([date])
    return runs
  }, [])

const requestsForCell = (cell: WeatherCell, hours: number[], forecastFrom: string): WeatherRequest[] => {
  const byDate = Map.groupBy(hours, utcDate)
  const dates = [...byDate.keys()].sort()
  const split = (run: string[]): string[][] =>
    [run.filter((d) => d < forecastFrom), run.filter((d) => d >= forecastFrom)].filter((r) => r.length > 0)
  return contiguousRuns(dates)
    .flatMap(split)
    .map((run) => ({
      api: run[0] < forecastFrom ? ('archive' as const) : ('forecast' as const),
      cell,
      end_date: run[run.length - 1],
      hours: new Set(run.flatMap((date) => byDate.get(date) ?? [])),
      start_date: run[0],
    }))
}

export interface AssignedHour {
  hour: Date
  cell: WeatherCell
  /** Already stored, asked again only because recent model output is refined. */
  refresh?: boolean
}

const missingCount = (entries: readonly AssignedHour[]): number => entries.filter((e) => !e.refresh).length

/**
 * Groups the hours by cell and asks for each cell's contiguous date ranges, the recent days from the
 * forecast API and older ones from the archive. Hours after `now` are dropped. At most `maxCells`
 * cells: those with the most hours not stored yet first, then those with the most hours; the rest
 * are counted as deferred.
 */
export const planWeatherRequests = (
  assigned: readonly AssignedHour[],
  now: Date,
  maxCells = MAX_CELLS_PER_RUN,
): WeatherPlan => {
  const past = assigned.filter(({ hour }) => hour.getTime() <= now.getTime())
  const byCell = Map.groupBy(past, ({ cell }) => cellKey(cell))
  const ranked = [...byCell.entries()].sort(
    ([keyA, a], [keyB, b]) =>
      missingCount(b) - missingCount(a) || b.length - a.length || keyA.localeCompare(keyB),
  )
  const chosen = ranked.slice(0, maxCells)
  const forecastFrom = utcDate(now.getTime() - FORECAST_PAST_DAYS * DAY_MS)
  return {
    cells: chosen.length,
    cells_deferred: ranked.length - chosen.length,
    requests: chosen.flatMap(([, entries]) =>
      requestsForCell(
        entries[0].cell,
        entries.map(({ hour }) => hour.getTime()),
        forecastFrom,
      ),
    ),
  }
}
