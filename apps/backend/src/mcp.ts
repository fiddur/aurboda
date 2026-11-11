/**
 * Each request creates a fresh McpServer + transport pair. No session tracking
 * is needed since the server only exposes tools (no resources, subscriptions,
 * or server-initiated notifications).
 *
 * Tool registrations are split into focused modules under mcp/.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { type ErrorRequestHandler, json, type Request, type Response, Router } from 'express'

import type { Auth } from './auth.ts'
import type { GarminClient } from './integrations/garmin/client.ts'
import type { DetailSyncedCallback, TrackWrittenCallback } from './integrations/garmin/sync.ts'
import type { GravlClient } from './integrations/gravl/client.ts'
import type { ouraClient } from './integrations/oura/client.ts'
import type { AutosharePreviewDeps } from './mcp/autoshare-rule-tools.ts'
import type { FeedDeliver } from './routes/feed-router.ts'
import type { AccountDeleter } from './services/account-deletion.ts'
import type { AccountPlans } from './services/account-plan.ts'
import type { PostUpdateResender } from './services/activitypub/post-update-resend.ts'
import type { AdminUsers } from './services/admin-users.ts'
import type { CentralDb } from './services/central-db.ts'
import type { DiscoverChallenges } from './services/challenge-discovery.ts'
import type { DeductionEngineDeps } from './services/deduction-engine.ts'
import type { ActivityNotifier, DeductionQueue } from './services/deduction-queue.ts'
import type { DumpLinkIssuer } from './services/export-dump.ts'
import type { ReactionActions } from './services/feed-reactions.ts'
import type { FollowerActions } from './services/followers.ts'
import type { FollowActions } from './services/following.ts'
import type { NamedLocationsChanged } from './services/locations.ts'
import type { PublicTagActions } from './services/public-tags.ts'
import type { SyncProvider } from './services/queries/index.ts'
import type { RelayActions } from './services/relays.ts'
import type { HrSettingsChanged, ProfileChanged } from './services/settings.ts'
import type { StravaQueue } from './services/strava-queue.ts'
import type { RetroEnrichTrigger } from './services/timeline-retro-enrich.ts'

import { registerAccountDeletionTools } from './mcp/account-deletion-tools.ts'
import { registerAccountEmailTools } from './mcp/account-email-tools.ts'
import { registerAccountPlanTools } from './mcp/account-plan-tools.ts'
import { registerActivityTools } from './mcp/activity-tools.ts'
import { registerActivityTypeTools } from './mcp/activity-type-tools.ts'
import { registerAdminFederationTools } from './mcp/admin-federation-tools.ts'
import { registerAdminRelayTools } from './mcp/admin-relay-tools.ts'
import { registerAdminUserTools } from './mcp/admin-user-tools.ts'
import { registerAutoshareRuleTools } from './mcp/autoshare-rule-tools.ts'
import { registerChallengeTools } from './mcp/challenge-tools.ts'
import { registerChartTools } from './mcp/chart-tools.ts'
import { registerCorrelationTools } from './mcp/correlation-tools.ts'
import { registerDebugTools } from './mcp/debug-tools.ts'
import { registerDeductionRuleTools } from './mcp/deduction-rule-tools.ts'
import { registerExportTools } from './mcp/export-tools.ts'
import { registerFeedTools } from './mcp/feed-tools.ts'
import { registerFoodItemTools } from './mcp/food-item-tools.ts'
import { registerImportTools } from './mcp/import-tools.ts'
import { registerLocationTools } from './mcp/location-tools.ts'
import { registerMealTools } from './mcp/meal-tools.ts'
import { registerMetricTools } from './mcp/metric-tools.ts'
import { registerNoteTools } from './mcp/note-tools.ts'
import { registerNutrientRecommendationTools } from './mcp/nutrient-recommendation-tools.ts'
import { registerQueryTools } from './mcp/query-tools.ts'
import { refuseMutatingTools } from './mcp/read-only-gate.ts'
import { registerReportTools } from './mcp/report-tools.ts'
import { registerRouteTools } from './mcp/route-tools.ts'
import { registerScreentimeCategoryTools } from './mcp/screentime-category-tools.ts'
import { registerSensitivityTools } from './mcp/sensitivity-tools.ts'
import { registerSettingsTools } from './mcp/settings-tools.ts'
import { registerSharedDashboardTools } from './mcp/shared-dashboard-tools.ts'
import { registerSharedExerciseTools } from './mcp/shared-exercise-tools.ts'
import { registerSyncTools } from './mcp/sync-tools.ts'
import { installToolCatalogue } from './mcp/tool-catalogue.ts'
import { registerTrainingLoadTools } from './mcp/training-load-tools.ts'
import { registerTrendTools } from './mcp/trend-tools.ts'
import { type AccountGate, safeRefusal } from './services/account-gate.ts'
import { createDefaultEngineDeps } from './services/deduction-deps.ts'
import { isOAuthAccessToken, validateAccessToken } from './services/oauth.ts'
import { isMutatingMcpTool, mcpToolCallNames } from './services/usage-channel.ts'
import { recordUsage } from './services/usage-recorder.ts'
import { trimStrings } from './trim-input.ts'

type OuraClientType = ReturnType<typeof ouraClient>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const trimToolCallMessage = (message: unknown): unknown => {
  if (!isRecord(message) || message.method !== 'tools/call' || !isRecord(message.params)) return message
  if (!('arguments' in message.params)) return message
  return { ...message, params: { ...message.params, arguments: trimStrings(message.params.arguments) } }
}

export const trimToolCallArguments = (body: unknown): unknown =>
  Array.isArray(body) ? body.map(trimToolCallMessage) : trimToolCallMessage(body)

const isEntityTooLarge = (err: unknown): boolean => isRecord(err) && err.type === 'entity.too.large'

const jsonRpcBodyError: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: { code: -32700, message: 'Parse error' }, id: null, jsonrpc: '2.0' })
    return
  }
  if (isEntityTooLarge(err)) {
    res
      .status(413)
      .json({ error: { code: -32600, message: 'Request body exceeds 4 MB' }, id: null, jsonrpc: '2.0' })
    return
  }
  next(err)
}

const SERVER_INSTRUCTIONS =
  'The tool list is abbreviated: each tool shows its first sentence and its top-level parameters only. Call describe_tools with one or more tool names for the full description and complete parameter schema (nested objects, enums, examples) before using a tool whose parameters are objects or arrays.'

interface McpDeps {
  /** Account deletion (`delete_my_account`, `delete_user`). */
  accountDeleter?: AccountDeleter
  /** Refuses mutating tools for a read-only account (plan expired past the grace period). */
  accountGate?: AccountGate
  /** Plans and billing (`get_my_plan`, `set_user_plan`). */
  accountPlans?: AccountPlans
  adminUsers?: AdminUsers
  apiBaseUrl?: string
  autosharePreviewDeps?: AutosharePreviewDeps
  centralDb?: CentralDb
  deductionQueue?: DeductionQueue
  /** Open challenges from followed peers (`discover_challenges`). */
  discoverChallenges?: DiscoverChallenges
  engineDeps?: DeductionEngineDeps
  feedDeliver?: FeedDeliver
  followActions?: FollowActions
  followerActions?: FollowerActions
  garmin?: GarminClient
  gravl?: GravlClient
  /** Deleted accounts, whose stateless tokens still decode. */
  isDeletedUser?: (user: string) => boolean
  onActivityMutated?: ActivityNotifier
  onNamedLocationsChanged?: NamedLocationsChanged
  /** Fire-and-forget: recompute activity features after HR zones, birth date or maf_hr change. */
  onHrSettingsChanged?: HrSettingsChanged
  /** Fire-and-forget: federate an `Update{Person}` after a display-name change. */
  onProfileChanged?: ProfileChanged
  onActivityDetailSynced?: DetailSyncedCallback
  onTrackWritten?: TrackWrittenCallback
  oura?: OuraClientType
  reactionActions?: ReactionActions
  relayActions?: RelayActions
  publicTagActions?: PublicTagActions
  /** Admin re-send of every public post's Update (`resend_post_updates`). */
  postUpdateResender?: PostUpdateResender
  retroEnrichTimeline?: RetroEnrichTrigger
  requestDumpLink?: DumpLinkIssuer
  stravaQueue?: StravaQueue
  sync?: SyncProvider
  webHost?: string
}

