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
| 4     | Segments: manual, timed efforts, suggestions        | shipped (#1234) |
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
  the backfill is the same extractor over stored data: full resolution. An activity synced
  from its FIT file keeps only a summary (`garmin_activity_fit`) and is no candidate: its
  track was written when the file was read.
- **Strava** keeps the detailed activity (`strava_activity`) with `map.polyline`, a shape
  with no timestamps — streams were never stored. The backfill decodes it and spreads M
  evenly over the elapsed time, flagged `full_resolution = false`: good enough for route
  matching and segment suggestion; segment efforts timed on it are flagged `approximate`.

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
auto-share). Route matching (phase 2) runs there, then the activity's features (phase 3), then
segment timing and segment suggestion (phase 4). Strava ingest now also fires the
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

| Feature                                                                               | Definition                                                                                                                                                          | Null when                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `elapsed_s`                                                                           | Seconds from start to end                                                                                                                                           | never                                  |
| `moving_s`                                                                            | Seconds with speed above 0.5 m/s                                                                                                                                    | never (the elapsed time without speed) |
| `zone0_fraction` … `zone5_fraction`                                                   | Share of the HR-covered time in each HR zone (0–1)                                                                                                                  | no HR samples                          |
| `low_hr_fraction`, `low_hr_ceiling_bpm`                                               | Share of the HR-covered time at or below the low-HR ceiling, and that ceiling                                                                                       | no HR samples                          |
| `hr_drift_pct`                                                                        | Aerobic decoupling: second-half HR/speed over first-half HR/speed, minus one, in %                                                                                  | fewer than 10 HR samples in a half     |
| `pace_cv`                                                                             | Coefficient of variation of the 30 s smoothed pace over the samples at or above 1.5 m/s (walking and stops left out, so a jog-walk does not read as erratic pacing) | fewer than 30 such samples             |
| `interval_count`                                                                      | Work blocks: fast stretches of 30 s–8 min above the run's median moving speed                                                                                       | no speed samples                       |
| `work_block_median_s`, `rest_block_median_s`, `work_block_cv`, `work_rest_pace_ratio` | Median work and rest block durations, the work blocks' duration CV, median rest pace ÷ median work pace                                                             | too few blocks                         |
| `elevation_gain_m`                                                                    | Total climb from the track altitude (5-point smoothing, 3 m hysteresis)                                                                                             | no track                               |
| `elevation_oscillation`                                                               | Climb plus descent in metres per km of track                                                                                                                        | no track                               |
| `duration_vs_median_90d`                                                              | Elapsed time ÷ the median of the same type (and subtypes) over the 90 days before                                                                                   | no earlier activities of the type      |

The **low-HR ceiling** is the `maf_hr` setting when set (180 − age with the Maffetone
adjustments, entered by hand), else the start of HR zone 3, the zone-2 upper bound.

Features are computed:

- in the `track-analyse` job, right after the route match, for every written track;
- by the `track-backfill` job, after its route matching, for every tracked activity that
  has no features yet (that is how history gets them);
- again for all activities when a settings update changes the effective HR zones (custom
  zones, or the age-based ones from the birth date) or the low-HR ceiling (`maf_hr`): it
  queues a backfill job flagged `recompute_features`, which deletes the user's features
  before computing them, so a failed enqueue loses nothing;
- again for an activity whose shown type changes: a retype (with its route re-matched as
  well), and the delete or restore of an override whose type differs from its targets'
  (the targets are re-matched and recomputed). This happens before the edit's
  notifications, so the rules they re-evaluate read the new features.

