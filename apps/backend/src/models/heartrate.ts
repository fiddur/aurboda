import { addHours, subHours } from 'date-fns'
import format from 'pg-format'
import { HcData, query, tableExists } from '../db'
import { ouraClient } from '../oura'

export type HeartRate = {
  time: Date
  bpm: number
  source: string
}

const migrate = async (user: string) => {
  if (!(await tableExists(user, 'heartrates'))) {
    await query(
      user,
      `CREATE TABLE heartrates (
        time   TIMESTAMPTZ PRIMARY KEY,
        bpm    SMALLINT,
        source VARCHAR
      )`,
    )
  }
  const hcdata = await query<HcData>(
    user,
    `SELECT * FROM public.hcdata WHERE "recordType" IN ('HeartRate','HeartRateRecord')`,
  )
  let hrs: HeartRate[] = []
  hcdata.rows.forEach((row) => {
    hrs.push(
      ...row.data.samples.map(({ time, beatsPerMinute }: { time: string; beatsPerMinute: number }) => ({
        time,
        bpm: beatsPerMinute,
        source: row.metadata.dataOrigin || 'hcdata',
      })),
    )
  })

  addHeartRates(user, hrs)
}

export const getHeartRate = async (
  user: string,
  start: Date,
  end: Date,
  oura: ReturnType<typeof ouraClient>,
) => {
  //await migrate(user)

  const hrResponse = await query<HeartRate>(
    user,
    format(
      `SELECT * FROM heartrates WHERE time BETWEEN %L AND %L ORDER BY time`,
      subHours(start, 1),
      addHours(end, 1),
    ),
  )

  return hrResponse.rows.map((hr) => [hr.time, hr.bpm])
}

export const addHeartRates = async (user: string, hrs: HeartRate[]) => {
  await query(
    user,
    format(
      `INSERT INTO heartrates (time,bpm,source) VALUES %L ON CONFLICT (time) DO NOTHING`,
      hrs.map((hr) => [hr.time, hr.bpm, hr.source]),
    ),
  )
}
