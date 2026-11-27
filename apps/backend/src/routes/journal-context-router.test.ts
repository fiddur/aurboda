import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createJournalContextRouter } from './journal-context-router.ts'

vi.mock('../services/journal-context.ts', () => ({ getJournalContext: vi.fn() }))

vi.mock('../services/settings.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserTimezone: vi.fn(async () => 'Europe/Stockholm'),
}))

const journalContext = await import('../services/journal-context.ts')

const buildApp = () => {
  const app = express()
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(createJournalContextRouter(auth) as unknown as express.RequestHandler)
  return app
}

const value = {
  decimals: 0,
  id: 'r',
  kind: 'metric' as const,
  label: 'ŌR',
  name: 'readiness_score',
  suffix: '',
  text: 'ŌR85',
  value: 85,
}

describe('GET /journal-context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('answers the line for the date in the tz asked for', async () => {
    vi.mocked(journalContext.getJournalContext).mockResolvedValue({ date: '2024-03-10', items: [value] })

    const res = await supertest(buildApp()).get('/').query({ date: '2024-03-10', tz: 'UTC' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { date: '2024-03-10', items: [value] }, success: true })
    expect(journalContext.getJournalContext).toHaveBeenCalledWith('tester', '2024-03-10', 'UTC')
  })

  test("defaults to today in the user's timezone, and answers no items when none are configured", async () => {
    vi.mocked(journalContext.getJournalContext).mockResolvedValue(undefined)
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date())

    const res = await supertest(buildApp()).get('/')

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ date: today, items: [] })
    expect(journalContext.getJournalContext).toHaveBeenCalledWith('tester', today, 'Europe/Stockholm')
  })

  test('refuses a malformed date or an unknown tz', async () => {
    expect((await supertest(buildApp()).get('/').query({ date: '2024-13-40' })).status).toBe(400)
    expect((await supertest(buildApp()).get('/').query({ tz: 'Nowhere/Else' })).status).toBe(400)
    expect(journalContext.getJournalContext).not.toHaveBeenCalled()
  })
})