Each computation then makes sure the default run category rules exist (they are seeded for
`running` and its subtypes only) and fires the activity notifier, so the deduction queue
re-evaluates the categorising rules: the analyse job over the activity's own span, the
backfill once per window of at most 30 days of the activities it computed, so a long history
neither queues one job per run nor one window spanning years. The analyse job runs every
step even when one fails and then fails as a whole, so pg-boss retries it (each step is
idempotent).

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
  any activity that has some), one chip per name: hovering a chip, or opening "Why", shows
  the reasons; "×" removes every entry of that name (when one came from a rule, the name is
  also added to `run_categories_excluded`), and the text field adds one by hand (snake_case,
  Enter). A chip edit is an ordinary activity edit: on a synced activity it creates the
  override (or updates the existing one) and the page moves to it; in a merged group that
  already has a native aurboda row, the chips edit that row only. A collapsed "Run features"
  block lists the features. The route page has the "Low-HR runs only" toggle. The Android
  app embeds both.
- The category filter and the route efforts read the categories the merged view shows: a
  synced row with an override is judged by the override's `run_categories`, and both rows
  stay in the merged result.

Left out for now: a cadence tie-breaker for intervals and using Garmin's recorded laps as
work blocks.

## Phase 4: segments

A segment is a stretch timed on every pass: a hill, a bridge, a sprint straight. It is cut by
hand from a track or a route, or added from a suggestion.

### Creation

`POST /segments` / `create_segment` takes one of two cuts:

- **From an activity**: `activity_id`, `start_offset_s`, `end_offset_s`, seconds since the
  activity's start (the `t` of `GET /activities/:id/track`). The line is the part of the
  activity's preferred track (the one the track read returns) between those M values
  (`ST_LocateBetween`), simplified at about 3 m.
- **From a route**: `route_id`, `start_km`, `end_km`. The line is `ST_LineSubstring` of the
  route between those distances, with the fractions taken in Web Mercator so they are
  distances in metres, not degrees. An end up to 50 m past the route's length (a rounded
  length) is clamped to the end.

It is refused (400, with the reason) when shorter than 100 m, when its start and end are less
than 50 m apart (twice the buffer: a point near the end of a near-closed loop projects onto its
first edge, so no pass would ever be timed), when an offset falls outside the
track or the km range outside the route, for an activity without a track, and for a missing or
deleted route. The segment takes the effective type of the activity or route it was cut from,
and the name, unless one is given, of the nearest named location within 500 m of its start,
else "Segment", then the length: "Hammarbybacken · 0.8 km". Every tracked activity of the type
is timed on it before the response, which is the new segment with its efforts.

### Matching

**Same activity type only**, and the same effective type route matching reads (an override's
retype wins). The match is exact: a `running` segment does not time a `trail_running`
activity, although the segment list's type filter includes descendant types. A track is a candidate for a segment when their bboxes meet (the track's
expanded by 0.002°) and the segment is covered by the track:

```
ST_Length(ST_Intersection(S.geom, ST_Buffer(T.simplified, 25 m))) / S.length_m >= 0.9
```

measured on the geography, with the track clipped to near the segment before it is buffered.
Coverage ignores direction; timing does not.

Each track of an activity (one per source) is timed on its own. Writing is idempotent: the
activity's (or the segment's) efforts are replaced in one transaction.

**Where it runs**: the `track-analyse` job, after routes and features, against every segment
for the written track (an activity that no longer covers a segment loses its efforts there);
the `track-backfill` job, after its route matching, and `POST /tracks/backfill` /
`backfill_activity_tracks`, for every track they wrote (both skip it when the user has no
segments); at creation
against every track; `POST /segments/:id/match` / `match_segment` repeats that on
demand; and a retype drops the activity's efforts and times its tracks again under the new
type, next to the route re-match.

### Timing

Pure TypeScript on the track's full-resolution points (`services/segment-timing.ts`). Each
point is projected onto the segment (a local equirectangular frame): its distance to the line
and its position along it, negative before the start and past the length after the end. A
pass enters where the position crosses 0 (the latest crossing, so waiting at the start does
not count) and stays within 25 m, never stepping back more than 30 m (GPS jitter), until the
position crosses the segment length; both crossings are interpolated between the samples that
straddle them. A pass that turns off within 10 m of the end still counts, ending where it got
furthest. A track that starts or ends inside the segment, leaves the buffer midway or runs it
backwards gives no pass; every complete pass is an effort, so hill repeats give several.

