# Weather (Open-Meteo)

Aurboda can look up the hourly weather **where you were**, from your own location history (OwnTracks, Home Assistant, activity GPS), so a day or an activity can show the weather it had. The weather comes from [Open-Meteo](https://open-meteo.com/), which needs no API key. It is **opt-in**: nothing is fetched until you turn it on.

## Data Synced

Each hour is stored as up to four rows in `time_series`, with `source = 'open_meteo'` and `time` the start of the UTC hour:

| Metric                  | Unit      | Open-Meteo variable | Notes                                                          |
| ----------------------- | --------- | ------------------- | -------------------------------------------------------------- |
| `weather_code`          | `wmo`     | `weather_code`      | [WMO weather interpretation code](#wmo-codes)                  |
| `weather_temperature`   | `celsius` | `temperature_2m`    | Air temperature 2 m above ground                               |
| `weather_precipitation` | `mm`      | `precipitation`     | Rain, showers and snow during the hour; summed per day (`sum`) |
| `weather_wind_speed`    | `m/s`     | `wind_speed_10m`    | Asked for in m/s (`wind_speed_unit=ms`)                        |

A value Open-Meteo leaves `null` is not stored. The rows are ordinary metrics, so they can be queried and charted like any other — except that an average of `weather_code` means nothing: chart the code as a count or per hour, or use the [read API](#reading-the-weather), which names the condition.

## Privacy

Your coordinates are **rounded to 0.1°** (about 11 km north–south, less east–west) before they leave the server; every request goes through that one rounding, and the request carries nothing else about you (no user name, no times beyond the dates asked for). Open-Meteo sees which ~11 km cells you were in on which days, not where you were within them.

## Admin Setup

None. The server needs to reach `api.open-meteo.com` and `archive-api.open-meteo.com` over https.

Open-Meteo's free API is for **non-commercial use** with attribution ([terms](https://open-meteo.com/en/terms)); the weather page links back to Open-Meteo. A commercial deployment needs an Open-Meteo subscription, which this integration does not configure.

## User Setup

Go to **Data Sources → Weather** and turn on **Fetch the weather where I was**. Then **Sync Now**, or wait for the background poll. Turning it off stops fetching; the weather already stored stays.

Settings via the API: `PATCH /api/user/settings` with `weather_enabled` (`true`, `false`, or `null` to reset to the default, off).

## How Sync Works

- **REST:** `POST /api/sync/weather` — `{ "full_resync": true }` or `{ "start_date": "YYYY-MM-DD" }`, both optional. The result counts `hours_stored`, `cells` (rounded locations fetched) and `cells_deferred` (rounded locations left for the next run), and carries `window_end` when a `start_date` run was capped. `success` is `true` only when the run's `status` is `success` (the HTTP status is 200 either way).
- **MCP:** `sync_weather()`
- **Status:** `GET /api/sync/weather/status`, `get_sync_status(provider: "weather")`
- **Reset:** `DELETE /api/sync/weather/state`, `reset_sync_state(provider: "weather")`. Both forget the sync state, so the next sync is a first sync. Stored weather is kept.

**Which location an hour gets.** Each hour takes the last location fix at or before the **middle of the hour**, from any source. A fix is carried forward for at most **7 days** (a phone at rest reports little); an hour with no such fix gets no weather.

**Window.** The first sync (or a full resync) covers the **last 90 days**. Later syncs start **48 hours before the last sync**: the most recent hours are model output that Open-Meteo refines, so they are fetched again and the stored rows updated. Older hours that already have weather are skipped, except on a full resync. **Fetch older history from** (`start_date`) fetches from any earlier date (on a first sync, from the earlier of that date and 90 days ago, so the first 90 days are never skipped), **at most 366 days per run**: a capped run reports `window_end` in its result ("fetched up to …"), does not move the last sync time, and the page fills the date in so **Fetch** continues from there.

**Requests.** The hours are grouped by rounded location, and each location gets one request per contiguous range of days (Open-Meteo answers whole days; only the hours assigned to that location are kept, and never an hour that has not begun):

```
GET https://api.open-meteo.com/v1/forecast?latitude=59.3&longitude=18.1&start_date=…&end_date=…&hourly=weather_code,temperature_2m,precipitation,wind_speed_10m&timezone=UTC&wind_speed_unit=ms
```

Days within the last 90 days go to the forecast API above; older days to the archive API (`https://archive-api.open-meteo.com/v1/archive`, same parameters).

**At most 20 rounded locations per run**: those with the most hours still missing first. The rest are counted in `cells_deferred`. When a deferred location has hours not stored yet, the last sync time is not moved on, so the next run (the next scheduler tick, five minutes later) picks them up; locations deferred only for the 48-hour refresh do not hold it back, so many places in two days do not make every tick fetch again. A `start_date` fetch that defers locations finishes when you fetch again.

**Background polling.** The scheduler polls every **180 minutes** by default; set `sync_intervals.weather` (or `sync_intervals.default`) to change it. Weather is not synced before queries. After a failed run (Open-Meteo down or throttling) the background poll waits 60 minutes before it tries again; a manual sync runs at once.

## Reading the weather

- **REST:** `GET /api/weather?date=YYYY-MM-DD[&tz=Europe/Stockholm]` for a calendar day, or `GET /api/weather?start=<ISO>&end=<ISO>` for a span. Exactly one of the two forms (400 otherwise); a span is at most **31 days** (400 otherwise).
- **MCP:** `get_weather` with the same parameters.

The answer is `{ hours, summary }`. `hours` lists every stored hour — of the day, or overlapping the span (a 20-minute activity gets its one hour) — with `code`, `temperature`, `precipitation` and `wind_speed` (`null` where a value is missing). `summary` is `null` when no hour has weather, else:

| Field                                                   | Meaning                           |
| ------------------------------------------------------- | --------------------------------- |
| `code`, `condition`, `emoji`                            | The summary condition (see below) |
| `temperature_avg`, `temperature_min`, `temperature_max` | Over the summarised hours, °C     |
| `precipitation_sum`                                     | mm                                |
| `wind_speed_max`                                        | m/s                               |
| `hours`                                                 | How many hours the summary covers |

**Condition.** Among the hours with a code: when at least a quarter of them have a precipitating code (WMO 51 and up), the most frequent precipitating code; otherwise the most frequent code. A tie goes to the higher code.

**A day's weather follows where most of the day was spent.** For the `date` form, each hour of the day is given its rounded location the same way the sync does; only the hours of the location with the most hours are summarised (all of them when no location can be told), so a travel day reads as the place you spent it in. `hours` still lists the whole day. The day's condition uses the hours **07:00–21:59** local time when any of them has a code; temperatures, precipitation and wind use all of the day's summarised hours. `tz` defaults to your time zone.

## Where it shows

- **Activities:** an activity's page has a **Weather** row (condition, temperature, precipitation when there was any) for the hours it spans; an activity without an end gets the hour it started in. Not for sleep. The row is left out when there is no weather.
- **Journal:** the context line's **Weather** item ([journal](./features/journal.md#context-line)): a timed entry's hour, a day entry's day.

## WMO codes

`0` clear sky ☀️, `1` mainly clear 🌤️, `2` partly cloudy ⛅, `3` overcast ☁️, `45`/`48` fog 🌫️, `51`–`57` drizzle, `61`–`67` rain, `71`–`77` snow, `80`–`82` rain showers, `85`/`86` snow showers, `95`–`99` thunderstorm ⛈️. The full table, with an emoji per code, is `wmoWeatherConditions` in `@aurboda/api-spec`; an unknown code reads as "Unknown" 🌡️.

## Limitations

- The weather is only as good as your location history: no fixes, no weather.
- An 11 km cell's weather is a model value for that cell, not a station reading where you stood.
- Open-Meteo's archive lags a few days behind; that never matters here, since the last 90 days come from the forecast API.
