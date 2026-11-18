import {
  type AddReminderBody,
  addReminderBodySchema,
  type BaseResponse,
  type ReminderResponse,
  type RemindersResponse,
  type UpdateReminderBody,
  updateReminderBodySchema,
} from '@aurboda/api-spec'

import {
  addReminder,
  deleteReminderById,
  listRemindersView,
  type ReminderDeps,
  reminderDeps,
  updateReminderById,
} from '../services/reminders.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createRemindersRouter = (
  authMiddleware: AnyMiddleware,
  deps: ReminderDeps = reminderDeps,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, RemindersResponse>('/', authMiddleware, async (req, res) => {
    res.json({ ...(await listRemindersView(deps, req.user!)), success: true })
  })

  router.post<Record<string, never>, ReminderResponse, AddReminderBody>(
    '/',
    authMiddleware,
    validateBody(addReminderBodySchema),
    async (req, res) => {
      res.json({ reminder: await addReminder(deps, req.user!, req.body), success: true })
    },
  )

  router.patch<{ id: string }, ReminderResponse, UpdateReminderBody>(
    '/:id',
    authMiddleware,
    validateBody(updateReminderBodySchema),
    async (req, res) => {
      const reminder = await updateReminderById(deps, req.user!, req.params.id, req.body)
      if (!reminder) return res.status(404).json({ error: 'Reminder not found', success: false })
      res.json({ reminder, success: true })
    },
  )

  router.delete<{ id: string }, BaseResponse>('/:id', authMiddleware, async (req, res) => {
    if (!(await deleteReminderById(deps, req.user!, req.params.id))) {
      return res.status(404).json({ error: 'Reminder not found', success: false })
    }
    res.json({ success: true })
  })

  return router
}
