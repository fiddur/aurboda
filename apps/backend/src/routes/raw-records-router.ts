/**
 * Raw records route group.
 *
 * Handles: /raw-records
 */
import type { RequestHandler } from 'express'

import {
  type QueryRawRecordsQuery,
  queryRawRecordsQuerySchema,
  type QueryRawRecordsResponse,
} from '@aurboda/api-spec'

import { queryRawRecords } from '../db/index.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createRawRecordsRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, QueryRawRecordsResponse>(
    '/raw-records',
    authMiddleware,
    validateQuery(queryRawRecordsQuerySchema),
    async (req, res) => {
      // validateQuery middleware has replaced req.query with the parsed output
      // (numbers, booleans). The 4th ReqQuery generic can't express non-string
      // values when authMiddleware (typed as ParsedQs) is in the chain.
      const { end, external_id, include_data, limit, offset, record_type, source, start } =
        req.query as unknown as QueryRawRecordsQuery

      const result = await queryRawRecords(req.user!, {
        end: end ? new Date(end) : undefined,
        external_id,
        limit,
        offset,
        record_type,
        source,
        start: start ? new Date(start) : undefined,
      })

      res.json({
        data: result.rows.map((row) => ({
          data: include_data ? row.data : undefined,
          data_keys: Object.keys(row.data ?? {}),
          external_id: row.external_id,
          id: row.id,
          received_at: row.received_at.toISOString(),
          record_type: row.record_type,
          recorded_at: row.recorded_at.toISOString(),
          source: row.source,
        })),
        success: true,
        total: result.total,
      })
    },
  )

  return router
}
