# HR Zones

Aurboda tracks time spent in six heart rate zones during exercise, with weekly targets based on the Galpin/Huberman exercise science recommendations. The HR Zones page shows your weekly progress at a glance, and zone data appears throughout the app -- on the Timeline, in exercise details, on the Dashboard, and on an Android home screen widget.

## The Six Zones

| Zone | Name      | Color       | Description                     |
| ---- | --------- | ----------- | ------------------------------- |
| 0    | Rest      | Gray        | Below Zone 1 threshold          |
| 1    | Warm-up   | Light blue  | Light activity, ~50% of max HR  |
| 2    | Aerobic   | Green       | Steady-state cardio, ~60% of max HR |
| 3    | Tempo     | Amber       | Comfortably hard, ~70% of max HR |
| 4    | Threshold | Orange      | Hard effort, ~80% of max HR    |
| 5    | Max effort| Red         | All-out sprints, ~90% of max HR |

Zone boundaries are defined by BPM thresholds. Everything below the Zone 1 threshold counts as Zone 0 (rest); everything at or above the Zone 5 threshold counts as Zone 5 (max effort).

## Configuring Zone Thresholds

Aurboda determines your zone thresholds using a three-tier priority:

### 1. Custom zones (highest priority)

Set your own thresholds in **Settings > HR Zone Thresholds**. Enter the starting BPM for Zones 1 through 5. Values must be between 40 and 220 BPM, in strictly ascending order. Changes save automatically.

### 2. Age-based zones

If you haven't set custom zones but have entered your **birth date** in Settings, Aurboda calculates zones automatically using the classic formula:

- **Max HR = 220 - age**
- Zone thresholds at **50%, 60%, 70%, 80%, 90%** of max HR

For example, at age 40: max HR = 180, so Zone 2 starts at 108 bpm and Zone 5 at 162 bpm.

### 3. Default zones (fallback)

If neither custom zones nor birth date are configured, Aurboda uses default thresholds based on an assumed max HR of 180 (approximately age 40).

You can always see which mode is active in Settings. The "Reset to defaults" button clears any custom zones, falling back to age-based or default.

## Weekly Targets

The HR Zones page displays progress toward weekly targets based on the **Galpin/Huberman protocol** -- exercise science recommendations for cardiovascular health and longevity:

| Zone | Weekly target | Rationale |
| ---- | ------------- | --------- |
| 0    | --            | Not targeted |
| 1    | 60 min        | Warm-up and recovery |
| 2    | **200 min**   | Aerobic base building -- the cornerstone recommendation |
| 3    | 60 min        | Tempo and lactate threshold work |
| 4    | 30 min        | High-intensity threshold training |
| 5    | **10 min**    | Brief max-effort intervals (sprints, VO2 max work) |

The key takeaway is 150-200 minutes per week in Zone 2 (easy, conversational-pace cardio) and 5-10 minutes per week in Zone 5 (all-out effort). These targets are also available as default Goals (see [Goals](goals.md)).

## The HR Zones Page

The web page at `/hr-zones` shows your zone minutes for the last 7 days. Each zone displays:

- The **zone name and BPM range** (e.g., "Zone 2 (108 - 125 bpm)")
- A **progress bar** colored by zone, filled proportionally to the weekly target
- **Time accumulated** (e.g., "2 h 15 min")
- **Percentage** of the weekly target (e.g., "68%")

The Android app has a matching view on its Data screen.

## How Zone Time Is Calculated

Zone minutes are computed on-the-fly from raw heart rate data during exercise -- they are not stored as separate metrics. The algorithm:

1. Takes all heart rate samples recorded during an exercise session.
2. For each consecutive pair of samples, assigns the time between them to the zone matching the first sample's HR value.
3. Gaps between samples are capped at 5 seconds to prevent sparse data (e.g., from Oura's 5-minute intervals) from inflating zone time.

This means zone accuracy depends on the granularity of your HR data. A chest strap (1-second samples) gives near-perfect zone tracking; a wrist-based sensor with less frequent samples still works but with slightly less precision.

## Where Zones Appear

### Timeline

Exercise blocks on the Timeline are **colored by their dominant HR zone** -- the zone where you spent the most time. An easy run appears blue (Zone 2), a hard interval session appears red (Zone 5). Hovering over an exercise shows a mini HR zone distribution bar in the tooltip.

### Exercise Detail

The exercise detail page shows a full **HR zone breakdown bar** with a legend listing time in each zone.

### Dashboard

A "Zone 2 (Weekly)" metric card can be added to the Dashboard to track your Zone 2 progress without visiting the HR Zones page.

### Android Widget

The Android home screen widget shows goal progress including zone targets. It updates every 15 minutes and after each background sync. Each goal row shows the current value, a progress bar (green when met, gray when below target), and how much time will drop off the rolling window tomorrow.

## What Data It Needs

HR zone tracking requires **heart rate data during exercise**. This can come from:

| Source | HR granularity | Zone accuracy |
| --- | --- | --- |
| BLE chest strap (Polar H10, etc.) via Android app | ~1 second | Excellent |
| Health Connect (smartwatch HR) | Varies (1-60 seconds) | Good |
| Oura Ring | ~5 minutes | Approximate |
| Garmin Connect | ~15 seconds | Good |

You also need exercise sessions recorded (from any source) so the system knows which HR data corresponds to a workout versus resting.

## Known Limitations

- Zone time is only computed during **exercise activities**, not throughout the entire day. HR data outside of exercise sessions is not counted toward zone targets.
- Weekly targets are fixed at the Galpin/Huberman recommendations and cannot be customized on the HR Zones page. For custom zone targets, use the Goals feature instead.
- The age-based formula (220 - age) is a population average. Individual max HR can vary significantly. Setting custom thresholds is recommended if you know your actual max HR from a lab test or field test.
