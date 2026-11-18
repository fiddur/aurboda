export const remindersTables: Record<string, string> = {
  reminders: `
    CREATE TABLE IF NOT EXISTS reminders (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title       TEXT NOT NULL,
      body        TEXT,
      link        TEXT,
      time_of_day TEXT NOT NULL,
      weekdays    SMALLINT[] NOT NULL,
      enabled     BOOLEAN NOT NULL DEFAULT true,
      not_before  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
}
