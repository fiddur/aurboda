# Timeline

The Timeline is Aurboda's flagship visualization: a full-screen, interactive view that overlays your entire day -- activities, tags, heart rate, screen time, music, location, and more -- on a single scrollable chart. It answers the question "what was I doing, and how was my body responding?" at any point in time. Open it from **Timeline** in the sidebar; it fills in from whatever sources you have connected (see [What Data It Needs](#what-data-it-needs)).

## Two Orientations

The Timeline has two layouts, each suited to different screen shapes and use cases.

### Vertical (portrait)

Time flows top-to-bottom. Data tracks appear as side-by-side columns: **Activity**, **Location**, **Music** (a narrow strip, when you have scrobbles), **Metrics**, and **Comments** (rightmost, when there are any). The Metrics column carries the same content as the horizontal Metrics lane turned on its side: heart rate and HRV ribbons, stress, steps, calories and screen time bars, with values growing to the right. This layout works well on phones and when you want a detailed view of a single day.

### Horizontal (landscape)

Time flows left-to-right. Data tracks are stacked as horizontal swim lanes: **Comments** (top), **Music**, **Activity**, **Metrics**, and **Location** (bottom). The Metrics lane shows heart rate and HRV as ribbon charts, plus steps, calories, training load, and screen time as bar charts. This layout works well on desktop screens and when viewing multi-day ranges or analyzing metric trends alongside activities.

Both layouts draw the same data with the same legend toggles. What only the horizontal layout has is the **training load** curves, the **sheet-music staff** for music (vertically, music sessions are plain strips) and **screen time blocks** in the Activity lane (vertically, screen time is the Metrics bars alone).

The default orientation is chosen based on screen aspect ratio, but you can switch at any time with the orientation toggle button. Your choice is preserved in the URL.

## Data Tracks

### Activities

Displays sleep sessions, exercises, meditation, naps, rest periods, and promoted duration tags (e.g., "Sauna", "Hot Bath") as colored blocks.

- **Sleep** appears in blue, **naps** in light blue, **rest** in light green, **meditation** in purple.
- **Exercises** are colored by their dominant heart rate zone: green for easy (zones 0-1), blue for aerobic (zone 2), amber/orange for threshold (zones 3-4), and red for max effort (zone 5).
- **Duration tags** like "Sauna" or "Breathwork" appear as amber blocks (or with tag-specific colors).
- Each block can display an **icon** -- an emoji or image you assign in Tag Mappings or Timeline Icons settings.

When you hover over an activity, the tooltip shows duration and relevant details: for sleep, you see Oura sleep scores (efficiency, restfulness, deep, REM); for exercise, you see an HR zone distribution bar; for any activity, you see music that was playing at the time.

Tags that overlap significantly with an activity (e.g., an "Holosync" tag during a meditation session) are merged into one block to avoid clutter.

When items overlap in time, the Timeline automatically packs them into parallel lanes so everything remains visible.

Meals you log appear in the Activity track as icons at the meal's time: the icons of its food items, or 🍽️. Clicking one opens the meal.

**Data sources:** Oura, Garmin, Strava, Gravl, Health Connect, calendars, manual entry, promoted tags, meals.

### Location

Shows named place visits as colored blocks. Each place gets a consistent color from a rotating palette. Unnamed gaps appear as gray "Travel" or "Unknown" blocks. Hovering shows the place name, time range, and duration. Clicking a place opens the Places page for that date and location.

**Data source:** OwnTracks or Home Assistant.

### Screen Time

In both layouts, screen time appears as stacked bars in the Metrics track, bucketed by hour, day or week depending on zoom level. Each stack segment is colored by its top-level screentime category. Hovering shows a breakdown with subcategory details.

In **horizontal mode**, screen time is also drawn as blocks in the Activity lane. Each block represents time spent in a category, colored by your screentime category configuration (or by productivity score: green for productive, gray for neutral, red for distracting). Adjacent records in the same category are merged to reduce visual noise. Hovering shows the category hierarchy and total duration. The vertical layout has no screen time blocks.

**Data sources:** RescueTime, ActivityWatch.

### Music

