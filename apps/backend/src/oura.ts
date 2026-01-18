import axios from 'axios'
import { addDays, addSeconds, formatISO, isAfter, isBefore, isFuture } from 'date-fns'
import { Request, Response } from 'express'
import { getOAuthToken, initializeSchema, schemaInitialized, Tag, upsertOAuthToken } from './db'

type OuraTag = {
  id: string
  tag_type_code: string | null
  start_time: string
  end_time: string
  custom_name: string | null
}

type OuraSession = {
  id: string
  end_datetime: string
  start_datetime: string
  type: string
  heart_rate: unknown
  heart_rate_variability: unknown
  mood: string
  motion_count: unknown
}

export const ouraClient = (client: string, secret: string) => {
  if (!client || !secret) throw new Error('Oura missing client or secret')

  const getGeneric = async (type: string, start: Date, end: Date, token: string) => {
    const response = await axios.get(
      `https://api.ouraring.com/v2/usercollection/${type}?start_date=${formatISO(start, { representation: 'date' })}&end_date=${formatISO(addDays(end, 1), { representation: 'date' })}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    console.log(type, start, end, response.data)
    return response.data.data
  }

  return {
    async authCb(req: Request, res: Response) {
      console.log(req.query)
      const { code, scope, state, error } = req.query as Record<string, string | undefined>

      if (error) {
        res.statusCode = 500
        return res.end('{"success":false}')
      }

      const user = state as string

      // Ensure schema is initialized for this user
      if (!(await schemaInitialized(user))) {
        await initializeSchema(user)
      }

      const tokenUrl = new URL('https://cloud.ouraring.com/oauth/token')
      tokenUrl.searchParams.append('grant_type', 'authorization_code')
      tokenUrl.searchParams.append('client_id', client)
      tokenUrl.searchParams.append('client_secret', secret)
      tokenUrl.searchParams.append('code', code as string)
      tokenUrl.searchParams.append('redirect_uri', 'http://valhall/auth/ouracb') // TODO config

      const response = await axios.post(tokenUrl.toString())
      console.log(response.data)

      const { access_token, refresh_token, expires_in } = response.data

      await upsertOAuthToken(user, {
        accessToken: access_token,
        expiresAt: addSeconds(new Date(), expires_in),
        provider: 'oura',
        refreshToken: refresh_token,
        scopes: scope ? scope.split(' ') : undefined,
      })

      res.end()
    },

    async getAccessToken(user: string) {
      const token = await getOAuthToken(user, 'oura')
      if (!token) throw new Error('User has no Oura OAuth token')

      // Return token if not expired (with 100 second buffer)
      if (token.expiresAt && isFuture(addSeconds(token.expiresAt, -100))) {
        return token.accessToken
      }

      // Refresh the token
      const tokenUrl = new URL('https://cloud.ouraring.com/oauth/token')
      tokenUrl.searchParams.append('grant_type', 'refresh_token')
      tokenUrl.searchParams.append('refresh_token', token.refreshToken!)
      tokenUrl.searchParams.append('client_id', client)
      tokenUrl.searchParams.append('client_secret', secret)

      const response = await axios.post(tokenUrl.toString())
      console.log(response.data)
      const { access_token, refresh_token, expires_in } = response.data

      await upsertOAuthToken(user, {
        accessToken: access_token,
        expiresAt: addSeconds(new Date(), expires_in),
        provider: 'oura',
        refreshToken: refresh_token,
      })

      return access_token
    },

    async getDailyCardiovascularAge(start: Date, end: Date, token: string) {
      return (await getGeneric('daily_cardiovascular_age', start, end, token)).filter(
        ({ timestamp }: { timestamp: string }) => isBefore(timestamp, end) && isAfter(timestamp, start),
      )
    },

    async getDailyReadiness(start: Date, end: Date, token: string) {
      return (await getGeneric('daily_readiness', start, end, token)).filter(
        ({ timestamp }: { timestamp: string }) => isBefore(timestamp, end) && isAfter(timestamp, start),
      )
    },

    async getDailyResilience(start: Date, end: Date, token: string) {
      return (await getGeneric('daily_resilience', start, end, token)).filter(
        ({ timestamp }: { timestamp: string }) => isBefore(timestamp, end) && isAfter(timestamp, start),
      )
    },

    async getDailySleep(start: Date, end: Date, token: string) {
      return (await getGeneric('daily_sleep', start, end, token)).filter(
        ({ timestamp }: { timestamp: string }) => isBefore(timestamp, end) && isAfter(timestamp, start),
      )
    },
    async getSessions(start: Date, end: Date, token: string) {
      // id: 'ab6b5798-2ecf-41cd-a0dc-7974796e49a4',
      // day: '2025-09-06',
      // start_datetime: '2025-09-06T15:49:27+02:00',
      // end_datetime: '2025-09-06T16:18:45+02:00',
      // type: 'meditation',
      // heart_rate: {    interval: 5,    items: [...
      // heart_rate_variability: {    interval: 5,    items: [
      // mood: 'good',
      // motion_count: {    interval: 5,    items: [
      const sessions = ((await getGeneric('session', start, end, token)) as OuraSession[])
        .map((session) => ({
          endTime: new Date(session.end_datetime),
          heartRate: session.heart_rate,
          hrv: session.heart_rate_variability,
          id: session.id,
          mood: session.mood,
          motion: session.motion_count,
          startTime: new Date(session.start_datetime),
          type: session.type,
        }))
        .filter(({ startTime, endTime }) => isBefore(startTime, end) && isAfter(endTime, start))

      return sessions
    },
    async getTags(start: Date, end: Date, token: string): Promise<Tag[]> {
      const customTags: Record<string, string> = {
        '067e2862-8cf8-4307-a621-0636dd379cda': 'Hot Chocolate',
        '4ddc8bc2-911d-467d-8c9d-dac2ece87d0a': 'YinYoga',
        '662ad09c-0998-4f0c-aad9-867c883dfdaa': 'Electrolytes',
        'f830b90b-0689-42a1-bfe7-ea1b4487d0c3': 'Food',
      }

      const data: OuraTag[] = await getGeneric('enhanced_tag', start, end, token)
      const tags = data
        .map(
          (tag): Tag => ({
            endTime: tag.end_time ? new Date(tag.end_time) : undefined,
            externalId: tag.id,
            source: 'oura',
            startTime: new Date(tag.start_time),
            tag:
              tag.tag_type_code && tag.tag_type_code in customTags ?
                customTags[tag.tag_type_code]
              : tag.tag_type_code || 'unknown',
          }),
        )
        .filter(({ startTime, endTime }) => isBefore(startTime, end) && (!endTime || isAfter(endTime, start)))
      return tags
    },
    redirectToAuthorize(req: Request, res: Response) {
      const { username } = req.query as Record<string, string | undefined>
      if (!username) {
        res.statusCode = 400
        res.end('No username')
        return
      }

      const location = new URL('https://cloud.ouraring.com/oauth/authorize')
      location.searchParams.append('response_type', 'code')
      location.searchParams.append('client_id', client)
      location.searchParams.append('redirect_uri', 'http://valhall/auth/ouracb')
      location.searchParams.append('state', username)
      res.writeHead(302, {
        'Content-Length': 0,
        'Content-Type': 'text/plain',
        Location: location.toString(),
      })
      res.end()
    },
  }
}
