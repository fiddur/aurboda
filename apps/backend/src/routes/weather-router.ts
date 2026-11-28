import { type WeatherQuery, type WeatherResponse, weatherQuerySchema } from '@aurboda/api-spec'

import { defaultWeatherDeps, getWeather, type WeatherDeps } from '../services/weather.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createWeatherRouter = (
  authMiddleware: AnyMiddleware,
  deps: WeatherDeps = defaultWeatherDeps(),
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, WeatherResponse, unknown, WeatherQuery>(
    '/',
    authMiddleware,
    validateQuery(weatherQuerySchema),
    async (req, res) => {
      const result = await getWeather(req.user!, req.query, deps)
      if (!result.ok) return res.status(400).json({ error: result.error, success: false })
      res.json({ ...result.weather, success: true })
    },
  )

  return router
}