Scrobbles are merged into listening sessions in both layouts; how close two tracks must be to share a session follows the zoom level.

In **vertical mode**, each session is a pink strip in a narrow Music column spanning the session's time, labelled with its number of tracks when there is room. Hovering or tapping it shows the track list.

In **horizontal mode**, sessions are rendered as a whimsical sheet-music staff notation -- complete with a treble clef, barlines, and musical notes that follow a melody pattern. When zoomed far out, sessions simplify to pink bars. Hovering shows the full track listing.

The music track only appears when you have Last.fm configured.

**Data source:** Last.fm.

### Heart Rate and HRV

These appear as ribbon charts in the Metrics track:

- **Heart rate** as a red band showing the average with a min-max area fill (range 40-200 bpm).
- **HRV** as a green/teal band with a dynamic range.

Hovering in the Metrics track shows a crosshair with exact values at that moment, across the track in the vertical layout.

**Data sources:** Oura, Garmin, Health Connect.

### Steps and Calories

Gray bar charts for steps and amber bar charts for active calories appear in the Metrics track, behind the HR/HRV ribbon charts. Bucket size adapts to zoom level.

**Data sources:** Garmin, Health Connect.

### Daily Metrics (horizontal mode, more than three days)

When the view spans more than three days (Week, Month, or a zoom of that size) in the horizontal
layout, the Metrics lane gets one thin row per picked daily metric under its own content, which
shrinks to make room. Each row has one dot per local day, joined by a line, on the row's own
min/max scale, with the metric's name at the left edge; the value is printed at each dot when a
day is wider than about 40 px, and hovering a day shows the date and value.

The pickable metrics, in this order:

| Metric     | Daily value                                                                            |
| ---------- | -------------------------------------------------------------------------------------- |
| Resting HR | Mean of `resting_heart_rate`                                                           |
| Sleep      | Time asleep in the `sleep` activities ending that day, overlapping nights counted once |
| HRV        | Mean of `hrv_rmssd`                                                                    |
| Steps      | Sum of `steps`                                                                         |
| Weight     | Mean of `weight`                                                                       |

Pick them under **Daily** in the legend, which shows while the daily rows can be drawn. The pick is
saved per user in the `timeline_daily_metrics` setting (an array of `resting_heart_rate`,
`sleep_duration`, `hrv_rmssd`, `steps`, `weight`; default `["resting_heart_rate"]`, `null` resets
it), so it is also readable and writable with `GET`/`PATCH /user/settings` and the MCP
`get_user_settings` / `update_user_settings` tools. Hiding the Metrics lane hides the rows too. The
vertical layout has no daily rows.

### Training Load (horizontal mode)

Shows your fitness and fatigue trajectory using the Banister model:

- **Impulse bars** show per-session training stress: TRIMP (purple) from heart rate data and activity impulse (light blue) from active calories.
- **CTL (fitness) curve** in blue: your long-term training adaptation. Dashed during the bootstrapping period (first ~6 weeks).
- **TSB (form) line**: green when fresh (positive), red when fatigued (negative), with a zero reference line.
- **Recovery zone bands** appear as subtle colored backgrounds once enough data accumulates: blue for undertrained, green for balanced, orange for strained, red for very strained.

Hovering shows fitness (CTL), fatigue (ATL), form (TSB), impulse values, recovery zone, and details of nearby workouts (title, duration, TRIMP, average HR).

**Data source:** Computed from exercise activities and daily activity metrics.

### Comments

Every [comment](./comments.md) anchored in the visible window gets a 💬 bubble on
the Timeline, so a remark sits next to the data it is about. A comment on a run
shows at the run's time, right beside the run; a comment on a bare moment shows
wherever you put it. Replies never get a bubble of their own -- they ride along
inside their thread. A comment on a deleted activity or productivity record has
no bubble until the record is restored.

In **vertical mode** the comments are a column of their own, rightmost, when the window has any. In
**horizontal mode** they get a thin lane at the very top, above Music: one 💬
glyph centred on the comment's start, with a slim bar underneath when the comment
covers a span rather than a moment.