Each effort stores `start_offset_s`, `elapsed_s`, `avg_hr` (the mean heart-rate sample over the
effort's window, read like a route run's) and `pace_s_per_km` (elapsed time over the segment
length). A polyline-only Strava backfill is timed too, from its evenly spread M, and flagged
`approximate`.

### Efforts

A segment's efforts are listed newest first. Passes of one session recorded by two sources
(the Garmin and Strava rows, or two tracks of one row, overlapping in time) are listed once,
the non-approximate one kept, else the earliest activity. `is_best` marks the fastest
non-approximate effort (the fastest of all when every one is approximate), and `rank` orders
them the same way (1 = the best effort): non-approximate efforts by elapsed time, then the
approximate ones, so a shape-only pass never ranks ahead of a timed one.

### Tables

`segments (id, name, activity_type, geom, buffer, length_m, created_from_activity_id,
created_from_route_id, …)` and `segment_efforts (segment_id, activity_id, source,
start_offset_s, elapsed_s, avg_hr, pace_s_per_km, approximate, matched_at)`; see
[data storage](../data-storage.md). A segment is deleted outright and its efforts cascade.

### Surfaces

- REST: `GET /segments` (`activity_type` keeps that type and its descendant types; `sort` is
  `last_effort` (default), `efforts`, `length` or `alphabetical`), `POST /segments`,
  `GET /segments/:id` (the line, `near_named_location`, the efforts, and
  `created_from_activity_title` / `created_from_route_name`: the title of the activity or the
  name of the route it was cut from, resolved when read, null once that is deleted), `PATCH /segments/:id`
  (rename), `DELETE /segments/:id`, `POST /segments/:id/match`; `GET /activities/:id`, `/full`
  carry `segment_efforts: [{ segment_id, segment_name, start_offset_s, elapsed_s, avg_hr,
pace_s_per_km, approximate, is_best, rank }]` in time order, absent when there are none.
- MCP: `list_segments`, `get_segment`, `create_segment`, `update_segment`, `delete_segment`,
  `match_segment`; `get_activity_detail` carries `segment_efforts`.
- Web: the activity page lists the activity's efforts under its route: the segment's name
  (a link to its page), time, pace, average heart rate, a "best" mark and "approximate" in
  muted text. `/segments` lists the segments (type filter; sort by latest effort, most
  efforts, length or name) with type, length, effort count, best time and the latest
  effort's date. `/segments/:id` shows the line on a map, the type, length, effort count
  and best time, a rename field, the elapsed time over the efforts (approximate ones left
  out when there are timed ones), the efforts newest first (date linking to the activity,
  time, pace, average heart rate, "★ best", "approximate"), the activity or route it was
  cut from (by its title or name, else "an activity" / "a route"), "Time again" (`POST /segments/:id/match`) and Delete. `near_named_location`
  is not shown until sharing exists.
- Creating a segment in the web: on an activity with a stored track (not the raw-GPS
  fallback the map uses without one), "Create segment" under the map opens two sliders,
  Start and End, over the track's `t` (1 s steps, kept at least 1 s apart); the stretch is
  drawn over the map in the accent colour, with its length and duration, an optional
  name, Create and Cancel. On a route page the same panel takes "From km" and "To km"
  (0.1 km steps). Create is disabled under 100 m (the server's rule, mirrored in
  `apps/web/src/utils/segmentCut.ts`) and a refusal from the server is shown as it is
  worded; a created segment opens its page. The Routes and Segments lists link to each
  other, Segments is in the web navigation after Routes, and the Android app's More hub
  embeds `/segments`.
- **Privacy**: the create and get responses carry `near_named_location: { start, end }`, the
  named location within 500 m of each end, for the warning segment sharing (phase 5) will show.
  Nothing about segments is shared yet.

### Suggested segments

