import {
  type JournalContextQuery,
  journalContextQuerySchema,
  type JournalContextResponse,
} from '@aurboda/api-spec'

import { dayKey } from '../services/day-keys.ts'
import { getJournalContext } from '../services/journal-context.ts'
import { getUserTimezone } from '../services/settings.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createJournalContextRouter = (authMiddleware: AnyMiddleware): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, JournalContextResponse, unknown, JournalContextQuery>(
    '/',
    authMiddleware,
    validateQuery(journalContextQuerySchema),
    async (req, res) => {
      const user = req.user!
      const tz = req.query.tz ?? (await getUserTimezone(user))
      const date = req.query.date ?? dayKey(new Date(), tz)
      const context = await getJournalContext(user, date, tz)
      res.json({ data: context ?? { date, items: [] }, success: true })
    },
  )

  return router
}
