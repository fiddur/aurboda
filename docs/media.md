# Media plays (MPRIS)

A small logger on a Linux desktop watches every [MPRIS](https://specifications.freedesktop.org/mpris-spec/latest/)
media player (Firefox, mpv, Spotify, Jellyfin, a Navidrome web player…) and pushes each finished play to Aurboda.
Plays are stored as they were observed — Aurboda's [deduction rules](features/deduction-rules.md) decide what they
mean, for example copying the title of a yoga video onto the Garmin yoga activity it overlaps.

Unlike Last.fm, this carries video (Firefox reports a video with a title and no artist, which Last.fm rejects) and
reports how much was actually played, so a rule can tell a completed session from a skim.

```
MPRIS players  →  mpris-media-logger (spool)  →  media-to-aurboda (timer)  →  POST /api/sync/media
```

## Data synced

Each play is stored as a raw record (`source: "mpris"`, `record_type: "media_play"`, `external_id` = play `id`,
`recorded_at` = `started_at`). No activities are created; plays are queried by time range.

| Field               | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `id`                | Stable client id (1–64 chars); re-posting the same id updates the play          |
| `device`            | Device the play happened on                                                     |
| `player`            | MPRIS player, e.g. `firefox`, `mpv`                                             |
| `url`               | `xesam:url`, empty when the player reports none                                 |
| `title`             | `xesam:title`                                                                   |
| `artist`, `album`   | Empty strings when the player reports nothing — the client never invents values |
| `started_at`        | ISO 8601 start                                                                  |
| `ended_at`          | ISO 8601 end                                                                    |
| `played_secs`       | Content seconds actually played (paused time and seeks excluded)                |
| `track_secs`        | Track length in seconds, **`null` when unknown** (mpv omits it for some files)  |
| `max_position_secs` | Furthest position reached — the fallback signal when `track_secs` is null       |
| `seek_count`        | Number of seeks                                                                 |

The request's `device_name` is stored alongside as `device_name`.

## Pushing plays

`POST /api/sync/media` with a bearer token:

```json
{
  "device_name": "spanda",
  "plays": [
    {
      "id": "3c0f64c474b1ba4fb908e04462da58f0",
      "device": "spanda",
      "player": "firefox",
      "url": "https://truenakedyoga.com/...",
      "title": "Yin Yoga for Healthy Hips with Meagan — True Naked Yoga",
      "artist": "",
      "album": "",
      "started_at": "2026-09-24T15:33:54Z",
      "ended_at": "2026-09-24T16:03:20Z",
      "played_secs": 1782.0,
      "track_secs": 1800.0,
      "max_position_secs": 1800.0,
      "seek_count": 0
    }
  ]
}
```

Up to 1000 plays per request. The response reports `plays_received` and `plays_stored` (after collapsing duplicate
ids within the batch). Because `id` is the dedup key, a failed batch can simply be retried.

After storing, deduction rules are evaluated over the plays' time span, so a rule whose activity already exists
picks the play up immediately.

## Deduplication against Last.fm

Music played through a browser can arrive twice: from this pusher and from the [Last.fm](lastfm.md) pull. When
media plays are read, a Last.fm scrobble is dropped if an MPRIS play has the same title and artist (trimmed,
case-insensitive; only when the MPRIS artist is non-empty) and started within five minutes of it. The MPRIS record
wins — it carries the URL, true played seconds, player and seeks. This is computed at read time, so the order the
two arrive in does not matter and nothing stored changes.

## Derived fields

Computed at read time, never sent or stored:

- `kind` — `music` for Last.fm plays, otherwise `null` (unknown). MPRIS plays are not guessed from their fields
  (Firefox reports YouTube channels as artists); classify them with a rule's `url_host`.
- `played_ratio` — `played_secs / track_secs`, `null` when either is unknown.

## Querying

- REST: `GET /api/media/plays?start=<iso>&end=<iso>` — plays overlapping the window, sorted by `started_at`.
- MCP: `query_media_plays` (`start`, `end`, `tz`).

## Rules

Deduction rules have a `media` condition (host, title, artist, player, `min_played_secs`, `min_played_ratio`) and,
in enrich mode, `output_media_field`, which copies the title of the longest matching play into a data field of the
overlapping activity. See [Deduction Rules](features/deduction-rules.md#media-plays).

Setting `session_name` on Garmin yoga activities from True Naked Yoga videos:

```json
{
  "name": "Yoga session name",
  "mode": "enrich",
  "output_activity_type": "yoga",
  "conditions": [
    { "kind": "activity", "activity_type": "yoga" },
    {
      "kind": "media",
      "url_host": ["truenakedyoga.com"],
      "min_played_ratio": 0.8,
      "min_played_secs": 600
    }
  ],
  "output_media_field": { "field": "session_name", "strip_pattern": "\\s*—\\s*True Naked Yoga$" }
}
```

`Yin Yoga for Healthy Hips with Meagan — True Naked Yoga` becomes `session_name = "Yin Yoga for Healthy Hips with
Meagan"`. A 40-second skim of an 1800-second video fails both thresholds and is left alone (but stays in the play
history).

### Ordering and idempotency

The play usually arrives hours before Garmin syncs the activity. Both orders work:

- **Play first:** when the activity syncs, every enabled rule is evaluated over the synced window, which looks back
  at the stored plays.
- **Activity first:** `POST /sync/media` triggers the same evaluation over the plays' span.

Enrichment is idempotent: re-syncs write nothing when the value is unchanged. After editing the rule (say, a new
`strip_pattern`), re-evaluation overwrites values the rule wrote itself (`data._enriched_by` is the rule id), but
never a value set by someone else.

## Client

The client is two user units on the desktop: `mpris-media-logger`, a daemon that observes MPRIS and spools finished
plays to `~/.local/state/mpris-media/plays.jsonl`, and `media-to-aurboda`, a timer-driven script that posts the
spool and drops only the lines it shipped. It shares `~/.config/aurboda/config` (`AURBODA_BASE_URL`,
`AURBODA_TOKEN`, optional `DEVICE_NAME`) with the [ActivityWatch](activitywatch.md) pusher. The scripts and systemd
units are in [issue #1155](https://github.com/fiddur/aurboda/issues/1155).

## Admin setup

None.
