# Timeline

The Timeline is Aurboda's flagship visualization: a full-screen, interactive view that overlays your entire day -- activities, tags, heart rate, screen time, music, location, and more -- on a single scrollable chart. It answers the question "what was I doing, and how was my body responding?" at any point in time.

## Two Orientations

The Timeline has two layouts, each suited to different screen shapes and use cases.

### Vertical (portrait)

Time flows top-to-bottom. Data tracks appear as side-by-side columns: **Activity**, **Location**, **Tags / Events**, **Screen Time**, and **Music**. Heart rate and HRV appear as sparkline overlays inside activity blocks (sleep, exercise, meditation). This layout works well on phones and when you want a detailed view of a single day.

### Horizontal (landscape)

Time flows left-to-right. Data tracks are stacked as horizontal swim lanes: **Music** (top), **Activity**, **Metrics**, and **Location** (bottom). The Metrics lane shows heart rate and HRV as ribbon charts, plus steps, calories, training load, and screen time as bar charts. This layout works well on desktop screens and when viewing multi-day ranges or analyzing metric trends alongside activities.

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

**Data sources:** Oura, Garmin, Health Connect, manual entry, promoted tags.

### Location

Shows named place visits as colored blocks. Each place gets a consistent color from a rotating palette. Unnamed gaps appear as gray "Travel" or "Unknown" blocks. Hovering shows the place name, time range, and duration. Clicking a place opens the Places page for that date and location.

**Data source:** OwnTracks.

### Tags and Events (vertical mode)

Point-in-time events appear as diamond markers (or configured icons) with a label. Duration events appear as short blocks. Different sources are color-coded: manual tags in purple, calendar events in amber, Last.fm auto-tags in pink, and occasional metric measurements in teal.

Sparse metrics -- things you measure infrequently like weight or blood glucose -- show up as teal markers with the value displayed (e.g., "Weight: 82.5 kg").

**Data sources:** Manual tags, Oura tags, calendar imports (ICS), Last.fm auto-tags, any infrequently-recorded metric.

### Screen Time

In **vertical mode**, screen time appears as its own column. Each block represents time spent in an app or category, colored by your screentime category configuration (or by productivity score: green for productive, gray for neutral, red for distracting). Adjacent records in the same category are merged to reduce visual noise. Hovering shows the category hierarchy, constituent apps, and total duration.

In **horizontal mode**, screen time appears as stacked bar charts in the Metrics lane, bucketed by hour or day depending on zoom level. Each stack segment is colored by top-level category. Hovering shows a breakdown with subcategory details.

**Data sources:** RescueTime, ActivityWatch.

### Music

In **vertical mode**, individual scrobbles appear as blocks showing "Artist -- Track" in pink.

In **horizontal mode**, scrobbles are merged into listening sessions and rendered as a whimsical sheet-music staff notation -- complete with a treble clef, barlines, and musical notes that follow a melody pattern. When zoomed far out, sessions simplify to pink bars. Hovering shows the full track listing.

The music track only appears when you have Last.fm configured.

**Data source:** Last.fm.

### Heart Rate and HRV

In **horizontal mode**, these appear as ribbon charts in the Metrics lane:
- **Heart rate** as a red band showing the average with a min-max area fill (range 40-200 bpm).
- **HRV** as a green/teal band with a dynamic range.

In **vertical mode**, HR and HRV appear as **sparklines overlaid inside activity blocks**. Each sleep session, exercise, or meditation block gets a small inline chart showing how your heart rate and HRV varied during that activity.

Hovering in the Metrics lane shows a crosshair with exact values at that moment.

**Data sources:** Oura, Garmin, Health Connect.

### Steps and Calories (horizontal mode)

Gray bar charts for steps and amber bar charts for active calories appear in the Metrics lane, behind the HR/HRV ribbon charts. Bucket size adapts to zoom level.

**Data sources:** Garmin, Health Connect.

### Training Load (horizontal mode)

Shows your fitness and fatigue trajectory using the Banister model:

- **Impulse bars** show per-session training stress: TRIMP (purple) from heart rate data and activity impulse (light blue) from active calories.
- **CTL (fitness) curve** in blue: your long-term training adaptation. Dashed during the bootstrapping period (first ~6 weeks).
- **TSB (form) line**: green when fresh (positive), red when fatigued (negative), with a zero reference line.
- **Recovery zone bands** appear as subtle colored backgrounds once enough data accumulates: blue for undertrained, green for balanced, orange for strained, red for very strained.