**Clicking a bubble** opens the comment panel: the whole thread, with Edit,
Delete and a reply box. A comment that hangs off something links back to it, so
you can get from the remark to the run it is about in one click. A comment about
a bare moment can be moved -- its start and end times are editable right in the
panel. Comments that arrived from a data source (Oura, Health Connect) show a
source badge and cannot be edited here: the next sync would overwrite them. They
can still be replied to and deleted. Press **Escape** or click outside to close
the panel.

**Right-click** anywhere on the chart (or **long-press** on touch) to act on the
moment under the pointer:

- **💬 Add comment** -- opens the panel with an empty comment anchored at that
  moment, with editable start and optional end times.
- **Add activity** / **Add metric** -- jumps to the Add Data page with that tab
  selected and the time already filled in.

Press **Escape**, scroll, or click elsewhere to dismiss the menu.

**Data sources:** Manual comments, Oura, Health Connect.

## Navigation

### Zoom and Pan

- **Scroll wheel / pinch** to zoom in and out on the time axis.
- **Click and drag** to pan forward and backward in time.
- **Double-click** to reset the view to today.
- Data loads automatically as you pan or zoom beyond the current window.

### Time Navigation Buttons

- **Day / Week / Month** show the local day, the Monday-to-Sunday week, or the calendar month that
  contains the middle of the current view. Week and Month switch to the horizontal layout (you can
  switch back by hand); Day keeps the layout. The highlighted button follows the view in the URL:
  a range within a few minutes of a day, week or month lights that button, a free zoom lights none.
- **<** / **>** step by the highlighted range: a day, a week or a month. A free zoom steps one day.
  They do not step into the future.
- **<<** / **>>** jump 30 days.
- **Today** keeps the highlighted Week or Month and moves it to the one that contains now;
  otherwise it resets to the current day.
- The date label shows the current visible range (e.g., "Mar 19, 2026", "Mar 15 -- Mar 19, 2026" or
  "March 2026").

### Fullscreen

The fullscreen button expands the timeline to cover the entire viewport (hiding the navigation bar). Press **Escape** to exit.

### Refresh

The refresh button reloads all data for the current view. Useful after adding new data or syncing a source.

## Legend and Filters

