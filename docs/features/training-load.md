# Training Load

Training Load uses the Banister impulse-response model to track your fitness, fatigue, and form over time. It turns individual workouts into a continuous picture of your training state -- are you building fitness, accumulating too much fatigue, or in a balanced recovery zone?

The training load track appears on the Timeline in horizontal mode. It's also available via the API and MCP tools for AI-driven analysis.

## Key Concepts

### CTL (Chronic Training Load) -- "Fitness"

A long-term exponential moving average of your training stress (default time constant: 42 days). Represents your accumulated fitness. Higher CTL means you've been training consistently. The CTL curve takes weeks to build and weeks to decay.

Shown as a **blue filled area** on the Timeline.

### ATL (Acute Training Load) -- "Fatigue"

A short-term exponential moving average of your training stress (default time constant: 7 days). Represents recent fatigue. High ATL means you've trained hard recently and may need recovery.

Shown as **colored bars** behind the impulse bars: light blue when low, shifting through orange to red as fatigue increases.

### TSB (Training Stress Balance) -- "Form"

The difference: **TSB = CTL - ATL**. When positive (green), you're fresh -- fitness exceeds current fatigue. When negative (red), you're fatigued -- recent training stress exceeds your fitness base.

Shown as a **line** that's green above zero and red below, with a dashed zero reference line.

### TRIMP (Training Impulse)

A per-workout load score computed from heart rate intensity and duration. Harder, longer workouts produce higher TRIMP. The formula accounts for the exponential nature of training stress -- time at high heart rates contributes disproportionately more than time at low heart rates.

When heart rate data isn't available for a workout, TRIMP defaults to a simple duration-based estimate.

### Activity Impulse

Training stress from general daily movement (active calories). Converted from calories using a scale factor (default: 100 active calories = 10 impulse units). This captures non-workout activity like walking and housework.

## Recovery Zones

Once you have about 6 weeks of training data, recovery zones appear as colored horizontal bands on the Timeline. They classify your current fatigue relative to your historical fitness:

| Zone              | Meaning                                         | Visual      |
| ----------------- | ----------------------------------------------- | ----------- |
| **Undertrained**  | Not training enough to maintain current fitness | Blue tint   |
| **Balanced**      | Optimal training range                          | Green tint  |
| **Strained**      | Elevated fatigue, risk of overreaching          | Orange tint |
| **Very Strained** | Very high fatigue, high overtraining risk       | Red tint    |

Zone boundaries are based on your average CTL: balanced is 0.8x to 1.3x, strained is 1.3x to 1.7x, very strained is above 1.7x.

## The Timeline Track

In horizontal mode, the training load track shows within the Metrics lane:

- **Stacked impulse bars**: Purple (TRIMP from workouts) and light blue (activity impulse from calories) per time bucket.
- **Fatigue bars**: Background bars showing ATL, colored by intensity.
- **CTL curve**: Blue filled area. Dashed during the bootstrapping period (first ~6 weeks).
- **TSB line**: Green when fresh, red when fatigued.
- **Recovery zone bands**: Colored backgrounds (after bootstrapping).

Hovering shows a tooltip with fitness (CTL), fatigue (ATL), form (TSB with Fresh/Fatigued label), impulse values, recovery zone, and details of nearby workouts (title, duration, TRIMP, average HR).

## Bootstrapping Period

The first ~6 weeks of data are a bootstrapping period. During this time:

- The CTL curve is shown as **dashed** with reduced opacity.
- **Recovery zones are not displayed** (not enough data to be meaningful).
- The `bootstrapping` flag is set in the API response.

This is because the 42-day CTL time constant needs approximately 42 days of data before the fitness estimate stabilizes.

## Configuration

Training load settings can be adjusted in user settings:

| Setting                    | Default       | Description                                                                                                                                     |
| -------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Max HR**                 | Auto-detected | Overrides the maximum heart rate used for TRIMP calculation. Falls back to: highest observed HR in the last year, then 220 - age, then 190 bpm. |
| **Resting HR**             | Auto-detected | Overrides resting HR. Falls back to: most recent resting HR metric, then 60 bpm.                                                                |
| **Acute time constant**    | 7 days        | Controls how quickly the fatigue (ATL) EMA responds. Lower = more responsive.                                                                   |
| **Chronic time constant**  | 42 days       | Controls how quickly the fitness (CTL) EMA responds. Lower = more responsive.                                                                   |
| **Activity impulse scale** | 0.1           | Converts active calories to impulse units.                                                                                                      |

The TRIMP formula uses a sex-dependent weighting constant (k-factor): 1.92 for males, 1.67 for females. This is automatically selected based on your biological sex setting.

## What Data It Needs

| Input                      | Source                                      | Used for                         |
| -------------------------- | ------------------------------------------- | -------------------------------- |
| Exercise sessions          | Oura, Garmin, Health Connect                | TRIMP calculation (with HR data) |
| Heart rate during exercise | Any HR source overlapping exercise sessions | Accurate TRIMP scoring           |
| Active calories            | Health Connect aggregate, HR-computed       | Activity impulse                 |
| Resting heart rate         | Oura, Garmin, Health Connect                | TRIMP baseline                   |
| Max heart rate             | Observed from data, or manual setting       | TRIMP scaling                    |
| Biological sex             | User settings                               | TRIMP k-factor selection         |

Training load works with just exercise sessions (using duration fallback), but is most accurate with heart rate data during workouts.

## Known Limitations

- There is **no dedicated Training Load page** -- it only appears as a track on the Timeline in horizontal mode. (See issue #381 for a planned dedicated page.)
- Recovery zones require ~6 weeks of exercise data and a meaningful average CTL. Users who train infrequently may never see zones.
- The TRIMP formula assumes a specific relationship between heart rate and metabolic load. Individual variations (e.g., cardiac drift, heat, altitude) are not accounted for.
- Activity impulse from calories is a rough proxy for training stress. It doesn't distinguish between easy and hard non-workout activity.
