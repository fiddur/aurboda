-- One-time migration: Convert Oura-sourced nap activities to 'rest' where the
-- total non-awake sleep stage time is less than 15 minutes.
--
-- Background: Oura's API returns type "sleep" for short detected sleep periods.
-- Aurboda previously mapped all of these to activity_type='nap'. Oura's own app
-- only shows them as naps if there are >= 15 minutes of actual sleep stages
-- (light, deep, or REM). Shorter detections are shown as "restorative time".
--
-- This migration reclassifies existing phantom naps to match the new threshold logic.
--
-- The stages are stored in HC encoding: 1=awake, 4=light, 5=deep, 6=REM.
-- We sum the duration of all non-awake stages and compare to 15 minutes.
--
-- Run with: psql -U <user> -d <database> -f migrate-phantom-naps-to-rest.sql
-- Or for a specific schema: psql -U <user> -d <database> -c "SET search_path TO <schema>" -f ...
--
-- DRY RUN first (shows what would be updated):
-- Uncomment the SELECT and comment the UPDATE.

-- Dry run: see which activities would be affected
SELECT
  id,
  title,
  start_time,
  end_time,
  data->>'ouraType' AS oura_type,
  (
    SELECT COALESCE(SUM(
      EXTRACT(EPOCH FROM (
        (s->>'endTime')::timestamptz - (s->>'startTime')::timestamptz
      )) / 60.0
    ), 0)
    FROM jsonb_array_elements(data->'stages') AS s
    WHERE (s->>'stage')::int != 1  -- exclude awake
  ) AS sleep_minutes
FROM activities
WHERE source = 'oura'
  AND activity_type = 'nap'
  AND deleted_at IS NULL
  AND (
    SELECT COALESCE(SUM(
      EXTRACT(EPOCH FROM (
        (s->>'endTime')::timestamptz - (s->>'startTime')::timestamptz
      )) / 60.0
    ), 0)
    FROM jsonb_array_elements(data->'stages') AS s
    WHERE (s->>'stage')::int != 1
  ) < 15
ORDER BY start_time;

-- Actual migration: uncomment below and comment out the SELECT above
/*
UPDATE activities
SET activity_type = 'rest',
    title = 'Rest'
WHERE source = 'oura'
  AND activity_type = 'nap'
  AND deleted_at IS NULL
  AND (
    SELECT COALESCE(SUM(
      EXTRACT(EPOCH FROM (
        (s->>'endTime')::timestamptz - (s->>'startTime')::timestamptz
      )) / 60.0
    ), 0)
    FROM jsonb_array_elements(data->'stages') AS s
    WHERE (s->>'stage')::int != 1
  ) < 15;
*/
