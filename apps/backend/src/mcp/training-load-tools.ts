/**
 * MCP training load tools.
 */
import { getTrainingLoadInputSchema } from '@aurboda/api-spec'
import { computeTrainingLoad, createTrainingLoadDeps } from '../services/training-load'
import { jsonResponse, type McpServer } from './helpers'

export const registerTrainingLoadTools = (server: McpServer, user: string) => {
  const deps = createTrainingLoadDeps()

  // Tool: get_training_load
  server.tool(
    'get_training_load',
    `Compute training load using the Banister impulse-response model.

Returns daily ATL (Acute Training Load / fatigue), CTL (Chronic Training Load / fitness),
and TSB (Training Stress Balance / form = CTL - ATL) plus per-workout TRIMP scores.

TRIMP (Training Impulse) is computed from each workout's HR data using the Banister formula:
TRIMP = duration × ΔHR_ratio × e^(k × ΔHR_ratio)

Interpretation:
- TSB > 0: "Fresh" — fitness exceeds recent fatigue
- TSB ≈ 0: Balanced
- TSB < 0: "Fatigued" — recent training load exceeds built fitness

The time constants τ_a (acute, default 7 days) and τ_c (chronic, default 42 days)
and other parameters can be configured in user settings (training_load).

Example: "Show my training load for the last 3 months"
→ start: 3 months ago, end: today`,
    { ...getTrainingLoadInputSchema.shape },
    async ({ start, end }) => {
      try {
        const result = await computeTrainingLoad(deps, user, new Date(start), new Date(end))
        return jsonResponse({ data: result, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonResponse({ error: message, success: false })
      }
    },
  )
}
