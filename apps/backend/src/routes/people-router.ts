import {
  type AddPersonBody,
  addPersonBodySchema,
  type AddPersonDateBody,
  addPersonDateBodySchema,
  type BaseResponse,
  type DeletePersonQuery,
  deletePersonQuerySchema,
  type ImportantDatesQuery,
  importantDatesQuerySchema,
  type ImportantDatesResponse,
  type PeopleQuery,
  peopleQuerySchema,
  type PeopleResponse,
  type PersonActivitiesQuery,
  personActivitiesQuerySchema,
  type PersonActivitiesResponse,
  personRelationshipSuggestions,
  type PersonDateResponse,
  type PersonDatesResponse,
  type PersonDetailResponse,
  type PersonPostsQuery,
  personPostsQuerySchema,
  type PersonPostsResponse,
  type PersonResponse,
  type UpdatePersonBody,
  updatePersonBodySchema,
  type UpdatePersonDateBody,
  updatePersonDateBodySchema,
} from '@aurboda/api-spec'

import {
  addPerson,
  addPersonDate,
  deletePersonById,
  deletePersonDateById,
  getPersonDetail,
  listImportantDates,
  listPeopleView,
  listPersonActivities,
  listPersonDatesById,
  listPersonPosts,
  PERSON_NOT_FOUND,
  type PeopleDeps,
  restorePersonById,
  updatePersonById,
  updatePersonDateById,
} from '../services/people.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createPeopleRouter = (authMiddleware: AnyMiddleware, deps: PeopleDeps): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, PeopleResponse, unknown, PeopleQuery>(
    '/',
    authMiddleware,
    validateQuery(peopleQuerySchema),
    async (req, res) => {
      const people = await listPeopleView(deps, req.user!, req.query)
      res.json({ people, relationship_suggestions: [...personRelationshipSuggestions], success: true })
    },
  )

  router.post<Record<string, never>, PersonResponse, AddPersonBody>(
    '/',
    authMiddleware,
    validateBody(addPersonBodySchema),
    async (req, res) => {
      const result = await addPerson(deps, req.user!, req.body)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ person: result.value, success: true })
    },
  )

  router.get<Record<string, never>, ImportantDatesResponse, unknown, ImportantDatesQuery>(
    '/dates',
    authMiddleware,
    validateQuery(importantDatesQuerySchema),
    async (req, res) => {
      const result = await listImportantDates(deps, req.user!, req.query)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ ...result.value, success: true })
    },
  )

  router.get<{ id: string }, PersonDetailResponse>('/:id', authMiddleware, async (req, res) => {
    const person = await getPersonDetail(deps, req.user!, req.params.id)
    if (!person) return res.status(404).json({ error: PERSON_NOT_FOUND, success: false })
    res.json({ person, success: true })
  })

  router.patch<{ id: string }, PersonResponse, UpdatePersonBody>(
    '/:id',
    authMiddleware,
    validateBody(updatePersonBodySchema),
    async (req, res) => {
      const result = await updatePersonById(deps, req.user!, req.params.id, req.body)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ person: result.value, success: true })
    },
  )

  router.delete<{ id: string }, BaseResponse, unknown, DeletePersonQuery>(
    '/:id',
    authMiddleware,
    validateQuery(deletePersonQuerySchema),
    async (req, res) => {
      if (!(await deletePersonById(deps, req.user!, req.params.id, { purge: req.query.purge === true }))) {
        return res.status(404).json({ error: PERSON_NOT_FOUND, success: false })
      }
      res.json({ success: true })
    },
  )

  router.post<{ id: string }, PersonResponse>('/:id/restore', authMiddleware, async (req, res) => {
    const result = await restorePersonById(deps, req.user!, req.params.id)
    if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
    res.json({ person: result.value, success: true })
  })

  router.get<{ id: string }, PersonActivitiesResponse, unknown, PersonActivitiesQuery>(
    '/:id/activities',
    authMiddleware,
    validateQuery(personActivitiesQuerySchema),
    async (req, res) => {
      const result = await listPersonActivities(deps, req.user!, req.params.id, req.query)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ ...result.value, success: true })
    },
  )

  router.get<{ id: string }, PersonPostsResponse, unknown, PersonPostsQuery>(
    '/:id/posts',
    authMiddleware,
    validateQuery(personPostsQuerySchema),
    async (req, res) => {
      const result = await listPersonPosts(deps, req.user!, req.params.id, req.query.limit)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ entries: result.value, success: true })
    },
  )

  router.get<{ id: string }, PersonDatesResponse>('/:id/dates', authMiddleware, async (req, res) => {
    const dates = await listPersonDatesById(deps, req.user!, req.params.id)
    if (!dates) return res.status(404).json({ error: PERSON_NOT_FOUND, success: false })
    res.json({ dates, success: true })
  })

  router.post<{ id: string }, PersonDateResponse, AddPersonDateBody>(
    '/:id/dates',
    authMiddleware,
    validateBody(addPersonDateBodySchema),
    async (req, res) => {
      const result = await addPersonDate(deps, req.user!, req.params.id, req.body)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ date: result.value, success: true })
    },
  )

  router.patch<{ id: string; date_id: string }, PersonDateResponse, UpdatePersonDateBody>(
    '/:id/dates/:date_id',
    authMiddleware,
    validateBody(updatePersonDateBodySchema),
    async (req, res) => {
      const result = await updatePersonDateById(deps, req.user!, req.params.id, req.params.date_id, req.body)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ date: result.value, success: true })
    },
  )

  router.delete<{ id: string; date_id: string }, BaseResponse>(
    '/:id/dates/:date_id',
    authMiddleware,
    async (req, res) => {
      const result = await deletePersonDateById(deps, req.user!, req.params.id, req.params.date_id)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ success: true })
    },
  )

  return router
}
