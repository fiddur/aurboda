import { z } from 'zod'

import { iso8601DateTimeSchema, successSchema } from './common.ts'

export const exportDumpLinkResponseSchema = z
  .object({
    success: successSchema,
    url: z.string().url().meta({
      description:
        'Absolute download URL of the gzipped SQL dump. It carries its own short-lived token, so it needs no Authorization header; a token is spent once a download completes.',
    }),
    expires_at: iso8601DateTimeSchema.meta({ description: 'When the download URL stops working' }),
  })
  .meta({
    description: "A short-lived link to download the user's whole database as a gzipped plain SQL dump",
    id: 'ExportDumpLinkResponse',
  })

export type ExportDumpLinkResponse = z.infer<typeof exportDumpLinkResponseSchema>

export const exportDumpQuerySchema = z
  .object({
    token: z.string().min(1).meta({ description: 'The token from POST /export/dump-link' }),
  })
  .meta({ id: 'ExportDumpQuery' })

export type ExportDumpQuery = z.infer<typeof exportDumpQuerySchema>
