# Health Connect (Android App)

[Health Connect](https://developer.android.com/health-and-fitness/health-connect) is Android's unified health data API. The Aurboda Android app reads data from Health Connect and pushes it to the backend.

## Data Synced

### Metrics (time series)

| Health Connect Record | Aurboda Metric |
|----------------------|----------------|
| HeartRateRecord | `heart_rate` |
| HeartRateVariabilityRmssdRecord | `hrv_rmssd` |
| RestingHeartRateRecord | `resting_heart_rate` |
| WeightRecord | `weight` |
| BodyFatRecord | `body_fat` |
| BoneMassRecord | `bone_mass` |
| LeanBodyMassRecord | `lean_body_mass` |
| BodyWaterMassRecord | `body_water_mass` |
| HeightRecord | `height` |
| BloodPressureRecord | `blood_pressure_systolic`, `blood_pressure_diastolic` |
| BloodGlucoseRecord | `blood_glucose` |
| BodyTemperatureRecord | `body_temperature` |
| BasalBodyTemperatureRecord | `basal_body_temperature` |
| OxygenSaturationRecord | `spo2` |
| RespiratoryRateRecord | `respiratory_rate` |
| Vo2MaxRecord | `vo2_max` |
| BasalMetabolicRateRecord | `calories_basal` |

### Cumulative Metrics (daily aggregates)

These metrics use Health Connect's built-in deduplication to avoid double-counting across sources (e.g., Fitbit + phone sensor):

| Health Connect Record | Aurboda Metric |
|----------------------|----------------|
| StepsRecord | `steps` |
| DistanceRecord | `distance` |
| FloorsClimbedRecord | `floors_climbed` |
| ActiveCaloriesBurnedRecord | `calories_active` |
| TotalCaloriesBurnedRecord | `calories_total` |

These are sent as daily aggregates (one value per day) rather than raw records.

### Activities

| Health Connect Record | Aurboda Activity Type |
|----------------------|----------------------|
| ExerciseSessionRecord | `exercise` (with exercise type, title, notes, GPS route) |
| SleepSessionRecord | `sleep` (with sleep stage breakdowns) |

## Admin Setup

No server-side configuration is needed. The Android app communicates directly with the backend API using the user's auth token.

## User Setup

### 1. Install the App

Build from source or install from releases. The app requires Android with Health Connect support.

### 2. Log In

On first launch, enter:
- **Server URL** (e.g., `https://aurboda.net`)
- **Username**
- **Auth token** (from the web interface)

Credentials are stored encrypted on-device using Android EncryptedSharedPreferences.

### 3. Grant Permissions

The app requests read access to ~40 Health Connect data types. Grant all permissions for full data collection.

### 4. Initial Sync

After granting permissions, the app automatically fetches the last 7 days of data and generates a change tracking token for future incremental syncs.

### 5. Enable Background Sync (Recommended)

Toggle **Background Sync** in the app. This schedules automatic syncs every 15 minutes (Android WorkManager minimum interval).

The app may prompt you to disable battery optimization for reliable background syncing.

## How Sync Works

### Incremental Sync (Background)

The app uses Health Connect's **Changes API** with token-based tracking:

1. On first sync: fetch 7 days of data, get initial change token
2. On subsequent syncs: use the token to get only new/updated/deleted records
3. The token is only saved after successful upload to prevent data loss

### Data Flow

1. App reads records from Health Connect
2. Cumulative metrics (steps, distance, etc.) are sent as deduplicated **daily aggregates** to `POST /api/sync/daily-aggregates`
3. All other records are sent as raw data to `POST /api/sync/{recordType}` (e.g., `/api/sync/HeartRateRecord`)
4. Deleted records are reported to `POST /api/sync/deletions`
5. Backend processes each record: stores raw JSON, extracts metrics to time series, creates activities for exercise/sleep

### Chunking

HeartRateRecord data (which can contain thousands of samples) is sent in chunks of 10 records per request to avoid HTTP 413 errors.

### Scheduling

| Mode | Interval | Conditions |
|------|----------|------------|
| Background | Every 15 minutes | Requires network connection |
| Foreground (app open) | Every 60 seconds | Only if background sync enabled |
| Manual | On demand | "Fetch New Data" button |
