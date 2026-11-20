import {
  type AddCheckInFormBody,
  addCheckInFormBodySchema,
  type CheckInAdherenceQuery,
  checkInAdherenceQuerySchema,
  type CheckInAdherenceResponse,
  type CheckInFormResponse,
  type CheckInFormsQuery,
  checkInFormsQuerySchema,
  type CheckInFormsResponse,
  type CheckInResponse,
  type CheckInsQuery,
  checkInsQuerySchema,
  type CheckInsResponse,
  type CheckInTemplatesResponse,
  type DueQuery,
  dueQuerySchema,
  type DueResponse,
  type SubmitCheckInBody,
  submitCheckInBodySchema,
  type UpdateCheckInBody,
  updateCheckInBodySchema,
  type UpdateCheckInFormBody,
  updateCheckInFormBodySchema,
} from '@aurboda/api-spec'

import {
  addCheckInForm,
  type CheckInDeps,
  checkInDeps,
  deleteCheckInById,
  deleteCheckInFormById,
  getCheckInAdherence,
  getCheckInFormById,
  listCheckInFormsView,
  listCheckInTemplates,
  listDue,
  queryCheckIns,
  restoreCheckInById,
  restoreCheckInFormById,
  submitCheckIn,
  updateCheckInById,
  updateCheckInFormById,
} from '../services/check-ins.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

const FORM_NOT_FOUND = 'Check-in form not found'
const CHECK_IN_NOT_FOUND = 'Check-in not found'

export const createCheckInsRouter = (
  authMiddleware: AnyMiddleware,
  deps: CheckInDeps = checkInDeps,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, CheckInFormsResponse, unknown, CheckInFormsQuery>(
    '/check-in-forms',
    authMiddleware,
    validateQuery(checkInFormsQuerySchema),
    async (req, res) => {
      res.json({ forms: await listCheckInFormsView(deps, req.user!, req.query), success: true })
    },
  )

  router.post<Record<string, never>, CheckInFormResponse, AddCheckInFormBody>(
    '/check-in-forms',
    authMiddleware,
    validateBody(addCheckInFormBodySchema),
    async (req, res) => {
      const outcome = await addCheckInForm(deps, req.user!, req.body)
      if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, success: false })
      res.json({ form: outcome.value, success: true })
    },
  )

  router.get<{ id: string }, CheckInFormResponse>('/check-in-forms/:id', authMiddleware, async (req, res) => {
    const form = await getCheckInFormById(deps, req.user!, req.params.id)
    if (!form) return res.status(404).json({ error: FORM_NOT_FOUND, success: false })
    res.json({ form, success: true })
  })

  router.patch<{ id: string }, CheckInFormResponse, UpdateCheckInFormBody>(
    '/check-in-forms/:id',
    authMiddleware,
    validateBody(updateCheckInFormBodySchema),
    async (req, res) => {
      const outcome = await updateCheckInFormById(deps, req.user!, req.params.id, req.body)
      if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, success: false })
      res.json({ form: outcome.value, success: true })
    },
  )

  router.delete<{ id: string }, CheckInFormResponse>(
    '/check-in-forms/:id',
    authMiddleware,
    async (req, res) => {
      const form = await deleteCheckInFormById(deps, req.user!, req.params.id)
      if (!form) return res.status(404).json({ error: FORM_NOT_FOUND, success: false })
      res.json({ form, success: true })
    },
  )

  router.post<{ id: string }, CheckInFormResponse>(
    '/check-in-forms/:id/restore',
    authMiddleware,
    async (req, res) => {
      const form = await restoreCheckInFormById(deps, req.user!, req.params.id)
      if (!form) {
        return res.status(404).json({ error: 'No deleted check-in form with that ID', success: false })
      }
      res.json({ form, success: true })
    },
  )

  router.get<{ id: string }, CheckInAdherenceResponse, unknown, CheckInAdherenceQuery>(
    '/check-in-forms/:id/adherence',
    authMiddleware,
    validateQuery(checkInAdherenceQuerySchema),
    async (req, res) => {
      const outcome = await getCheckInAdherence(deps, req.user!, req.params.id, req.query)
      if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, success: false })
      res.json({ adherence: outcome.value, success: true })
    },
  )

  router.get<Record<string, never>, CheckInTemplatesResponse>(
    '/check-in-templates',
    authMiddleware,
    (_req, res) => {
      res.json({ success: true, templates: [...listCheckInTemplates()] })
    },
  )

  router.get<Record<string, never>, CheckInsResponse, unknown, CheckInsQuery>(
    '/check-ins',
    authMiddleware,
    validateQuery(checkInsQuerySchema),
    async (req, res) => {
      res.json({ ...(await queryCheckIns(deps, req.user!, req.query)), success: true })
    },
  )

  router.post<Record<string, never>, CheckInResponse, SubmitCheckInBody>(
    '/check-ins',
    authMiddleware,
    validateBody(submitCheckInBodySchema),
    async (req, res) => {
      const outcome = await submitCheckIn(deps, req.user!, req.body)
      if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, success: false })
      res.json({ check_in: outcome.value, success: true })
    },
  )

  router.patch<{ id: string }, CheckInResponse, UpdateCheckInBody>(
    '/check-ins/:id',
    authMiddleware,
    validateBody(updateCheckInBodySchema),
    async (req, res) => {
      const outcome = await updateCheckInById(deps, req.user!, req.params.id, req.body)
      if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, success: false })
      res.json({ check_in: outcome.value, success: true })
    },
  )

  router.delete<{ id: string }, CheckInResponse>('/check-ins/:id', authMiddleware, async (req, res) => {
    const checkIn = await deleteCheckInById(deps, req.user!, req.params.id)
    if (!checkIn) return res.status(404).json({ error: CHECK_IN_NOT_FOUND, success: false })
    res.json({ check_in: checkIn, success: true })
  })

  router.post<{ id: string }, CheckInResponse>('/check-ins/:id/restore', authMiddleware, async (req, res) => {
    const outcome = await restoreCheckInById(deps, req.user!, req.params.id)
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, success: false })
    res.json({ check_in: outcome.value, success: true })
  })

  router.get<Record<string, never>, DueResponse, unknown, DueQuery>(
    '/due',
    authMiddleware,
    validateQuery(dueQuerySchema),
    async (req, res) => {
      res.json({ ...(await listDue(deps, req.user!, req.query.date)), success: true })
    },
  )

  return router
}
