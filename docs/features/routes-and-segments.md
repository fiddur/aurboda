# Routes and Segments

Per-activity GPS tracks, and what they make possible: recognising "the same run as
before" (routes), timing stretches you run often (segments), classifying runs
(low-HR, intervals, long, tempo) and comparing segment times with friends across
instances. Built in five phases; this page is the design for all of them and says
which parts exist.

| Phase | What                                                | Status          |
| ----- | --------------------------------------------------- | --------------- |
| 1     | `activity_tracks`: full-resolution tracks, backfill | shipped (#1231) |
| 2     | Routes: matching, efforts over time                 | planned (#1232) |
| 3     | Run features and rule-based categories              | planned (#1233) |
| 4     | Segments: manual, timed efforts, suggestions        | planned (#1234) |
| 5     | Federated segment challenges                        | planned (#1235) |

## Phase 1: activity tracks

### Why a track table

GPS used to live only in the shared `locations` point table, keyed `(source, time)`,
and an activity's track was "every point between `start_time` and `end_time`". That is
right for _where was I_ (the places pipeline reads it at one point a minute), but it
stores no line, so nothing could be matched against anything. `activity_tracks` holds
one line per activity and source:

```sql
CREATE TABLE activity_tracks (
    activity_id      UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    source           VARCHAR(50) NOT NULL,
    geom             GEOMETRY(LINESTRINGZM, 4326) NOT NULL,  -- Z = altitude m, M = seconds since start_time
    simplified       GEOMETRY(LINESTRING, 4326) NOT NULL,    -- ~8 m tolerance; what matching runs on
    length_m         DOUBLE PRECISION NOT NULL,
    point_count      INTEGER NOT NULL,
    full_resolution  BOOLEAN NOT NULL DEFAULT true,          -- false for a polyline-only backfill
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (activity_id, source)
);
CREATE INDEX idx_activity_tracks_simplified ON activity_tracks USING GIST (simplified);
```

The M coordinate is what makes everything later cheap: `ST_LineLocatePoint` and
interpolation give "when was I at this point" without a second table. `locations` is
unchanged; the track is the full-resolution copy. A 1 Hz hour is about 100 KB, so a
thousand runs is about 100 MB.

### Ingest

- **Garmin**: the activity detail (`activityDetailMetrics`, every sample, with
  `directElevation`) is written as a track when the detail is synced; `geoPolylineDTO`
  is the fallback when the metrics carry no coordinates.
- **Strava**: the `latlng`/`time`/`altitude` streams are written at full resolution.
  Strava's `velocity_smooth` stream lands in `time_series` as `speed`, which pace-based
  classification (phase 3) needs. The `distance` stream is fetched but not stored: it is
  cumulative from the activity start, while the `distance` metric is a daily total read
  only from cumulative sources.

Both go through one pure `buildTrack` that drops `0,0` fixes, sorts by time, collapses
equal timestamps and refuses a track with fewer than two distinct points.

### Backfill

Stored raw records are enough to build tracks for history without new API calls:

- **Garmin** keeps the full detail JSON in `raw_records` (`garmin_activity_detail`), so
  the backfill is the same extractor over stored data: full resolution.
- **Strava** keeps the detailed activity (`strava_activity`) with `map.polyline`, a shape
  with no timestamps — streams were never stored. The backfill decodes it and spreads M
  evenly over the elapsed time, flagged `full_resolution = false`: good enough for route
  matching and segment suggestion, not for timing.

The backfill is incremental (activities with a usable raw record and no track) and runs
per user in the `track-backfill` queue at startup, and on demand through
`POST /tracks/backfill` / the `backfill_activity_tracks` MCP tool.

### Reads

- `GET /activities/:id/track` and `get_activity_track`: `{ source, points: [{lat, lon,
alt, t}], length_m, point_count, full_resolution }`, `t` in seconds since the
  activity's start.
- `/activities/:id/full` (and `get_activity_detail`) use the track for `gps` when one
  exists and fall back to `locations` by time window otherwise; so does the web
  activity map. The Android app embeds the web page.

### Post-processing hook

Writing a track enqueues a `track-analyse` job (one per activity, `stately` so a
re-sync collapses into one run, after a ten-minute stabilisation delay like
auto-share). Phase 1 registers the queue with nothing in it; later phases add route
matching, features and segment matching there. Strava ingest now also fires the
activity notifier, so a Strava activity gets deduction and auto-share evaluation like a
Garmin one.

## Phase 2: routes

**Buffer coverage, not Fréchet.** For a new track T and a candidate route R:

```
coverage(T,R) = ST_Length(ST_Intersection(T.simplified, R.buffer)) / ST_Length(T.simplified)
coverage(R,T) = ST_Length(ST_Intersection(R.geom,       T.buffer)) / ST_Length(R.geom)
```

match when both are ≥ 0.9, with `R.buffer = ST_Buffer(R.geom::geography, 25 m)`
precomputed. Coverage tolerates GPS noise and a 100 m detour; `ST_FrechetDistance` is a
max-deviation measure and calls a single wrong turn a different route.

**Direction matters**: reverse direction is a different route (uphill one way,
downhill the other). After the coverage test, T's matched vertices must project onto
R (`ST_LineLocatePoint`) monotonically forward. No direction flag is stored.

Cost per new activity: GiST bbox prefilter → a handful of candidates → one
`ST_Intersection` each on simplified lines, about a millisecond per candidate.

Tables: `routes (id, name, geom, buffer, length_m, start_pt, end_pt,
canonical_activity_id, activity_count, …)` and `activity_routes (activity_id,
route_id, coverage, matched_at)`. A route is born when a new track matches another
_unrouted_ track, so single runs don't litter the list; the older track is the
canonical geometry. Auto-named from the nearest named/detected location plus length
("Söderhallarna loop · 8.2 km"), renameable, mergeable.

Surfaces: `list_routes`, `get_route` (efforts over time: elapsed, avg HR, pace, and
pace at HR — the low-HR progress chart), rename, merge, delete; "other runs on this
route" on the activity page; a `route_id` filter on activity queries. Web `/routes`
and `/routes/:id`, embedded in Android.

## Phase 3: run features and categories

Run categories are **structured data on the Run activity**
(`data.run_categories = [{ category, reasons }]`), not child activity types, so the type
hierarchy stays clean and `query_activities` / `query_activity_sessions` get a
`category` filter.

Features are computed once per activity by pure functions over the stored time series
and the track (`activity_features`: zone fractions, moving time, HR drift, pace CV,
interval block statistics, elevation, route). Rules over the features classify, with
seeded defaults the user can retune through the deduction-rule engine:

- **Low-HR / MAF**: ≥ 85 % of moving time in zones ≤ 2 and ≤ 5 % in ≥ 4; ceiling =
  zone-2 upper bound, or an optional `maf_hr` setting (180 − age with the Maffetone
  adjustments).
- **Intervals**: pace smoothed over 30 s, binarised against the run's own median;
  ≥ 3 fast blocks of 30 s–8 min, block-duration CV < 40 %, fast blocks ≥ 12 % faster.
- **Long**: ≥ 90 min or ≥ 1.5 × the 90-day median run. **Tempo**: ≥ 50 % in zone 4
  with low pace CV. **Hard/race**: ≥ 40 % in zone 5.

## Phase 4: segments

Manual first: pick start/end on a track's map, or "from this route, km 2.0–4.5"; the
segment is that sub-line (`ST_LineSubstring`), buffered 20–25 m, directional like a
route.

Effort timing runs in pure TypeScript on the full-resolution points: for each point,
the distance to the segment polyline and the projected position along it; the pass
where the projection runs monotonically from 0 to the segment length while staying
inside 25 m is the effort, with entry/exit times interpolated between the straddling
samples. ±1–2 s at 1 Hz; polyline-only Strava history is matched but flagged
`approximate`.

Suggestions are incremental and pairwise: for the new track A and each
bbox-overlapping track B _not on the same route_, `ST_Intersection(A.simplified,
ST_Buffer(B.simplified, 20 m))` gives the stretches of A within 20 m of B; stretches
≥ 400 m are clustered by mutual coverage ≥ 80 %, and a cluster of ≥ 3 activities
becomes a suggested segment to confirm, trim, name or dismiss — the detected-locations
pattern. Excluding same-route pairs is what surfaces the hill shared by different
routes instead of re-proposing every route.

## Phase 5: federated segment challenges

One database per user; nothing cross-user in SQL. A **segment challenge** carries the
segment geometry in its definition and aggregates `min(elapsed_s)`; joining is the
opt-in, each member's instance computes its own efforts locally and serves them through
the token-scoped challenge-data endpoint, and the leaderboard is the challenge result.
This reuses every consent mechanism challenges already have and works across
installations. Such a challenge may be ongoing, without a time frame; how that fits the
challenge model is decided when the phase is picked up.

Privacy: nobody's GPS leaves their instance, only elapsed seconds and the effort date;
route and segment geometry derived from a user's own tracks is never shared without an
explicit step, and a segment that starts or ends within ~500 m of a named location
gets a warning.
