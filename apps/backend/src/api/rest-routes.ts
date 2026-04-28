/**
 * Mounts the per-domain REST routers under the Express app. Each router lives
 * in `routes/` and is instantiated with the auth middleware (and any service
 * dependencies). The `activities` router additionally needs a Garmin
 * activity-detail fetcher that's plumbed in here.
 */
import type { Express } from 'express'
import type { Client } from 'pg'

import type { Auth } from '../auth.ts'
import type { GarminClient } from '../integrations/garmin/client.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { DeductionEngineDeps } from '../services/deduction-engine.ts'
import type { ActivityNotifier, DeductionQueue } from '../services/deduction-queue.ts'
import type { InvitationAuth } from '../services/invitation.ts'
import type { OuraWebhookManager } from '../services/oura-webhook-manager.ts'
import type { SyncProvider } from '../services/queries/index.ts'
import type { WebAuthnService } from '../services/webauthn.ts'
import type { AnyMiddleware } from '../typed-router.ts'

import { markActivityDetailSynced } from '../db/index.ts'
import { processActivityDetail } from '../integrations/garmin/process.ts'
import { createActivitiesRouter } from '../routes/activities-router.ts'
import { createActivityTypesRouter } from '../routes/activity-types-router.ts'
import { createAdminRouter } from '../routes/admin-router.ts'
import { createAuditLogRouter } from '../routes/audit-log-router.ts'
import { createChartDataRouter } from '../routes/chart-data-router.ts'
import { createCorrelationsRouter } from '../routes/correlations-router.ts'
import { createDashboardRouter } from '../routes/dashboard-router.ts'
import { createDeductionRulesRouter } from '../routes/deduction-rules-router.ts'
import { createFoodItemsRouter } from '../routes/food-items-router.ts'
import { createIconsRouter } from '../routes/icons-router.ts'
import { createLocationsRouter } from '../routes/locations-router.ts'
import { createMealsRouter } from '../routes/meals-router.ts'
import { createMetricsRouter } from '../routes/metrics-router.ts'
import { createNotesRouter } from '../routes/notes-router.ts'
import { createProductivityRouter } from '../routes/productivity-router.ts'
import { createRawRecordsRouter } from '../routes/raw-records-router.ts'
import { createReportsRouter } from '../routes/reports-router.ts'
import { createScreentimeCategoriesRouter } from '../routes/screentime-categories-router.ts'
import { createSettingsRouter } from '../routes/settings-router.ts'
import { createTrainingLoadRouter } from '../routes/training-load-router.ts'
import { createTrendsRouter } from '../routes/trends-router.ts'
import { createWebAuthnRouter } from '../routes/webauthn-router.ts'
import { createWellKnownRouter, type WellKnownConfig } from '../routes/well-known-router.ts'

interface RestRoutesDeps {
  httpd: Express
  authMiddleware: AnyMiddleware
  adminMiddleware: AnyMiddleware
  centralDb: CentralDb
  invitationAuth: InvitationAuth
  webHost: string
  garmin: GarminClient
  syncProvider: SyncProvider
  activityNotifier: ActivityNotifier
  engineDeps: DeductionEngineDeps
  deductionQueue: DeductionQueue | null
  ouraWebhookManager: OuraWebhookManager
  auth: Auth
  webAuthn: WebAuthnService
  wellKnown: WellKnownConfig
  userDb: Client
}

export const mountRestRouters = ({
  httpd,
  authMiddleware,
  adminMiddleware,
  centralDb,
  invitationAuth,
  webHost,
  garmin,
  syncProvider,
  activityNotifier,
  engineDeps,
  deductionQueue,
  ouraWebhookManager,
  auth,
  webAuthn,
  wellKnown,
  userDb,
}: RestRoutesDeps): void => {
  httpd.use(createMetricsRouter(authMiddleware, syncProvider))
  httpd.use('/icons', createIconsRouter(authMiddleware))
  httpd.use('/notes', createNotesRouter(authMiddleware))
  httpd.use('/meals', createMealsRouter(authMiddleware))
  httpd.use('/food-items', createFoodItemsRouter(authMiddleware))
  httpd.use('/reports', createReportsRouter(authMiddleware))
  httpd.use(
    createActivitiesRouter(
      authMiddleware,
      syncProvider,
      activityNotifier,
      async (user, activityId, garminActivityId) => {
        const detail = await garmin.getActivityDetail(user, garminActivityId)
        const points = await processActivityDetail(user, detail)
        await markActivityDetailSynced(user, activityId)
        return points
      },
    ),
  )
  httpd.use('/productivity', createProductivityRouter(authMiddleware, syncProvider))
  httpd.use('/activity-types', createActivityTypesRouter(authMiddleware))
  httpd.use(
    '/deduction-rules',
    createDeductionRulesRouter(authMiddleware, engineDeps, deductionQueue ?? undefined),
  )
  httpd.use('/locations', createLocationsRouter(authMiddleware))
  httpd.use(createSettingsRouter(authMiddleware))
  httpd.use(createAuditLogRouter(authMiddleware))
  httpd.use(createRawRecordsRouter(authMiddleware))
  httpd.use('/dashboard', createDashboardRouter(authMiddleware))
  httpd.use('/correlations', createCorrelationsRouter(authMiddleware, syncProvider))
  httpd.use('/training-load', createTrainingLoadRouter(authMiddleware))
  httpd.use('/trends', createTrendsRouter(authMiddleware))
  httpd.use('/chart-data', createChartDataRouter(authMiddleware))
  httpd.use('/screentime-categories', createScreentimeCategoriesRouter(authMiddleware))
  httpd.use(
    '/admin',
    createAdminRouter(
      authMiddleware,
      adminMiddleware,
      centralDb,
      invitationAuth,
      webHost,
      ouraWebhookManager,
    ),
  )
  httpd.use(
    '/webauthn',
    createWebAuthnRouter({ auth, authMiddleware, centralDb, invitationAuth, userDb, webAuthn }),
  )
  httpd.use(createWellKnownRouter(wellKnown))
}
