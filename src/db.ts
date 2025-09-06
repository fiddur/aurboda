import { Client } from 'pg'
import format from 'pg-format'

const dbByUser: Record<string, Client> = {}

const userDbName = (user: string) => `hcg-${user}`

export const query = async (dbOrUser: Client | string, queryStr: string, params?: any[]) => {
  const db = typeof dbOrUser === 'string' ? await getDbForUser(dbOrUser) : dbOrUser
  console.log(`>>>`, queryStr, params)
  const result = await db.query(queryStr, params)
  //console.log('<<<', result.rows)
  return result
}

export const loginToUserDb = async (user: string, password: string) => {
  // try logging in as this user in postgresql
  const database = userDbName(user)
  dbByUser[user] = new Client({ database, password, user })
  await dbByUser[user].connect()
}

export const makeNewUserDb = async (userDb: Client, user: string, password: string) => {
  const database = userDbName(user)
  console.log('New user ${user}')
  // Sign up a psql user
  await query(userDb, format('CREATE USER %I WITH ENCRYPTED PASSWORD %L', user, password))
  await query(userDb, format('GRANT %I TO %I', user, process.env.PGUSER))
  await query(userDb, format('CREATE DATABASE %I OWNER %I', database, user))
  dbByUser[user] = new Client({ database, password, user })
  await dbByUser[user].connect()
}

export const getDbForUser = async (user: string) => {
  // Since the service could be restarted since the user logged in, we'll make new connections
  if (dbByUser[user]) return dbByUser[user]
  dbByUser[user] = new Client({ database: userDbName(user) })
  await dbByUser[user].connect()
  await query(dbByUser[user], format('SET ROLE %L', user))
  return dbByUser[user]
}

export const tableExists = async (user: string, table: string) => {
  const database = userDbName(user)
  const db = await getDbForUser(user)
  const tableExists = await query(
    db,
    `SELECT 1 FROM information_schema.tables WHERE table_catalog = $1 AND table_name = $2`,
    [database, table],
  )
  return tableExists.rowCount !== 0
}

export const getLocations = async (start: Date, end: Date, user: string) => {
  const { rows: locationRows } = await query(
    user,
    format(
      `SELECT tst, ST_AsGeoJSON(location) AS location, inregions
       FROM owntracks o
       WHERE tst > %L AND tst < %L
       ORDER BY tst`,
      start.toISOString(),
      end.toISOString(),
    ),
  )

  const locations = locationRows.map(({ tst, location, inregions }) => [
    tst,
    JSON.parse(location).coordinates,
    inregions,
  ])

  const places = locations.reduce<{ region: string; startTime: Date; endTime: Date }>(
    (acc, [tst, , inregions]) => {
      const region = inregions?.[0] || 'Somewhere'

      if (acc.at(-1)?.region === region)
        return [
          ...acc.slice(0, acc.length - 1),
          {
            ...acc.at(-1),
            endTime: tst,
          },
        ]

      return [...acc, { region, startTime: tst, endTime: tst }]
    },
    [],
  )

  return { locations, places }
}

export const getHcData = async (start: Date, end: Date, user: string) => {
  const hcdata = await query(
    user,
    format(
      `
      SELECT distinct h."recordType", h.data, h.metadata, h.time, h."startTime", h."endTime"
      FROM public.hcdata AS h
      WHERE (h."startTime" > %L or h."time" > %L) OR (h."startTime" > %L or h."time" > %L)
      `,
      start.toISOString(),
      start.toISOString(),
      end.toISOString(),
      end.toISOString(),
    ),
  )

  let heartrateSamples: { time: string; beatsPerMinute: number }[] = []

  const types = {
    HeartRate: 'heartRates',
    HeartRateRecord: 'heartRates',
    ExerciseSession: 'exerciseSessions',
    ExerciseSessionRecord: 'exerciseSessions',
    SleepSession: 'sleepSessions',
    SleepSessionRecord: 'sleepSessions',
  }

  const hcData = hcdata.rows.reduce(
    (acc, { recordType: rType, startTime, time, endTime, metadata, data }) => {
      const recordType = types[rType] || rType
      if (recordType === 'heartRates') {
        heartrateSamples.push(...data.samples)
        return acc
      }
      return {
        ...acc,
        [recordType]: [
          ...(acc[recordType] || []),
          {
            ...data,
            startTime: new Date(startTime || time),
            endTime: endTime && new Date(endTime),
            metadata,
          },
        ],
      }
    },
    {
      exerciseSessions: [],
      sleepSessions: [],
    },
  )

  console.log(Object.keys(hcData))

  const heartRates: [Date, number][] = heartrateSamples
    .map<[Date, number]>(({ time, beatsPerMinute }) => [new Date(time), beatsPerMinute])
    .sort(([a], [b]) => a.getTime() - b.getTime())

  return { heartRates, ...hcData } as {
    heartRates: [Date, number][]
    [k: string]: {
      [k: string]: any
      startTime: Date
      endTime?: Date
      metadata: object
    }[]
  }
}
