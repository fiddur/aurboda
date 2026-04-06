/**
 * MCP training load tools.
 */
import { getTrainingLoadInputSchema, tzSchema } from '@aurboda/api-spec'

import { computeTrainingLoad, createTrainingLoadDeps } from '../services/training-load.ts'
import { jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

export const registerTrainingLoadTools = (server: McpServer, user: string) => {
  const deps = createTrainingLoadDeps()

  // Tool: get_training_load
  server.tool(
    'get_training_load',
    `Compute training load using the Banister impulse-response model with hourly resolution.

Returns hourly ATL (Acute Training Load / fatigue, 7-day EMA), CTL (Chronic Training Load / fitness, 42-day EMA),
and TSB (Training Stress Balance / form = CTL - ATL), plus per-hour training impulse (exercise TRIMP) and
activity impulse (scaled active calories), per-workout TRIMP scores, and recovery zone thresholds.

Two impulse sources per hour:
- training_impulse: TRIMP from exercise sessions (HR-based Banister formula or duration fallback)
- activity_impulse: active calories × scale factor (general movement load)

Recovery zones (based on historical CTL):
- Undertrained: ATL < balanced_min
- Balanced: balanced_min ≤ ATL ≤ balanced_max
- Strained: balanced_max < ATL ≤ strained_max
- Very Strained: ATL > strained_max

Parameters can be configured in user settings (training_load).

Example: "Show my training load for the last 3 months"
→ start: 3 months ago, end: today`,
    { ...getTrainingLoadInputSchema.shape, tz: tzSchema },
    async ({ start, end, bucket_size, tz }) => {
      try {
        const result = await computeTrainingLoad(deps, user, new Date(start), new Date(end), bucket_size, tz)
        return tzJsonResponse({ data: result, success: true }, tz)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonResponse({ error: message, success: false })
      }
    },
  )
}