"The parts I run often with different start and end." When at least three different activities
of one type pass the same stretch in the same direction without being on the same route, Aurboda
suggests that stretch as a segment, to add (optionally trimmed and named) or dismiss. Leaving out
pairs on the same route is the point: it surfaces the hill shared by different routes instead of
proposing every route again.

**Finding stretches** (`services/segment-suggest.ts`, pure TypeScript on the simplified tracks).
For a track A, the candidates are one preferred track of each other non-deleted activity of the
same effective type whose bbox meets A's, that does not overlap A in time (the other source's row
of the same run) and is not on A's route; newest first, at most 150. Rows of one session
(overlapping in time) count once. A is densified to a point at least every 15 m; a point is
_near_ B when an edge of B lies within 20 m of it **and** points the same way (a positive dot
product with A's local heading), so a reversed B never matches and an out-and-back B only on its
leg in A's direction. Non-near gaps of up to 40 m are bridged (GPS noise) and runs under 400 m
dropped. B's edges are indexed in a 50 m grid, so the cost is linear in A's points.

The runs, all in metres along A, are clustered longest first: a candidate's supporters are the
activities whose run covers at least 80 % of it, at least two are needed (three activities with
A), and it is trimmed to its longest part covered by 80 % of its supporters. A stretch overlapping
an accepted one by 80 % (of the longer) is the same stretch. At most three are kept per track,
those passed by the most activities first. A stretch whose ends are less than 50 m apart is
dropped, as it could not be timed.

**Storing**: a stretch similar to a stored one (same type, each line at least 80 % inside the
other's 25 m buffer, same direction) is not stored again: a similar segment, or a dismissed or
promoted suggestion, keeps it out (so a dismissed stretch stays dismissed, also after the segment
made from it is deleted); a similar pending one takes the larger activity count. Merging an
activity type moves its suggestions with it; deleting one deletes them, pending and decided.
Promoting claims the suggestion first (it is marked promoted before the segment is made, and
made pending again when no segment comes of it or linking it to its segment fails, in which case
the segment just made is deleted first), so two
promotes of it make one segment. A claim left without a segment for more than ten minutes (the
process died in between) is made pending again by the next list or promote.

**Where it runs**: the `track-analyse` job, after segment timing (a fourth step); the
`track-backfill` job, one time-limited run (20 s) over tracked activities not looked at yet,
newest first, after its route matching; and on demand. A look marks the activity's tracks
(`activity_tracks.segments_suggested_at`), cleared when a track is rewritten.

**Adding**: the line (trimmed to `start_km`–`end_km` along it, cut like a route) goes through
exactly what creating a segment does (the 100 m and 50 m rules, the name from the nearest place,
timing every tracked activity of the type); the segment records the suggestion's source
activity as `created_from_activity_id`, and the suggestion becomes `promoted`.

**Scale**: pairwise, against at most 150 candidates per track. Someone with tens of thousands of
tracks in one area would want a cell index (H3) of the tracks instead; that is the next step if
it is ever needed.

**Surfaces**:

- REST: `GET /segments/suggested` (pending, most activities first, then longest, with the line
  and `near_name`, the named location within 500 m of the start),
  `POST /segments/suggested/scan` (`{ scanned, suggested, remaining }`; run again while
  `remaining > 0`), `POST /segments/suggested/:id/promote` (`name?`, `start_km?` and `end_km?`
  together; the new segment, 400 with the reason, 404 when not pending) and
  `POST /segments/suggested/:id/dismiss`.
- MCP: `list_suggested_segments`, `promote_suggested_segment`, `dismiss_suggested_segment`,
  `scan_suggested_segments`.
- Web: `/segments` shows a "Suggested" section above the list when there are pending
  suggestions, one card each with a small map, "1.2 km · Running · passed on 5 activities ·
  near <place>", "Add as segment" (a panel with a name, "From km" and "To km", the chosen part
  highlighted on the map, Create and Cancel; it opens the new segment's page) and "Dismiss".
  Under the list, "Look for stretches I pass often" runs the scan until nothing is left and says
  how many activities it looked through and how many suggestions it found. The Android app
  embeds the page.

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
