import { json } from 'body-parser'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { addDays, subDays } from 'date-fns'
import { Client } from 'pg'
import format from 'pg-format'
import polka from 'polka'
import { getHcData, getLocations, loginToUserDb, makeNewUserDb, query, tableExists } from './db'
import { ouraClient } from './oura'
import { rescuetimeClient } from './rescuetime'
import { getTimeline } from './ui'

const formatValue = (v: unknown): string =>
  Array.isArray(v)
    ? `'{ "${v.join('","')}" }'`
    : typeof v === 'number'
      ? String(v)
      : typeof v === 'boolean'
        ? String(v)
        : v === null
          ? 'NULL'
          : typeof v === 'string'
            ? `'${(v as string).replaceAll("'", "''")}'`
            : `'${JSON.stringify(v).replaceAll("'", "''")}'`

const main = async () => {
  const config = {
    sessionSalt: 'very very secretvery very secret', //  256-bit encryption key (32 bytes)
  }

  const oura = ouraClient(process.env.OURA_CLIENT, process.env.OURA_SECRET)

  const iv = randomBytes(12).toString('base64')
  const cipher = createCipheriv('aes-256-gcm', config.sessionSalt, iv)

  const httpd = polka()

  const getUsernameFromSession = (sessid: string) => {
    try {
      if (!sessid) throw new Error('unauthenticated')
      const [encrypted, iv, tag] = sessid.split('-')
      const decipher = createDecipheriv('aes-256-gcm', config.sessionSalt, iv)
      decipher.setAuthTag(Buffer.from(tag, 'base64'))
      return decipher.update(encrypted, 'base64', 'utf8') + decipher.final('utf8')
    } catch (e) {
      console.error(e)
      throw new Error('unauthenticated')
    }
  }

  const userDb = new Client({ database: 'postgres' })
  await userDb.connect()

  httpd.use(json({ limit: '10mb' }))

  httpd.use((req, res, next) => {
    console.log(req.path, req.body)
    next()
  })

  httpd.post('/api/v2/login', async (req, res, next) => {
    const { username: user, password } = req.body

    // Check if user exists as a PSQL user role
    const userRows = await query(userDb, 'SELECT usename FROM pg_user WHERE usename=$1', [user])
    if (userRows.rowCount === 1) {
      try {
        await loginToUserDb(user, password)
      } catch (err) {
        console.log(err)
        const unauthorized = new Error('Unauthorized')
        unauthorized.status = 401
        return next(unauthorized)
      }
    } else {
      await makeNewUserDb(userDb, user, password)
    }

    const token =
      cipher.update(user, 'utf8', 'base64') +
      cipher.final('base64') +
      `-${iv}-${cipher.getAuthTag().toString('base64')}`

    res.status = 201
    res.end(JSON.stringify({ token, refresh: token }))
  })

  httpd.post('/api/v2/refresh', async (req, res, next) => {
    const { refresh } = req.body
    res.end(JSON.stringify({ token: refresh, refresh }))
  })

  httpd.post('/api/v2/sync/:recordType', async (req, res) => {
    const { recordType } = req.params
    const token = req.headers.authorization.slice('bearer '.length)
    console.log({ token })
    let { data } = req.body

    if (!Array.isArray(data) && typeof data === 'object' && Object.entries(data).length) {
      data = [data]
    }

    if (!data?.length) {
      console.log('  empty?!')

      const ignore = [
        'BasalBodyTemperature', ///
        'BloodGlucose',
        'BloodPressure',
        'BasalMetabolicRate',
        'BodyFat',
        'BodyTemperature', ///
        'BoneMass', ///
        'CyclingPedalingCadence',
        'CervicalMucus',
        'ElevationGained',
        'FloorsClimbed',
        'Height', //
        'Hydration',
        'LeanBodyMass', ///
        'MenstruationFlow',
        'MenstruationPeriod',
        'Nutrition', ////
        'OvulationTest',
        'OxygenSaturation',
        'Power',
        'RespiratoryRate', ////
        'RestingHeartRate', ////
        'StepsCadence', ///
        'Vo2Max', ///
        'Weight', //
        'WheelchairPushes',
      ]
      if (ignore.includes(recordType)) return res.end('{"success":true}')

      res.statusCode = 500
      //process.exit(1)
      return res.end('{"success":false}')
    }

    const user = getUsernameFromSession(token)

    if (!tableExists(user, 'hcdata')) {
      await query(
        user,
        `CREATE TABLE "hcdata" (
          id           VARCHAR PRIMARY KEY,
          "recordType" VARCHAR,
          metadata     JSONB,
          app          VARCHAR,
          time         TIMESTAMPTZ,
          "startTime"  TIMESTAMPTZ,
          "endTime"    TIMESTAMPTZ,
          data         JSONB
        )`,
      )
    }

    for (const item of data) {
      const id = item.metadata.id
      const { metadata, time, startTime, endTime, ...dataObj } = item
      const dataTuples = Object.entries({
        id,
        recordType,
        metadata,
        time,
        startTime,
        endTime,
        data: dataObj,
      }).filter(([_, v]) => !!v)

      await query(
        user,
        `
        INSERT INTO "hcdata"
          (${dataTuples.map(([k]) => `"${k}"`).join(',')})
         VALUES(${dataTuples
           .map(([, v]) => v)
           .map(formatValue)
           .join(',')})
         ON CONFLICT (id) DO UPDATE SET
            ${dataTuples
              .filter(([k]) => k !== 'id')
              .map(([k, v]) => `"${k}" = ${formatValue(v)}`)
              .join(' , ')}
      `,
      ) // TODO use db params
    }

    res.end('{"success":true}')
  })

  httpd.get('/auth/connectOura', oura.redirectToAuthorize)
  httpd.get('/auth/ouracb', oura.authCb)

  httpd.post('/ownTracks', async (req, res) => {
    const { topic, _id: id, _type: type } = req.body

    const user = topic.split('/')[1]

    if (type === 'status') {
    } else if (type === 'waypoint') {
      if (!tableExists(user, 'waypoints')) {
        await query(
          user,
          `CREATE TABLE "waypoints" (
          id       VARCHAR PRIMARY KEY,
          name     VARCHAR,
          tst      TIMESTAMPTZ,
          location GEOGRAPHY(POINT, 4326),
          rad      INTEGER,
          rid      VARCHAR
        )`,
        )
      }

      const { lat, lon, tst, desc, rad, rid } = req.body
      await query(
        user,
        format(
          'INSERT INTO "waypoints" (id,name,tst,location,rad,rid) VALUES(%L, %L, %L, ST_MakePoint(%L, %L), %L, %L) ON CONFLICT (id) DO NOTHING',
          id,
          desc,
          new Date(tst * 1000).toISOString(),
          lon,
          lat,
          rad,
          rid,
        ),
      )
    } else if (type === 'location') {
      if (!tableExists(user, 'owntracks')) {
        await query(
          db,
          `CREATE TABLE "owntracks" (
             id        VARCHAR PRIMARY KEY,
             tst       TIMESTAMPTZ,
             location  GEOGRAPHY(POINT, 4326),
             inregions VARCHAR[]
           )`,
        )
      }

      const { lat, lon, tst, inregions } = req.body
      await query(
        user,
        format(
          'INSERT INTO "owntracks" (id,tst,location,inregions) VALUES(%L, %L, ST_MakePoint(%L, %L), array[%L]) ON CONFLICT (id) DO NOTHING',
          id,
          new Date(tst * 1000).toISOString(),
          lon,
          lat,
          inregions,
        ),
      )
    }

    res.end(`[]`)
  })

  httpd.get('/dump', async (req, res) => {
    const { username: user } = req.query

    const now = new Date()
    const start = subDays(now, 8)
    const end = addDays(now, 1)

    const { locations, places } = getLocations(start, end, user)

    const access_token = await oura.getAccessToken(user)

    const hcData = await getHcData(start, end, user)
    const rtData = await rescuetimeClient(process.env.RESCUETIME_KEY).getIntervalData(start, end)

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="dump-${now.toISOString()}.json"`,
    })
    res.end(
      JSON.stringify({
        ...hcData,
        locations,
        places,
        rtData,
        tags: await oura.getTags(start, end, access_token),
        sessions: await oura.getSessions(start, end, access_token),
        dailySleep: await oura.getDailySleep(start, end, access_token),
        dailyResilience: await oura.getDailyResilience(start, end, access_token),
        dailyReadiness: await oura.getDailyReadiness(start, end, access_token),
        dailyCardiovascularAge: await oura.getDailyCardiovascularAge(start, end, access_token),
      }),
    )
  })

  httpd.get('/ui/timeline', async (req, res) => {
    const html = await getTimeline(oura)
    res.end(html)
  })

  httpd.listen(80, () => {
    console.log(`> Running on localhost:80`)
  })
}

main()