A legend bar below the controls lets you toggle individual data tracks on and off. There are five top-level toggles (Music, Activity, Metrics, Location, Comments) and sub-toggles within Activity and Metrics. Over more than three days in the horizontal layout a **Daily** group of checkboxes picks the [daily metric rows](#daily-metrics-horizontal-mode-more-than-three-days); that pick is a saved setting, not part of the URL.

### Activity sub-toggles

Sleep / Nap / Rest, Meditation, Exercise, Other, Calendar, and in the horizontal layout Screen Time with one toggle per top-level screen-time category, for the screen time blocks.

### Metrics sub-toggles

HR, HRV, Stress, Steps, Calories, Training Load (shown in the horizontal layout only), Screen Time (the stacked bars, in both layouts). A link that hides the screen time blocks (`hide=screentime` or `hide=screentime:<category>`) keeps that setting; it has no effect in the vertical layout, which has no blocks.

Hiding a track prevents its data from being fetched (saving bandwidth and load time). Hidden items appear with strikethrough text in the legend. The legend auto-collapses to a single line on narrow screens, showing "Legend (N hidden)" when tracks are filtered.

## Now Line

A red dashed line labeled "Now" marks the current time when it falls within the visible range.

## Adaptive Detail

The Timeline automatically adjusts detail level as you zoom:

- **Zoomed in** (hours): Fine-grained 5-minute metric buckets, short music sessions, per-category screen time blocks and hourly screen time bars.
- **Zoomed out** (days): Coarser metric buckets, longer music sessions, merged screentime categories and daily bars.
- **Far out** (weeks/months): Daily or weekly buckets, simplified visualizations, small items merged into cluster labels ("5 Activity").

Time labels and date separators also adapt: from hourly labels at full zoom to daily, then weekly/monthly separators when viewing long ranges.

### Bar Merging

Adjacent activities of the same type merge into one bar when the gap between them is too small to be worth drawing. The threshold follows the zoom level, counted in **calendar-day boundaries crossed** rather than elapsed hours -- so an Aug 1 00:00 → Aug 3 23:59 view (2 boundaries) takes the pixel tier while Aug 1 00:00 → Aug 4 00:00 (3 boundaries) takes the hour tier, despite both spanning ~72h:

| View span                       | Gap bridged                                          |
| ------------------------------- | ---------------------------------------------------- |
| Crosses more than 50 boundaries | 4 hours                                              |
| Crosses 3 to 50 boundaries      | 1 hour                                               |
| Crosses 2 or fewer boundaries   | Whatever spans ~7 px on screen, capped at 10 minutes |

In that last tier the threshold is measured in pixels, not minutes, so **zooming in always pulls separate sessions apart** -- two yoga sessions nine minutes apart read as one bar in the day view and as two once you zoom in. This matters because a merged bar links to its _first_ member only: to open the second session, zoom in until the bar splits. Two activities that touch exactly -- one ending at the moment the next begins -- follow the same rule: the coarser tiers merge them, and in the pixel tier the Activity lane keeps them apart, so zooming in to a view crossing 2 or fewer boundaries always splits them. That holds when both are whole sessions -- entered in Aurboda or by hand, or synced from Garmin, Strava, Oura, Gravl or a calendar -- which the API returns as two activities. Rows from sources that record in fragments (Health Connect, deduction rules, screen time, location, music) are joined across an exact touch by the API itself, so they read as one activity at every zoom level ([#1488](https://github.com/fiddur/aurboda/issues/1488)). Overlapping activities of the same type still merge at every zoom level. A merged bar's tooltip names its members with counts ("Merged: Yoga ×2"), so you can tell when there is more inside than the bar suggests.

That count is an Activity-lane signal only. For the horizontal screen time blocks a count would tally raw sampling spans rather than sessions, and the block links to its category rather than to a member, so a block collapsed from sub-categories lists their names without counts ("Merged: Programming, Communications"), and a merged top-level block, whose only member is its own category, shows no "Merged" line at all. Screen time blocks also merge exactly touching spans at every zoom level: contiguous sampling spans are one stretch of screen time.

Different activity types never merge with each other, regardless of zoom. When zoomed out far enough, sub-types instead collapse into their `parent_type` (so running + strength read as one "Exercise" bar) -- see [activity types](./activity-types.md).

## URL Persistence

The current view state is encoded in the URL hash:

```
#from=2026-02-27T06:00&to=2026-02-27T18:00&hide=sleep_rest,music&o=h
```

This includes the visible time window, hidden tracks, and orientation override. You can bookmark or share a specific timeline view and it will restore exactly.

## Click-Through

Clicking an item navigates to its detail page where you can view full details, edit, add notes, or delete. Activity blocks, including what you logged yourself, go to the Activity Detail page; meals go to the meal; productivity records go to Productivity Detail. Location blocks link to the Places page for that date.

## What Data It Needs

The Timeline is most useful when multiple data sources are connected. At minimum, you need at least one source of activities (Oura, Garmin, Strava or Health Connect), or the things you log yourself. Each additional source adds a layer:

| To see...       | Connect...                             |
| --------------- | -------------------------------------- |
| Sleep & HRV     | Oura, Garmin, or Health Connect        |
| Exercise & HR   | Oura, Garmin, Strava or Health Connect |
| Location        | OwnTracks or Home Assistant            |
| Screen time     | RescueTime or ActivityWatch            |
| Music           | Last.fm                                |
| Calendar events | Any ICS calendar URL                   |
| Meals           | Log them, or import from Cronometer    |
| Training load   | Automatic (computed from exercises)    |

## Known Limitations

- **Music notation** in horizontal mode uses a fixed melody pattern for all sessions (purely decorative; the notes don't represent the actual music).
- **Screen time blocks** in horizontal mode can be visually dense with many apps. The category system helps, but highly fragmented usage still creates many small blocks.
- **Training load** requires approximately 6 weeks of exercise data before the fitness curve becomes reliable (shown as dashed during the bootstrapping period).
- **Location track** requires OwnTracks or Home Assistant with continuous GPS logging. Gaps in logging appear as gaps in the track.