Hovering shows fitness (CTL), fatigue (ATL), form (TSB), impulse values, recovery zone, and details of nearby workouts (title, duration, TRIMP, average HR).

**Data source:** Computed from exercise activities and daily activity metrics.

## Navigation

### Zoom and Pan

- **Scroll wheel / pinch** to zoom in and out on the time axis.
- **Click and drag** to pan forward and backward in time.
- **Double-click** to reset the view to today.
- Data loads automatically as you pan or zoom beyond the current window.

### Time Navigation Buttons

- **<** / **>** jump one day backward / forward.
- **<<** / **>>** jump 30 days.
- **Today** resets to the current day.
- The date label shows the current visible range (e.g., "Mar 19, 2026" or "Mar 15 -- Mar 19, 2026").

### Fullscreen

The fullscreen button expands the timeline to cover the entire viewport (hiding the navigation bar). Press **Escape** to exit.

### Refresh

The refresh button reloads all data for the current view. Useful after adding new data or syncing a source.

## Legend and Filters

A legend bar below the controls lets you toggle individual data tracks on and off. There are four top-level toggles (Music, Activity, Metrics, Location) and sub-toggles within Activity and Metrics.

### Activity sub-toggles

Sleep / Nap / Rest, Meditation, Exercise, Tags, Calendar, Screen Time (vertical mode only).

### Metrics sub-toggles

HR, HRV, Steps (horizontal only), Calories (horizontal only), Training Load (horizontal only), Screen Time (horizontal only).

Hiding a track prevents its data from being fetched (saving bandwidth and load time). Hidden items appear with strikethrough text in the legend. The legend auto-collapses to a single line on narrow screens, showing "Legend (N hidden)" when tracks are filtered.

## Now Line

A red dashed line labeled "Now" marks the current time when it falls within the visible range.

## Adaptive Detail

The Timeline automatically adjusts detail level as you zoom:

- **Zoomed in** (hours): Fine-grained 5-minute metric buckets, individual scrobbles, per-app screen time blocks.
- **Zoomed out** (days): Hourly metric buckets, merged music sessions, merged screentime categories.
- **Far out** (weeks/months): Daily or weekly buckets, simplified visualizations, small items merged into cluster labels ("5 Screen Time").

Time labels and date separators also adapt: from hourly labels at full zoom to daily, then weekly/monthly separators when viewing long ranges.

## URL Persistence

The current view state is encoded in the URL hash:

```
#from=2026-02-27T06:00&to=2026-02-27T18:00&hide=sleep_rest,music&o=h
```

This includes the visible time window, hidden tracks, and orientation override. You can bookmark or share a specific timeline view and it will restore exactly.

## Click-Through

Clicking an item navigates to its detail page where you can view full details, edit, add notes, or delete. Activity blocks go to the Activity Detail page; tags go to Tag Detail; productivity records go to Productivity Detail. Location blocks link to the Places page for that date.

## What Data It Needs

The Timeline is most useful when multiple data sources are connected. At minimum, you need at least one source of activities (Oura, Garmin, or Health Connect). Each additional source adds a layer:

| To see...       | Connect...                          |
| --------------- | ----------------------------------- |
| Sleep & HRV     | Oura, Garmin, or Health Connect     |
| Exercise & HR   | Oura, Garmin, or Health Connect     |
| Location        | OwnTracks                           |
| Screen time     | RescueTime or ActivityWatch         |
| Music           | Last.fm                             |
| Calendar events | Any ICS calendar URL                |
| Training load   | Automatic (computed from exercises) |

## Known Limitations

- **Music notation** in horizontal mode uses a fixed melody pattern for all sessions (purely decorative; the notes don't represent the actual music).
- **Screen time** in vertical mode can be visually dense with many apps. The category system helps, but highly fragmented usage still creates many small blocks.
- **Training load** requires approximately 6 weeks of exercise data before the fitness curve becomes reliable (shown as dashed during the bootstrapping period).
- **Location track** requires OwnTracks with continuous GPS logging. Gaps in logging appear as gaps in the track.
