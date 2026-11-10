# Places & Location Tracking

Aurboda tracks where you spend your time. The Places page shows your daily movements on an interactive map with a chronological list of place visits. The system automatically detects locations you visit frequently, geocodes them to street addresses, and lets you name them.

## The Places Page

The page at `/places` has a split layout: a visit list on the left and an interactive map on the right (stacked vertically on mobile).

### Date Navigation

A date picker with previous/next-day buttons lets you browse one day at a time. The default is today.

### Visit List

Place visits are shown chronologically, each displaying:

- **Time range** (e.g., "09:15 - 12:30")
- **Place name** (e.g., "Office", "Home", or an auto-geocoded address)
- **Duration** in minutes
- **Source indicator** as a colored left border

Between consecutive visits, **transit** entries appear as dashed connectors showing the gap time.

### Source Types

| Source        | Color  | Description                                                       |
| ------------- | ------ | ----------------------------------------------------------------- |
| **Named**     | Green  | Locations you've named (e.g., "Home", "Gym")                      |
| **Detected**  | Orange | Automatically detected frequent locations with geocoded addresses |
| **OwnTracks** | Blue   | Identified by OwnTracks geofence regions                          |
| **Unknown**   | Gray   | Unidentified locations, shown as "Somewhere"                      |

### Map

An interactive OpenStreetMap map. Clicking a place in the visit list places a marker on the map and centers on that location.

### Naming Locations

Clicking an unnamed place (detected or unknown) opens a naming dialog. Enter a name like "Home" or "Office", and the location is promoted to a named location. Named locations are then recognized automatically in all future visits.

For detected locations, the auto-geocoded address is pre-filled as a suggestion.

### Named Places

Below the day's visits, a **Named places** section lists every named location, sorted by name, whatever date is selected, with its radius and whether visits there create activities. Clicking one opens the same dialog as clicking a named visit, where you can rename it or toggle activity creation; its **Delete** button removes it after a confirmation. This is how to reach a place that was created through the API, MCP or the Android app before any visit to it was recorded.

## How Location Detection Works

The detection pipeline runs automatically in the background:

1. **GPS data arrives** from OwnTracks as continuous location updates.
2. **Stay detection**: Points within a 200-meter radius where you remained for 60+ minutes are grouped into a "stay."
3. **Clustering**: Multiple stays at similar locations are merged, tracking visit count, total time, and a suggested radius.
4. **Geocoding**: New detected locations are reverse-geocoded via OpenStreetMap's Nominatim service to get a street address. Geocoding is rate-limited (1 request per 1.1 seconds) and retried on failure.
5. **Visit resolution**: When querying a day's visits, each GPS period is matched against named locations (highest priority), detected locations, OwnTracks regions, and finally marked as unknown.

Short unknown visits under 5 minutes (typically GPS jitter) are merged into adjacent visits to reduce noise.

### Last known place

A phone at rest reports nothing, so a stay can have no fix at all: a 20-minute yoga session at
home may fall between the morning's last fix and the afternoon's first. `GET /locations` (and
the `query_locations` MCP tool) take `last_known_hours`: when the range starts before its first
fix, the last fix from up to that many hours earlier is carried forward to the start of the
range. The visit it yields is marked `inferred_from` with that fix's time. With no fix in the
range at all it spans the whole range, otherwise it ends where the next fix places you
elsewhere. It is off by default, and a query that asks for it never creates `location_visit` activities:
its first visit starts at the queried range rather than at a fix. Detail pages ask for 6 hours and show such a place as "last seen 11:16".

## Places summary

`GET /locations/places-summary?start=<iso>&end=<iso>&tz=<IANA>&home_location=<name>` (MCP:
`get_places_summary`) says where the nights of a range were spent and which named places were visited.

- **Place of a visit.** A visit to a named location is that place. An OwnTracks region carrying the
  name of a named location (matched case-insensitively) is that named location too: such regions often
  reach past the named radius, so a fix just outside it would otherwise split the stay. Anything else
  (detected places, other regions, unknown places) is _elsewhere_. Consecutive visits to the same place
  at most 36 hours apart are joined into one, so the fragments of a stay count as one visit.
- **Nights.** Every evening date in the range (in `tz`) is a night, so a month has as many nights as
  days and a stay running past its end still counts its nights inside it. A night goes to the place the
  user was at 03:00 the next morning: the visit covering that moment; else, when the last visit before
  it and the next one after it are to the same place at most 36 hours apart, that place; else the place
  of the last visit when it ended at most 18 hours before (a phone at rest reports nothing); otherwise
  the night has no data. The range is widened by two days each side so the nights at its edges have
  visits around them.
- **Figures.** `nights_by_place` (every named place with a night, most nights first),
  `nights_elsewhere`, `nights_no_data`, `nights_home` (the nights at `home_location`, default `Home`,
  matched case-insensitively) and `nights_away` (every other night with a place); `distinct_places`
  and `visits` count the named places and the visits to them; `places` lists the five named places
  with the most nights, then the most hours, with their nights, visits and hours. Together the nights
  per place, elsewhere and without data add up to the nights of the range.

It is behind the dashboard's [places card](dashboard.md#places-card) and the place
[top list](dashboard.md#top-list-card). `GET /locations/summary` (MCP: `get_location_summary`) is the
same kind of roll-up for one named place.

## Integration with Other Features

### Timeline

The Timeline shows a location track with colored blocks for each place visit. Clicking a location block on the Timeline links to the Places page for that date and location.

### Sleep Location

The daily summary includes a **sleep location** for each sleep session -- the place where you spent the most time during sleep, determined by finding the visit with the longest overlap.

### Correlations

The Correlations page includes a "Locations" table showing how your HRV and heart rate correlate with different places you visit.

## URL Deep-Linking

The Places page supports URL parameters for deep-linking:

```
/places?date=2026-03-19&name=Office
```

This opens the Places page for a specific date and auto-selects the named place.

## What Data It Needs

Location tracking requires **OwnTracks** configured in HTTP mode, sending continuous GPS updates to Aurboda. See [docs/owntracks.md](../owntracks.md) for setup.

The more frequently OwnTracks sends updates, the more accurate stay detection and visit tracking become. A 5-15 minute reporting interval works well for most users.

**PostGIS** is required on the database (included in the Docker setup) for geographic distance calculations.

## Known Limitations

- Location tracking depends entirely on **OwnTracks GPS data**. There is no integration with Google Maps Timeline, Apple Location Services, or other providers.
- Detection requires **60+ minutes** at a location within 200 meters. Brief visits (e.g., a 30-minute coffee shop stop) are not auto-detected as frequent locations but still appear as visits.
- Geocoding uses OpenStreetMap's Nominatim, which is rate-limited and may not have addresses for all locations (especially rural or newly developed areas).
- The map defaults to Stockholm coordinates when no location data exists for the selected day.
- There is no **weekly or monthly location summary** -- the page shows one day at a time.
