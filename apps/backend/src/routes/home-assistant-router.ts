import type { HomeAssistantEntitiesResponse } from '@aurboda/api-spec'

import { type HomeAssistantEntitiesDeps, listHomeAssistantEntities } from '../services/home-assistant.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'

export const createHomeAssistantRouter = (
  authMiddleware: AnyMiddleware,
  deps: HomeAssistantEntitiesDeps,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, HomeAssistantEntitiesResponse>(
    '/entities',
    authMiddleware,
    async (req, res) => {
      const result = await listHomeAssistantEntities(req.user!, deps)
      if (result.ok) return res.json({ data: result.entities, success: true })
      res.status(result.reason === 'not_configured' ? 400 : 502).json({ error: result.error, success: false })
    },
  )

  return router
}