const createMcpServer = (user: string, deps: McpDeps = {}): McpServer => {
  const server = new McpServer(
    {
      name: 'aurboda',
      version: '1.0.0',
    },
    { instructions: SERVER_INSTRUCTIONS },
  )

  const engineDeps = deps.engineDeps ?? createDefaultEngineDeps()

  registerQueryTools(server, user, deps.sync)
  registerMetricTools(server, user)
  registerActivityTools(server, user, deps.onActivityMutated)
  registerActivityTypeTools(server, user)
  registerDeductionRuleTools(server, user, engineDeps, deps.deductionQueue)
  if (deps.autosharePreviewDeps) registerAutoshareRuleTools(server, user, deps.autosharePreviewDeps)
  registerSyncTools(
    server,
    user,
    deps.oura,
    deps.garmin,
    deps.stravaQueue,
    deps.onActivityMutated,
    deps.gravl,
    deps.onActivityDetailSynced,
    deps.onTrackWritten,
  )
  registerSettingsTools(server, user, deps.onHrSettingsChanged, deps.onProfileChanged)
  registerLocationTools(server, user, deps.onNamedLocationsChanged)
  registerCorrelationTools(server, user, deps.sync)
  registerTrainingLoadTools(server, user)
  registerTrendTools(server, user)
  registerChartTools(server, user)
  registerNoteTools(server, user)
  registerMealTools(server, user)
  registerNutrientRecommendationTools(server, user)
  if (deps.centralDb) {
    registerFoodItemTools(server, user, deps.centralDb)
    registerSensitivityTools(server, user, deps.centralDb)
    registerImportTools(server, user, deps.centralDb)
    if (deps.adminUsers) registerAdminUserTools(server, user, deps.centralDb, deps.adminUsers)
    if (deps.relayActions) registerAdminRelayTools(server, user, deps.centralDb, deps.relayActions)
    if (deps.postUpdateResender) {
      registerAdminFederationTools(server, user, deps.centralDb, deps.postUpdateResender)
    }
    if (deps.accountDeleter) registerAccountDeletionTools(server, user, deps.centralDb, deps.accountDeleter)
    if (deps.accountPlans) registerAccountPlanTools(server, user, deps.centralDb, deps.accountPlans)
    registerAccountEmailTools(server, user, deps.centralDb)
  }
  registerReportTools(server, user)
  registerRouteTools(server, user)
  registerSharedDashboardTools(server, user)
  registerSharedExerciseTools(server, user, deps.webHost)
  registerFeedTools(server, user, {
    apiBaseUrl: deps.apiBaseUrl,
    deliver: deps.feedDeliver,
    followActions: deps.followActions,
    followerActions: deps.followerActions,
    publicTagActions: deps.publicTagActions,
    reactionActions: deps.reactionActions,
    retroEnrichTimeline: deps.retroEnrichTimeline,
    webHost: deps.webHost,
  })
  registerChallengeTools(server, user, {
    apiBaseUrl: deps.apiBaseUrl,
    discoverChallenges: deps.discoverChallenges,
    webHost: deps.webHost,
  })
  registerScreentimeCategoryTools(server, user)
  if (deps.requestDumpLink) registerExportTools(server, user, deps.requestDumpLink)
  registerDebugTools(server, user)
  installToolCatalogue(server)

  return server
}

