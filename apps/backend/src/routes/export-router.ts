import {
  type BaseResponse,
  type ExportDumpLinkResponse,
  type ExportDumpQuery,
  exportDumpQuerySchema,
} from '@aurboda/api-spec'

import type { DumpExporter, DumpLinkIssuer } from '../services/export-dump.ts'
import type { ExportTokens } from '../services/export-token.ts'

import { dumpFileName } from '../services/export-dump.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export interface ExportRouterDeps {
  authMiddleware: AnyMiddleware
  exporter: DumpExporter
  tokens: ExportTokens
  requestDumpLink: DumpLinkIssuer
  now?: () => Date
}

export const createExportRouter = ({
  authMiddleware,
  exporter,
  now = () => new Date(),
  requestDumpLink,
  tokens,
}: ExportRouterDeps): TypedRouter => {
  const router = typedRouter()

  router.post<Record<string, never>, ExportDumpLinkResponse | BaseResponse>(
    '/dump-link',
    authMiddleware,
    async (req, res) => {
      const link = await requestDumpLink(req.user!)
      if (!link.ok) return res.status(link.status).json({ error: link.error, success: false })
      res.json({ expires_at: link.expires_at.toISOString(), success: true, url: link.url })
    },
  )

  router.get<Record<string, never>, BaseResponse, unknown, ExportDumpQuery>(
    '/dump',
    validateQuery(exportDumpQuerySchema),
    async (req, res) => {
      const payload = tokens.verifyExportToken(req.query.token, now())
      if (!payload) {
        return res.status(401).json({ error: 'This export link is invalid or has expired', success: false })
      }

      const started = await exporter.start(payload.user, payload.nonce)
      if (!started.ok) return res.status(started.status).json({ error: started.error, success: false })

      res.setHeader('Content-Type', 'application/gzip')
      res.setHeader('Content-Disposition', `attachment; filename="${dumpFileName(payload.user, now())}"`)
      res.setHeader('Cache-Control', 'no-store')
      res.flushHeaders()

      try {
        await started.run(res)
        tokens.spendExportToken(payload)
      } catch (error) {
        console.error(`⚠️ Database export for ${payload.user} failed:`, error)
      }
    },
  )

  return router
}
