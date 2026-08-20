/**
 * Auto-share rule routes (#903), owner-facing.
 *
 * Handles: /autoshare-rules/*
 *
 * CRUD over the per-user rules that automatically publish settled activities to
 * the federated feed, plus a dry-run preview ("this rule would have matched N
 * activities in the last 30 days"). Rules are always created DISABLED; flipping
 * `enabled` on is a separate deliberate PATCH (which stamps `enabled_at`, the
 * no-retroactive-sharing gate).
 */
import {
  type AddAutoshareRuleBody,
  addAutoshareRuleBodySchema,
  type AutoshareRule,
  type AutoshareRuleResponse,
  type AutoshareRulesResponse,
  type BaseResponse,
  type PreviewAutoshareRuleResponse,
  type UpdateAutoshareRuleBody,
  updateAutoshareRuleBodySchema,
} from '@aurboda/api-spec'

import type { AutoshareRuleRecord } from '../db/index.ts'
import type { AutoshareDeps } from '../services/autoshare.ts'

import {
  countAutosharePostsByRule,
  deleteAutoshareRule,
  getAutoshareRules,
  insertAutoshareRule,
  updateAutoshareRule,
} from '../db/index.ts'
import { PREVIEW_SAMPLE_DAYS, previewAutoshareRule } from '../services/autoshare.ts'

/** A canonical UUID; a garbage id 404s instead of 500ing on the `uuid` cast. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

/** Serialise a stored rule (Dates → ISO strings) for the API. */
export const serializeAutoshareRule = (record: AutoshareRuleRecord): AutoshareRule => ({
  activity_types: record.activity_types,
  created_at: record.created_at.toISOString(),
  enabled: record.enabled,
  enabled_at: record.enabled_at?.toISOString() ?? null,
  id: record.id,
  include_chart: record.include_chart,
  include_map: record.include_map,
  included_metrics: record.included_metrics,
  max_duration_seconds: record.max_duration_seconds ?? undefined,
  message: record.message ?? undefined,
  min_distance_meters: record.min_distance_meters ?? undefined,
  min_duration_seconds: record.min_duration_seconds ?? undefined,
  name: record.name,
  series_metrics: record.series_metrics,
  source: record.source ?? undefined,
  updated_at: record.updated_at.toISOString(),
  visibility: record.visibility,
})

/** Map an add/preview body to the rule input shape (shared with the MCP tools). */
export const autoshareRuleInputFromBody = (body: AddAutoshareRuleBody) => ({
  activity_types: body.activity_types,
  include_chart: body.include_chart,
  include_map: body.include_map,
  included_metrics: body.included_metrics,
  max_duration_seconds: body.max_duration_seconds ?? null,
  message: body.message ?? null,
  min_distance_meters: body.min_distance_meters ?? null,
  min_duration_seconds: body.min_duration_seconds ?? null,
  name: body.name,
  series_metrics: body.series_metrics,
  source: body.source ?? null,
  visibility: body.visibility,
})

export const createAutoshareRulesRouter = (
  authMiddleware: AnyMiddleware,
  previewDeps: Pick<AutoshareDeps, 'listCandidates' | 'getGroup' | 'resolveWindow' | 'distanceMeters'>,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, AutoshareRulesResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const [records, counts] = await Promise.all([getAutoshareRules(user), countAutosharePostsByRule(user)])
    res.json({ post_counts: counts, rules: records.map(serializeAutoshareRule), success: true })
  })

  router.post<Record<string, never>, AutoshareRuleResponse, AddAutoshareRuleBody>(
    '/',
    authMiddleware,
    validateBody(addAutoshareRuleBodySchema),
    async (req, res) => {
      const user = req.user!
      const record = await insertAutoshareRule(user, autoshareRuleInputFromBody(req.body))
      res.json({ rule: serializeAutoshareRule(record), success: true })
    },
  )

  // Dry run over the last 30 days: validates the SAME body as create, builds a
  // transient rule (never inserted), and counts matching merge groups —
  // regardless of shared status, since the point is to show the rule's reach.
  router.post<Record<string, never>, PreviewAutoshareRuleResponse, AddAutoshareRuleBody>(
    '/preview',
    authMiddleware,
    validateBody(addAutoshareRuleBodySchema),
    async (req, res) => {
      const user = req.user!
      const tempRule: AutoshareRuleRecord = {
        ...autoshareRuleInputFromBody(req.body),
        created_at: new Date(),
        enabled: false,
        enabled_at: null,
        id: 'preview',
        updated_at: new Date(),
      }
      const wouldMatch = await previewAutoshareRule(user, tempRule, previewDeps, new Date())
      res.json({ sample_days: PREVIEW_SAMPLE_DAYS, success: true, would_match: wouldMatch })
    },
  )

  router.patch<{ id: string }, AutoshareRuleResponse, UpdateAutoshareRuleBody>(
    '/:id',
    authMiddleware,
    validateBody(updateAutoshareRuleBodySchema),
    async (req, res) => {
      const user = req.user!
      if (!UUID_RE.test(req.params.id)) {
        return res.status(404).json({ error: 'Rule not found', success: false })
      }
      const record = await updateAutoshareRule(user, req.params.id, req.body)
      if (!record) return res.status(404).json({ error: 'Rule not found', success: false })
      res.json({ rule: serializeAutoshareRule(record), success: true })
    },
  )

  router.delete<{ id: string }, BaseResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    if (!UUID_RE.test(req.params.id)) {
      return res.status(404).json({ error: 'Rule not found', success: false })
    }
    const deleted = await deleteAutoshareRule(user, req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Rule not found', success: false })
    res.json({ success: true })
  })

  return router
}