export function createMcpRouter(auth: Auth, deps: McpDeps = {}): Router {
  const router = Router()

  const getAuthenticatedUser = async (req: Request): Promise<string | null> => {
    const authHeader = req.headers.authorization
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return null
    }
    const token = authHeader.slice('Bearer '.length)

    const user = await (async () => {
      // Try OAuth access token first (prefixed with aur_at_)
      if (isOAuthAccessToken(token) && deps.centralDb) {
        return validateAccessToken({ centralDb: deps.centralDb }, token)
      }

      // Fall back to existing AES-256-GCM token
      try {
        return auth.getUsernameFromToken(token)
      } catch {
        return null
      }
    })()
    return user && deps.isDeletedUser?.(user) ? null : user
  }

  router.post('/', json({ limit: '4mb' }), async (req: Request, res: Response) => {
    const user = await getAuthenticatedUser(req)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const tools = mcpToolCallNames(req.body)
    for (const tool of tools) {
      recordUsage(user, isMutatingMcpTool(tool) ? 'write' : 'read', 'mcp')
    }
    const refusal =
      deps.accountGate && tools.some(isMutatingMcpTool) ? await safeRefusal(deps.accountGate, user) : null

    const server = createMcpServer(user, deps)
    if (refusal) refuseMutatingTools(server, refusal)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })

    await server.connect(transport)
    await transport.handleRequest(
      req,
      res,
      req.body === undefined ? undefined : trimToolCallArguments(req.body),
    )
    await server.close()
  })

  router.use(jsonRpcBodyError)

  // GET /mcp - Not used in stateless mode (no SSE notifications)
  router.get('/', (_req: Request, res: Response) => {
    res.status(405).json({ error: 'SSE not supported in stateless mode' })
  })

  // DELETE /mcp - Not used in stateless mode (no sessions)
  router.delete('/', (_req: Request, res: Response) => {
    res.status(405).json({ error: 'No sessions in stateless mode' })
  })

  return router
}
