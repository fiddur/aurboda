# Routes and Segments

Per-activity GPS tracks, and what they make possible: recognising "the same run as
before" (routes), timing stretches you run often (segments), classifying runs
(low-HR, intervals, long, tempo) and comparing segment times with friends across
instances. Built in five phases; this page is the design for all of them and says
which parts exist.

| Phase | What                                                | Status          |
| ----- | --------------------------------------------------- | --------------- |
| 1     | `activity_tracks`: full-resolution tracks, backfill | shipped (#1231) |
| 2     | Routes: matching, efforts over time                 | shipped (#1232) |
| 3     | Run features and rule-based categories              | shipped (#1233) |
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
- `/activities/:id/full` (and `get_activity_detail`) use a full-resolution track for
  `gps`; otherwise the `locations` in the time window, whose real timestamps suit the
  chart hover better than a shape-only track's evenly spread ones, which are used only
  when the window has no locations. The web activity map follows the same rule. The
  Android app embeds the web page.

### Post-processing hook

Writing a track enqueues a `track-analyse` job (one per activity, `stately` so a
re-sync collapses into one run, after a ten-minute stabilisation delay like
auto-share). Route matching (phase 2) runs there, then the activity's features (phase 3);
segment matching is added there later. Strava ingest now also fires the
activity notifier, so a Strava activity gets deduction and auto-share evaluation like a
Garmin one.

## Phase 2: routes

A route is a course run more than once. A new track either joins an existing route or,
with an earlier run of the same course, creates one; a single run never makes a route, so
one-offs do not litter the list.

### Matching

**Buffer coverage, not Fréchet.** For a new track T (its `simplified` line) and a
candidate route R:

```
coverage_track = ST_Length(ST_Intersection(T, R.buffer)) / ST_Length(T)
coverage_route = ST_Length(ST_Intersection(R.geom, ST_Buffer(T, 25 m))) / ST_Length(R.geom)
```

both measured on the geography, a match when both are ≥ 0.9, with
`R.buffer = ST_Buffer(R.geom::geography, 25 m)` stored at creation. Coverage tolerates GPS
noise and a 100 m detour; `ST_FrechetDistance` is a max-deviation measure and calls a
single wrong turn a different route. Among several matching routes the one with the
highest lower coverage wins.

**Direction matters**: reverse direction is a different route (uphill one way, downhill
the other), and no direction flag is stored. After the coverage test, 24 points evenly
spaced along T that fall inside R's buffer are projected onto R (`ST_LineLocatePoint`);
the run is rejected as reversed when at least 80 % of consecutive projections decrease
(and when fewer than four samples fall inside). A reversed run decreases almost everywhere.
A loop started elsewhere on it wraps once and passes. An out-and-back course, whose legs
overlap, projects onto either leg at random and so passes too; it has no meaningful reverse
anyway, and the coverage test has already shown it is the same path.

**Same activity type only**: a route carries the activity type of its canonical
activity, and a track is matched only against routes of its own type. The type is the
effective one the merged view shows: a synced activity retyped by an edit keeps its track
and route rows on the synced row, while the new type lives on its aurboda override, and
matching reads the override's type.

**Retyping re-matches**: when an activity's type changes (an edit, `update_activity`, or a
deduction `retype` rule), every row of it that can own a track is detached from its route
and matched again under the new type, so a walk retyped from a run leaves the running
route. It also stops being its route's canonical, and a route left with no runs is deleted
outright.

**Birth from a pair**: a track that matches no route is tested the same way against the
other non-deleted, unrouted tracks of its type. The first that passes both tests makes a
route whose geometry is the **older** run's simplified track; both runs are attached, in one
transaction with the route's creation. Two matchers racing on the same canonical run (the
unique index on `routes.canonical_activity_id`) leave one route, the loser a no-op. A row
that overlaps the track in time is the same session recorded by another source (Garmin and
Strava), never a second run, so it is not a pairing candidate.

Candidates come from a GiST bbox prefilter (the track's bbox expanded by 0.002°), then one
`ST_Intersection` per candidate on simplified lines. Matching is idempotent: an activity
already in `activity_routes` is skipped.

**Where it runs**: the `track-analyse` queue, ten minutes after a track is written; and the
`track-backfill` job, which after building missing tracks runs the same matching over every
tracked activity without a route that has not been tried yet, oldest first.
`POST /routes/match` / `match_routes` runs that pass on demand. A try marks the activity's
tracks (`activity_tracks.route_matched_at`), so the pass after each deploy skips history that
already failed to pair; a tried run still pairs with a later run of the same course, and the
mark is cleared when the track is rewritten or the activity retyped.

**Naming**: the nearest named location within 500 m of the canonical track's start, else
the first part of the nearest detected location's address, else "Route", followed by the
length: "Söderhallarna · 8.2 km". Renameable.

### Tables

`routes (id, name, activity_type, geom, buffer, length_m, start_pt, end_pt,
canonical_activity_id, …)` and `activity_routes (activity_id, route_id, coverage,
matched_at)`; see [data storage](../data-storage.md). The run count is derived: attached,
non-deleted activities, with rows of one session from several sources counted once. Route
geometry is never shared or federated. Deleting a route only sets its `deleted_at`: its
`activity_routes` rows stay, so its runs count as routed and are never paired into a new
route, and a later run of the same course does not revive it.

### Efforts

A route's runs, newest first, each with `elapsed_s` (end − start), `avg_hr` (the mean
heart-rate sample over the run) and `pace_s_per_km`: from the mean `speed` samples when
there are any, else elapsed time over the activity's recorded `data.distance`, and
`categories` (the run categories on the activity, see phase 3). The route page's
"Low-HR runs only" toggle narrows the trends and the table to the `low_hr` runs, which is
pace at heart rate: the low-HR ceiling is already in the category.

### Surfaces

- REST: `GET /routes` (`activity_type` keeps that type and its descendant types; `sort` is
  `last_run` (default), `runs`, `length` or `alphabetical`), `GET /routes/:id` (with the line and the efforts),
  `PATCH /routes/:id` (rename), `DELETE /routes/:id` (runs are kept and not matched again),
  `POST /routes/:id/merge` (`source_route_id`'s runs move here, the source is deleted),
  `POST /routes/match`; `GET /activities?route_id=` filters to a route's activities, and
  `GET /activities/:id` carries `route: { id, name, activity_count }`.
- MCP: `list_routes` (same `activity_type` and `sort`), `get_route`, `update_route`, `delete_route`, `merge_routes`,
  `match_routes`; `query_activities` takes `route_id`.
- Web: `/routes` (name, type, length, run count, last run; a type filter and a sort order,
  kept in the URL as `?type=&sort=`) and `/routes/:id` (editable
  name, the line on a map, pace and heart-rate trend charts, the runs with links to their
  activities, merge into another route of the same type, delete); the activity page shows
  its route and run count. The Android app embeds both pages (More → Routes).

## Phase 3: run features and categories

Run categories are **structured data on the activity**, not child activity types, so the
type hierarchy stays clean and the activity lists can filter on them.

### Features

`activity_features` holds one row per activity, computed from the stored time series
(`heart_rate` and `speed`, from the activity's own source first) and its track by pure
functions (`services/run-features.ts`). A feature the data cannot support is null.

| Feature                                                                               | Definition                                                                                              | Null when                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `elapsed_s`                                                                           | Seconds from start to end                                                                               | never                                  |
| `moving_s`                                                                            | Seconds with speed above 0.5 m/s                                                                        | never (the elapsed time without speed) |
| `zone0_fraction` … `zone5_fraction`                                                   | Share of the HR-covered time in each HR zone (0–1)                                                      | no HR samples                          |
| `low_hr_fraction`, `low_hr_ceiling_bpm`                                               | Share of the HR-covered time at or below the low-HR ceiling, and that ceiling                           | no HR samples                          |
| `hr_drift_pct`                                                                        | Aerobic decoupling: second-half HR/speed over first-half HR/speed, minus one, in %                      | fewer than 10 HR samples in a half     |
| `pace_cv`                                                                             | Coefficient of variation of the 30 s smoothed moving pace                                               | fewer than 30 moving samples           |
| `interval_count`                                                                      | Work blocks: fast stretches of 30 s–8 min above the run's median moving speed                           | no speed samples                       |
| `work_block_median_s`, `rest_block_median_s`, `work_block_cv`, `work_rest_pace_ratio` | Median work and rest block durations, the work blocks' duration CV, median rest pace ÷ median work pace | too few blocks                         |
| `elevation_gain_m`                                                                    | Total climb from the track altitude (5-point smoothing, 3 m hysteresis)                                 | no track                               |
| `elevation_oscillation`                                                               | Climb plus descent in metres per km of track                                                            | no track                               |
| `duration_vs_median_90d`                                                              | Elapsed time ÷ the median of the same type (and subtypes) over the 90 days before                       | no earlier activities of the type      |

The **low-HR ceiling** is the `maf_hr` setting when set (180 − age with the Maffetone
adjustments, entered by hand), else the start of HR zone 3, the zone-2 upper bound.

Features are computed:

- in the `track-analyse` job, right after the route match, for every written track;
- by the `track-backfill` job, after its route matching, for every tracked activity that
  has no features yet (that is how history gets them);
- again for all activities when HR zones, the birth date or `maf_hr` are set or cleared:
  the settings update deletes the user's features and queues the backfill.

Each computation then makes sure the default run category rules exist and fires the
activity notifier for the activity's span (the backfill: one notification over all the
activities it computed), so the deduction queue re-evaluates the categorising rules.

### Categories

`data.run_categories` is a list of `{ category, reasons, rule_id? }`. An enrich rule with
an `output_category` adds its entry with `rule_id` and the conditions that matched as
`reasons`, and drops it when the run no longer matches; an entry without `rule_id` was set
by hand and no rule touches it. `data.run_categories_excluded` lists the categories the
user removed: a rule does not add those back. The rules, their feature conditions and the
seeded defaults (`low_hr`, `intervals`, `long`, `tempo`, `hard`) are described in
[deduction rules](./deduction-rules.md); the user retunes or deletes them there, and a
deleted default is not seeded again.

### Surfaces

- REST: `GET /activities?category=` and `GET /activity-types/:name/sessions?category=`
  keep the activities carrying that category; `GET /activities/:id` (and `/full`) carries
  `features` when the activity has been analysed; `GET /routes/:id` efforts carry
  `categories`.
- MCP: `query_activities` and `query_activity_sessions` take `category`;
  `get_activity_detail` carries `features`; `get_route` efforts carry `categories`.
- Web: the activity page shows the categories as chips under the route line on runs (and on
  any activity that has some): hovering a chip, or opening "Why", shows the reasons; "×"
  removes one (a rule's category is also added to `run_categories_excluded`), and the text
  field adds one by hand (snake_case, Enter). A collapsed "Run features" block lists the
  features. The route page has the "Low-HR runs only" toggle. The Android app embeds both.

Left out for now: a cadence tie-breaker for intervals and using Garmin's recorded laps as
work blocks.

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
