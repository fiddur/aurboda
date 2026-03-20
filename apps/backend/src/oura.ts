import type { Request, Response } from 'express'

import axios from 'axios'
import { addDays, addSeconds, formatISO, isAfter, isBefore, isFuture } from 'date-fns'

import { getOAuthToken, initializeSchema, schemaInitialized, type Tag, upsertOAuthToken } from './db/index.ts'

/** Tag with optional Oura comment, used during sync processing. */
export type OuraTagWithComment = Tag & { comment?: string }

type OuraTag = {
  id: string
  tag_type_code: string | null
  start_time: string
  end_time: string
  custom_name: string | null
  comment: string | null
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

/** Raw Oura sleep period record from /v2/usercollection/sleep */
export type OuraSleepPeriodRaw = {
  id: string
  type: string // 'long_sleep' | 'sleep' | 'rest'
  bedtime_start: string
  bedtime_end: string
  sleep_phase_5_min: string | null
  heart_rate: { interval: number; items: (number | null)[] } | null
  heart_rate_variability: { interval: number; items: (number | null)[] } | null
  average_hrv: number | null
  lowest_heart_rate: number | null
  average_heart_rate: number | null
  readiness_score_delta: number | null
  day: string
}

export interface OuraClientOptions {
  onUserAuthenticated?: (ouraUserId: string, username: string) => Promise<void>
}

export const ouraClient = (client: string, secret: string, webHost: string, options?: OuraClientOptions) => {
  if (!client || !secret) throw new Error('Oura missing client or secret')
  const redirectUri = `${webHost}/auth/ouracb`

  const getGeneric = async (type: string, start: Date, end: Date, token: string) => {
    const response = await axios.get(
      `https://api.ouraring.com/v2/usercollection/${type}?start_date=${formatISO(start, { representation: 'date' })}&end_date=${formatISO(addDays(end, 1), { representation: 'date' })}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    console.log(type, start, end, response.data)
    return response.data.data
  }

  const getPersonalInfo = async (accessToken: string): Promise<{ id: string } | null> => {
    try {
      const response = await axios.get('https://api.ouraring.com/v2/usercollection/personal_info', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return response.data
    } catch (error) {
      console.error('Failed to fetch Oura personal info:', error instanceof Error ? error.message : error)
      return null
    }
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
      tokenUrl.searchParams.append('redirect_uri', redirectUri)

      const response = await axios.post(tokenUrl.toString())
      console.log(response.data)

      const { access_token, refresh_token, expires_in } = response.data

      await upsertOAuthToken(user, {
        access_token,
        expires_at: addSeconds(new Date(), expires_in),
        provider: 'oura',
        refresh_token,
        scopes: scope ? scope.split(' ') : undefined,
      })

      // Store Oura user ID mapping for webhook notifications
      if (options?.onUserAuthenticated) {
        const personalInfo = await getPersonalInfo(access_token)
        if (personalInfo?.id) {
          await options.onUserAuthenticated(personalInfo.id, user)
          console.log(`Stored Oura user mapping: ${personalInfo.id} -> ${user}`)
        }
      }

      res.end()
    },

    async getAccessToken(user: string) {
      const token = await getOAuthToken(user, 'oura')
      if (!token) throw new Error('User has no Oura OAuth token')

      // Return token if not expired (with 100 second buffer)
      if (token.expires_at && isFuture(addSeconds(token.expires_at, -100))) {
        return token.access_token
      }

      // Refresh the token
      const tokenUrl = new URL('https://cloud.ouraring.com/oauth/token')
      tokenUrl.searchParams.append('grant_type', 'refresh_token')
      tokenUrl.searchParams.append('refresh_token', token.refresh_token!)
      tokenUrl.searchParams.append('client_id', client)
      tokenUrl.searchParams.append('client_secret', secret)

      const response = await axios.post(tokenUrl.toString())
      console.log(response.data)
      const { access_token, refresh_token, expires_in } = response.data

      await upsertOAuthToken(user, {
        access_token,
        expires_at: addSeconds(new Date(), expires_in),
        provider: 'oura',
        refresh_token,
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

    async getSleep(start: Date, end: Date, token: string): Promise<OuraSleepPeriodRaw[]> {
      const data = (await getGeneric('sleep', start, end, token)) as OuraSleepPeriodRaw[]
      return data.filter(
        ({ bedtime_start, bedtime_end }) => isBefore(bedtime_start, end) && isAfter(bedtime_end, start),
      )
    },
    async getTags(
      start: Date,
      end: Date,
      token: string,
      tagMappings?: Record<string, string>,
    ): Promise<OuraTagWithComment[]> {
      const data: OuraTag[] = await getGeneric('enhanced_tag', start, end, token)
      const tags = data
        .map(
          (tag): OuraTagWithComment => ({
            comment: tag.comment ?? undefined,
            end_time: tag.end_time ? new Date(tag.end_time) : undefined,
            external_id: tag.id,
            source: 'oura',
            start_time: new Date(tag.start_time),
            tag:
              tag.tag_type_code && tagMappings && tag.tag_type_code in tagMappings
                ? tagMappings[tag.tag_type_code]
                : tag.custom_name || tag.tag_type_code || 'unknown',
            tag_key: tag.tag_type_code ?? undefined,
          }),
        )
        .filter(
          ({ start_time, end_time }) => isBefore(start_time, end) && (!end_time || isAfter(end_time, start)),
        )
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
      location.searchParams.append('redirect_uri', redirectUri)
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
