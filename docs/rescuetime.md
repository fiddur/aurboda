# RescueTime

[RescueTime](https://www.rescuetime.com/) tracks application and website usage, assigning productivity scores to each activity.

## Data Synced

Each record contains:

| Field | Description |
|-------|-------------|
| `activity` | Application or website name (e.g., "VS Code", "Chrome - GitHub") |
| `category` | Classification (e.g., "Software Development", "Social Media") |
| `productivity` | Score from -2 to +2 (-2 = very distracting, 0 = neutral, +2 = very productive) |
| `duration_sec` | Time spent in seconds |
| `start_time` / `end_time` | Precise timestamps |
| `is_mobile` | Whether the activity was on mobile |

Data resolution is minute-level intervals from RescueTime's API.

## Admin Setup

No server-side configuration is needed. Each user provides their own RescueTime API key.

## User Setup

1. Get a personal API key from [RescueTime API settings](https://www.rescuetime.com/anapi/manage)
2. Go to **Settings > Data Sources > RescueTime API Key**
3. Paste the key and leave the field (saves automatically on blur)
4. Settings will show "Configured" once saved

## Sync

### Manual Sync

- **REST:** `POST /api/sync/rescuetime`
- **MCP:** `sync_rescuetime()`

Options:
- `full_resync: true` -- Re-fetch historical data (default: last 30 days)
- `start_date: "YYYY-MM-DD"` -- Start date for full resync

### Auto-Sync

RescueTime data is automatically refreshed before productivity-related queries (correlations, trends) if the last sync was more than 30 minutes ago.

### Rate Limiting

HTTP 429 responses are handled with exponential backoff: 1, 5, 15, 60 minutes.
