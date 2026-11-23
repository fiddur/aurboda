export const peopleTables: Record<string, string> = {
  // `actor_handle`, `actor_name`, `actor_icon` are a presentation cache of the account at
  // `actor_uri`, never its identity: reads prefer the follow row and the timeline.
  people: `
    CREATE TABLE IF NOT EXISTS people (
      id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                        TEXT NOT NULL,
      relationship                TEXT,
      birth_month                 SMALLINT,
      birth_day                   SMALLINT,
      birth_year                  SMALLINT,
      birthday_notify_days_before SMALLINT,
      pronouns                    TEXT,
      actor_uri                   TEXT,
      actor_handle                TEXT,
      actor_name                  TEXT,
      actor_icon                  TEXT,
      actor_cached_at             TIMESTAMPTZ,
      archived                    BOOLEAN NOT NULL DEFAULT false,
      deleted_at                  TIMESTAMPTZ,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  people_indexes: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_people_live_actor ON people (actor_uri)
      WHERE actor_uri IS NOT NULL AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_people_deleted_at ON people (deleted_at) WHERE deleted_at IS NOT NULL
  `,
  person_dates: `
    CREATE TABLE IF NOT EXISTS person_dates (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      person_id          UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      label              TEXT NOT NULL,
      kind               TEXT NOT NULL,
      month              SMALLINT NOT NULL,
      day                SMALLINT NOT NULL,
      year               SMALLINT,
      notify_days_before SMALLINT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  person_dates_indexes: `
    CREATE INDEX IF NOT EXISTS idx_person_dates_person ON person_dates (person_id)
  `,
  activity_people: `
    CREATE TABLE IF NOT EXISTS activity_people (
      activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      person_id   UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      PRIMARY KEY (activity_id, person_id)
    )
  `,
  activity_people_indexes: `
    CREATE INDEX IF NOT EXISTS idx_activity_people_person ON activity_people (person_id)
  `,
  rule_activity_people: `
    CREATE TABLE IF NOT EXISTS rule_activity_people (
      rule_id     UUID NOT NULL REFERENCES deduction_rules(id) ON DELETE CASCADE,
      activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      person_id   UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      added       BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (rule_id, activity_id, person_id)
    )
  `,
  rule_activity_people_indexes: `
    CREATE INDEX IF NOT EXISTS idx_rule_activity_people_activity ON rule_activity_people (activity_id, person_id)
  `,
}
