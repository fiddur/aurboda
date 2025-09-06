import axios from 'axios'
import { addSeconds, formatISO, isFuture, isPast } from 'date-fns'
import format from 'pg-format'
import { query, tableExists } from './db'

export const ouraClient = (client: string, secret: string) => {
  if (!client || !secret) throw new Error('Oura missing client or secret')

  const getGeneric = async (type: string, start: Date, end: Date, token: string) => {
    const response = await axios.get(
      `https://api.ouraring.com/v2/usercollection/${type}?start_date=${formatISO(start, { representation: 'date' })}&end_date=${formatISO(end, { representation: 'date' })}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    console.log(type, start, end, response.data)
    return response.data.data
  }

  return {
    redirectToAuthorize(req, res) {
      const { username } = req.query
      if (!username) {
        res.status = 400
        res.end('No username')
        return
      }

      const location = new URL('https://cloud.ouraring.com/oauth/authorize')
      location.searchParams.append('response_type', 'code')
      location.searchParams.append('client_id', client)
      location.searchParams.append('redirect_uri', 'http://valhall/auth/ouracb')
      location.searchParams.append('state', username)
      res.writeHead(302, {
        Location: location.toString(),
        'Content-Type': 'text/plain',
        'Content-Length': 0,
      })
      res.end()
    },

    async authCb(req, res) {
      console.log(req.query)
      const { code, scope, state, error } = req.query

      if (error) {
        res.statusCode = 500
        return res.end('{"success":false}')
      }

      const user = state

      if (!tableExists(user, 'ouraauth')) {
        await query(
          user,
          `CREATE TABLE "ouraauth" (
          access_token   VARCHAR,
          refresh_token  VARCHAR,
          expires_in     INTEGER,
          time           TIMESTAMPTZ
        )`,
        )
      }

      const tokenUrl = new URL('https://cloud.ouraring.com/oauth/token')
      tokenUrl.searchParams.append('grant_type', 'authorization_code')
      tokenUrl.searchParams.append('client_id', client)
      tokenUrl.searchParams.append('client_secret', secret)
      tokenUrl.searchParams.append('code', code)
      tokenUrl.searchParams.append('redirect_uri', 'http://valhall/auth/ouracb') // TODO config

      const response = await axios.post(tokenUrl.toString())
      console.log(response.data)

      const { access_token, refresh_token, expires_in } = response.data

      await query(
        user,
        format(
          'INSERT INTO "ouraauth" (access_token,refresh_token,expires_in,time) VALUES(%L, %L, %L, CURRENT_TIMESTAMP)',
          access_token,
          refresh_token,
          expires_in,
        ),
      )

      res.end()
    },

    async getAccessToken(user: string) {
      const { rows } = await query(user, 'SELECT * FROM ouraauth ORDER BY time DESC LIMIT 1')
      if (!rows) throw new Error('User has no ouraauth')

      console.log(addSeconds(new Date(rows[0].time), rows[0].expires_in - 100))
      console.log(isPast(addSeconds(new Date(rows[0].time), rows[0].expires_in - 100)))

      if (isFuture(addSeconds(new Date(rows[0].time), rows[0].expires_in - 100))) return rows[0].access_token
      const tokenUrl = new URL('https://cloud.ouraring.com/oauth/token')
      tokenUrl.searchParams.append('grant_type', 'refresh_token')
      tokenUrl.searchParams.append('refresh_token', rows[0].refresh_token)
      tokenUrl.searchParams.append('client_id', client)
      tokenUrl.searchParams.append('client_secret', secret)

      const response = await axios.post(tokenUrl.toString())
      console.log(response.data)
      const { access_token, refresh_token, expires_in } = response.data
      await query(
        user,
        format(
          'INSERT INTO "ouraauth" (access_token,refresh_token,expires_in,time) VALUES(%L, %L, %L, CURRENT_TIMESTAMP)',
          access_token,
          refresh_token,
          expires_in,
        ),
      )
      return access_token
    },

    async getTags(
      start: Date,
      end: Date,
      token: string,
    ): Promise<{ tag: string; startTime: Date; endTime?: Date }[]> {
      const customTags = {
        'f830b90b-0689-42a1-bfe7-ea1b4487d0c3': 'Food',
        '067e2862-8cf8-4307-a621-0636dd379cda': 'Hot Chocolate',
        '4ddc8bc2-911d-467d-8c9d-dac2ece87d0a': 'YinYoga',
        '662ad09c-0998-4f0c-aad9-867c883dfdaa': 'Electrolytes',
      }

      const data = await getGeneric('enhanced_tag', start, end, token)
      const tags = data.map((tag) => ({
        tag: tag.tag_type_code in customTags ? customTags[tag.tag_type_code] : tag.tag_type_code,
        startTime: new Date(tag.start_time),
        endTime: new Date(tag.end_time),
      }))
      return tags
    },

    async getSessions(start: Date, end: Date, token: string) {
      return getGeneric('session', start, end, token)
    },

    async getDailySleep(start: Date, end: Date, token: string) {
      return getGeneric('daily_sleep', start, end, token)
    },
    async getDailyResilience(start: Date, end: Date, token: string) {
      return getGeneric('daily_resilience', start, end, token)
    },
    async getDailyReadiness(start: Date, end: Date, token: string) {
      return getGeneric('daily_readiness', start, end, token)
    },
    async getDailyCardiovascularAge(start: Date, end: Date, token: string) {
      return getGeneric('daily_cardiovascular_age', start, end, token)
    },
  }
}
