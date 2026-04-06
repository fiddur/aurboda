# Last.fm

[Last.fm](https://www.last.fm/) tracks music listening history ("scrobbles"). Aurboda syncs scrobbles and can automatically create tags based on configurable rules, enabling correlation analysis between music and health metrics.

## Data Synced

Scrobbles are stored as raw records with:

- Track name, artist, album
- MusicBrainz IDs (when available)
- Timestamp

Scrobbles can be queried directly via API or MCP. The **auto-tagging rules** system creates tags from matching scrobbles, which appear on the timeline and can be used in correlations.

## Admin Setup

The server administrator must configure a Last.fm API key:

1. Register for an API key at [Last.fm API](https://www.last.fm/api/account/create)
2. Go to **Admin Settings > Integrations > Last.fm API Key**
3. Enter the key (saves automatically on blur)

This is a server-wide key shared by all users.

## User Setup

1. Go to **Settings > Data Sources > Last.fm**
2. Enter your Last.fm username
3. Set up auto-tagging rules (see below)

## Auto-Tagging Rules

Rules define how scrobbles become tags. Each rule specifies what to match and what tag to create.

### Match Types

| Type           | Description                    | Example                                        |
| -------------- | ------------------------------ | ---------------------------------------------- |
| `track`        | Match by track name            | Track "Breathe" creates tag "meditation-music" |
| `artist`       | Match by artist name           | Artist "Nils Frahm" creates tag "ambient"      |
| `track_artist` | Match by both track and artist | Specific track by specific artist              |

### Match Modes

| Mode       | Description                            |
| ---------- | -------------------------------------- |
| `exact`    | Case-insensitive exact match (default) |
| `contains` | Substring match                        |

### Multiple Artists

Rules can match multiple artists at once using the `artist_names` field. This is useful for grouping several artists under one tag.

### Session Merging

When `merge_gap_seconds` is set, consecutive matching scrobbles within the specified gap are merged into a single span tag (with start and end time) instead of creating individual point tags. This is useful for treating a listening session as a single activity.

For example, with a 10-minute merge gap: if you listen to 5 tracks by the same artist over 20 minutes, they become one tag spanning the full session rather than 5 separate tags.

### Retroactive Tagging

When a new rule is created, it is automatically applied to all existing scrobbles in the database. This means you don't need to re-sync to pick up historical matches.

When a rule is deleted, all auto-generated tags from that rule are also removed.

### Re-Tagging

If rules have been changed and tags are out of sync, you can do a full re-tag to delete all auto-generated Last.fm tags and reapply all rules from scratch:

- **REST:** `POST /api/lastfm/retag`
- **MCP:** `retag_lastfm_scrobbles()`

### Managing Rules

Rules can be managed in **Settings > Last.fm Tag Rules** or via MCP tools:

- `get_lastfm_tag_rules()` -- List all rules
- `add_lastfm_tag_rule(...)` -- Create a rule (also applies retroactively)
- `delete_lastfm_tag_rule(rule_id)` -- Delete a rule (also removes its auto-tags)

## Querying Scrobbles

Raw scrobbles can be queried by time range:

- **REST:** `GET /api/lastfm/scrobbles?start=...&end=...`
- **MCP:** `query_scrobbles(start, end)`

Returns track name, artist, album, and timestamp for each scrobble in the time range.

## Sync

### Auto-Sync

Last.fm scrobbles are automatically synced when querying tags or the daily summary, if the last sync was more than 30 minutes ago. This ensures scrobble data stays current without manual intervention.

### Manual Sync

- **REST:** `POST /api/sync/lastfm`
- **MCP:** `sync_lastfm()`

Options:

- `full_resync: true` -- Re-fetch historical data (default: last 30 days)
- `start_date: "YYYY-MM-DD"` -- Start date for full resync

### Sync Process

1. Fetch recent scrobbles from Last.fm API (paginated, 200 per page)
2. Store each scrobble as a raw record
3. Apply auto-tagging rules to each scrobble
4. Create tags (or extend existing span tags) for matching rules

Currently-playing tracks are skipped (no timestamp yet).
