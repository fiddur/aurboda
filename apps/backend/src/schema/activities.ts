/**
 * Activity-domain table SQL: activities + activity_type_definitions (with
 * built-in seed) + deduction rules + legacy tag tables.
 */
export const activitiesTables: Record<string, string> = {
  // Unified activities table (covers all time-ranged events: sleep, exercise, tags, calendar, etc.)
  activities: `
    CREATE TABLE IF NOT EXISTS activities (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL,
      external_id     VARCHAR(255),
      activity_type   VARCHAR(100) NOT NULL REFERENCES activity_type_definitions(name) ON UPDATE CASCADE,
      start_time      TIMESTAMPTZ NOT NULL,
      end_time        TIMESTAMPTZ,
      title           VARCHAR(255),
      data            JSONB,
      deleted_at      TIMESTAMPTZ,
      superseded_by   UUID REFERENCES activities(id) ON DELETE SET NULL
    )
  `,

  activities_indexes: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_ext_id ON activities (source, external_id) WHERE external_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_type_time ON activities (source, activity_type, start_time) WHERE external_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_activities_time_range ON activities (start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_activities_not_deleted ON activities (activity_type, start_time DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_activities_not_superseded ON activities (activity_type, start_time DESC) WHERE deleted_at IS NULL AND superseded_by IS NULL
  `,

  // Many-to-many: an aurboda override can target multiple synced rows (the
  // common case post-cross-source merge — Garmin + Strava + Health Connect
  // all reporting the same physical session). Each target may be overridden
  // by at most one override (UNIQUE on target_id), preventing the
  // ambiguous "which override wins for this source" case at merge time.
  // Both sides cascade-delete: removing a target unlinks it from its
  // override; removing an override removes all its target links.
  activity_override_targets: `
    CREATE TABLE IF NOT EXISTS activity_override_targets (
      override_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      target_id   UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      PRIMARY KEY (override_id, target_id)
    )
  `,
  activity_override_targets_indexes: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_aot_unique_target ON activity_override_targets (target_id);
    CREATE INDEX IF NOT EXISTS idx_aot_override ON activity_override_targets (override_id)
  `,

  // Restore the old "delete override when its target is deleted" cascade
  // semantics under the join-table model: when an override's LAST target
  // row is removed, also remove the override activity itself. Multi-target
  // overrides survive the loss of any single target — the override row
  // stays until every target is gone.
  activity_override_targets_trigger: `
    CREATE OR REPLACE FUNCTION delete_orphan_override() RETURNS TRIGGER AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM activity_override_targets WHERE override_id = OLD.override_id
      ) THEN
        DELETE FROM activities WHERE id = OLD.override_id;
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.triggers
         WHERE event_object_table = 'activity_override_targets'
           AND trigger_name = 'aot_delete_orphan_override'
      ) THEN
        CREATE TRIGGER aot_delete_orphan_override
          AFTER DELETE ON activity_override_targets
          FOR EACH ROW EXECUTE FUNCTION delete_orphan_override();
      END IF;
    END $$
  `,

  // Activity type definitions (built-in + custom)
  activity_type_definitions: `
    CREATE TABLE IF NOT EXISTS activity_type_definitions (
      name              VARCHAR(100) PRIMARY KEY,
      display_name      VARCHAR(255) NOT NULL,
      display_category  VARCHAR(50) NOT NULL DEFAULT 'other',
      color             VARCHAR(7) NOT NULL DEFAULT '#6b7280',
      icon              TEXT,
      aliases           TEXT[] NOT NULL DEFAULT '{}',
      health_connect_record_type VARCHAR(100),
      health_connect_exercise_type INTEGER,
      is_builtin        BOOLEAN NOT NULL DEFAULT false,
      show_on_timeline  BOOLEAN NOT NULL DEFAULT true,
      data_schema       JSONB,
      parent_type       VARCHAR(100) REFERENCES activity_type_definitions(name) ON UPDATE CASCADE,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  activity_type_definitions_indexes: `
    CREATE INDEX IF NOT EXISTS idx_atd_aliases ON activity_type_definitions USING GIN (aliases);
    CREATE INDEX IF NOT EXISTS idx_atd_parent ON activity_type_definitions (parent_type)
  `,
  activity_type_definitions_seed: `
    INSERT INTO activity_type_definitions (name, display_name, display_category, color, is_builtin, health_connect_record_type, health_connect_exercise_type) VALUES
      ('sleep', 'Sleep', 'sleep_rest', '#3b82f6', true, 'SleepSessionRecord', NULL),
      ('exercise', 'Exercise', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', NULL),
      ('meditation', 'Meditation', 'meditation', '#a855f7', true, NULL, NULL),
      ('nap', 'Nap', 'sleep_rest', '#60a5fa', true, 'SleepSessionRecord', NULL),
      ('rest', 'Rest', 'sleep_rest', '#86efac', true, NULL, NULL),
      ('calendar_event', 'Calendar Event', 'other', '#f59e0b', true, NULL, NULL),
      ('back_extension', 'Back Extension', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 1),
      ('badminton', 'Badminton', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 2),
      ('barbell_shoulder_press', 'Barbell Shoulder Press', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 3),
      ('baseball', 'Baseball', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 4),
      ('basketball', 'Basketball', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 5),
      ('bench_press', 'Bench Press', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 6),
      ('bench_sit_up', 'Bench Sit Up', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 7),
      ('biking', 'Biking', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 8),
      ('biking_stationary', 'Biking Stationary', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 9),
      ('boot_camp', 'Boot Camp', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 10),
      ('boxing', 'Boxing', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 11),
      ('burpee', 'Burpee', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 12),
      ('calisthenics', 'Calisthenics', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 13),
      ('cricket', 'Cricket', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 14),
      ('crunch', 'Crunch', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 15),
      ('dancing', 'Dancing', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 16),
      ('deadlift', 'Deadlift', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 17),
      ('dumbbell_curl_left_arm', 'Dumbbell Curl Left Arm', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 18),
      ('dumbbell_curl_right_arm', 'Dumbbell Curl Right Arm', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 19),
      ('dumbbell_front_raise', 'Dumbbell Front Raise', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 20),
      ('dumbbell_lateral_raise', 'Dumbbell Lateral Raise', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 21),
      ('dumbbell_triceps_extension_left_arm', 'Dumbbell Triceps Extension Left Arm', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 22),
      ('dumbbell_triceps_extension_right_arm', 'Dumbbell Triceps Extension Right Arm', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 23),
      ('dumbbell_triceps_extension_two_arm', 'Dumbbell Triceps Extension Two Arm', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 24),
      ('elliptical', 'Elliptical', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 25),
      ('exercise_class', 'Exercise Class', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 26),
      ('fencing', 'Fencing', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 27),
      ('football_american', 'Football American', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 28),
      ('football_australian', 'Football Australian', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 29),
      ('forward_twist', 'Forward Twist', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 30),
      ('frisbee_disc', 'Frisbee Disc', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 31),
      ('golf', 'Golf', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 32),
      ('guided_breathing', 'Guided Breathing', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 33),
      ('gymnastics', 'Gymnastics', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 34),
      ('handball', 'Handball', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 35),
      ('high_intensity_interval_training', 'High Intensity Interval Training', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 36),
      ('hiking', 'Hiking', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 37),
      ('ice_hockey', 'Ice Hockey', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 38),
      ('ice_skating', 'Ice Skating', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 39),
      ('jumping_jack', 'Jumping Jack', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 40),
      ('jump_rope', 'Jump Rope', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 41),
      ('lat_pull_down', 'Lat Pull Down', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 42),
      ('lunge', 'Lunge', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 43),
      ('martial_arts', 'Martial Arts', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 44),
      ('other_workout', 'Other Workout', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 0),
      ('paddling', 'Paddling', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 46),
      ('paragliding', 'Paragliding', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 47),
      ('pilates', 'Pilates', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 48),
      ('plank', 'Plank', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 49),
      ('racquetball', 'Racquetball', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 50),
      ('rock_climbing', 'Rock Climbing', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 51),
      ('roller_hockey', 'Roller Hockey', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 52),
      ('rowing', 'Rowing', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 53),
      ('rowing_machine', 'Rowing Machine', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 54),
      ('rugby', 'Rugby', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 55),
      ('running', 'Running', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 56),
      ('running_treadmill', 'Running Treadmill', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 57),
      ('sailing', 'Sailing', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 58),
      ('scuba_diving', 'Scuba Diving', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 59),
      ('skating', 'Skating', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 60),
      ('skiing', 'Skiing', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 61),
      ('snowboarding', 'Snowboarding', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 62),
      ('snowshoeing', 'Snowshoeing', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 63),
      ('soccer', 'Soccer', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 64),
      ('softball', 'Softball', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 65),
      ('squash', 'Squash', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 66),
      ('squat', 'Squat', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 67),
      ('stair_climbing', 'Stair Climbing', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 68),
      ('stair_climbing_machine', 'Stair Climbing Machine', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 69),
      ('strength_training', 'Strength Training', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 70),
      ('stretching', 'Stretching', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 71),
      ('surfing', 'Surfing', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 72),
      ('swimming_open_water', 'Swimming Open Water', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 73),
      ('swimming_pool', 'Swimming Pool', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 74),
      ('table_tennis', 'Table Tennis', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 75),
      ('tennis', 'Tennis', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 76),
      ('upper_twist', 'Upper Twist', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 77),
      ('volleyball', 'Volleyball', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 78),
      ('walking', 'Walking', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 79),
      ('water_polo', 'Water Polo', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 80),
      ('weightlifting', 'Weightlifting', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 81),
      ('wheelchair', 'Wheelchair', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 82),
      ('yoga', 'Yoga', 'exercise', '#22c55e', true, 'ExerciseSessionRecord', 83)
    ON CONFLICT (name) DO NOTHING;
    -- Seed the built-in hierarchy: exercise subtypes → 'exercise', nap/rest → 'sleep'.
    UPDATE activity_type_definitions
       SET parent_type = 'exercise'
     WHERE is_builtin = true
       AND display_category = 'exercise'
       AND name != 'exercise'
       AND parent_type IS NULL;
    UPDATE activity_type_definitions
       SET parent_type = 'sleep'
     WHERE is_builtin = true
       AND name IN ('nap', 'rest')
       AND parent_type IS NULL;
    -- music_scrobble type: point-in-time activity for a Last.fm scrobble.
    -- show_on_timeline=false because scrobbles are rendered on the dedicated
    -- music staff track, not the main activity lane.
    INSERT INTO activity_type_definitions (name, display_name, display_category, color, icon, is_builtin, show_on_timeline, data_schema) VALUES
      ('music_scrobble', 'Music Scrobble', 'other', '#ec4899', '🎵', true, false, $json$
        {"fields":[
          {"name":"artist","type":"string","required":true,"show_in_summary":true,"is_categorical":true},
          {"name":"track","type":"string","required":true,"show_in_summary":true},
          {"name":"album","type":"string","required":false}
        ]}
      $json$::jsonb)
    ON CONFLICT (name) DO NOTHING;
    -- screentime type: time-span activity for merged categorized screen time.
    -- show_on_timeline=false because screentime is rendered on its own
    -- dedicated track, not the main activity lane. category_path is stored
    -- as joined string so chart breakdowns by the field just work.
    INSERT INTO activity_type_definitions (name, display_name, display_category, color, icon, is_builtin, show_on_timeline, data_schema) VALUES
      ('screentime', 'Screen Time', 'productivity', '#64748b', '💻', true, false, $json$
        {"fields":[
          {"name":"category_path","type":"string","required":true,"show_in_summary":true,"is_categorical":true},
          {"name":"score","type":"number","required":false,"show_in_summary":true,"unit":""}
        ]}
      $json$::jsonb)
    ON CONFLICT (name) DO NOTHING;
    -- location_visit type: time-span activity for a visit to an opted-in
    -- named location. Rendered on the dedicated location track (show_on_timeline=false).
    INSERT INTO activity_type_definitions (name, display_name, display_category, color, icon, is_builtin, show_on_timeline, data_schema) VALUES
      ('location_visit', 'Location Visit', 'travel', '#0ea5e9', '📍', true, false, $json$
        {"fields":[
          {"name":"location_name","type":"string","required":true,"show_in_summary":true,"is_categorical":true},
          {"name":"lat","type":"number","required":false},
          {"name":"lon","type":"number","required":false}
        ]}
      $json$::jsonb)
    ON CONFLICT (name) DO NOTHING
  `,

  // Deduction rules — automatically create activities from data conditions
  deduction_rules: `
    CREATE TABLE IF NOT EXISTS deduction_rules (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                  VARCHAR(255) NOT NULL,
      enabled               BOOLEAN NOT NULL DEFAULT true,
      priority              INTEGER NOT NULL DEFAULT 0,
      conditions            JSONB NOT NULL,
      output_activity_type  VARCHAR(100) NOT NULL REFERENCES activity_type_definitions(name) ON UPDATE CASCADE,
      output_title          VARCHAR(255),
      merge_gap_seconds     INTEGER,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  deduction_rules_indexes: `
    CREATE INDEX IF NOT EXISTS idx_deduction_rules_enabled ON deduction_rules (enabled, priority) WHERE enabled = true
  `,

  // Deduction rule run audit log
  deduction_rule_runs: `
    CREATE TABLE IF NOT EXISTS deduction_rule_runs (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id           UUID NOT NULL REFERENCES deduction_rules(id) ON DELETE CASCADE,
      evaluated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      window_start      TIMESTAMPTZ NOT NULL,
      window_end        TIMESTAMPTZ NOT NULL,
      activities_created INTEGER NOT NULL DEFAULT 0,
      duration_ms       INTEGER
    )
  `,
  deduction_rule_runs_indexes: `
    CREATE INDEX IF NOT EXISTS idx_deduction_rule_runs_rule ON deduction_rule_runs (rule_id, evaluated_at DESC)
  `,

  // Legacy table — kept for migration only, no new data written
  tag_definitions: `
    CREATE TABLE IF NOT EXISTS tag_definitions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(100) NOT NULL,
      icon            TEXT,
      show_on_timeline BOOLEAN NOT NULL DEFAULT true,
      aliases         TEXT[] NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  tag_definitions_indexes: `
    CREATE INDEX IF NOT EXISTS idx_tag_definitions_aliases ON tag_definitions USING GIN (aliases);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_definitions_name ON tag_definitions (lower(name))
  `,

  // Legacy table — kept for migration only, no new data written
  tags: `
    CREATE TABLE IF NOT EXISTS tags (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL,
      external_id     VARCHAR(255),
      tag             VARCHAR(100) NOT NULL,
      tag_key         VARCHAR(255),
      tag_definition_id UUID REFERENCES tag_definitions(id),
      start_time      TIMESTAMPTZ NOT NULL,
      end_time        TIMESTAMPTZ,
      deleted_at      TIMESTAMPTZ,
      CONSTRAINT unique_tag UNIQUE (source, external_id)
    )
  `,
  tags_indexes: `
    CREATE INDEX IF NOT EXISTS idx_tags_time ON tags (start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_tags_tag_time ON tags (tag, start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_tags_tag_key ON tags (tag_key) WHERE tag_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tags_not_deleted ON tags (start_time DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_tags_definition_id ON tags (tag_definition_id) WHERE tag_definition_id IS NOT NULL
  `,
}
