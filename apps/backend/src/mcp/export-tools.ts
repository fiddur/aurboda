import type { DumpLinkIssuer } from '../services/export-dump.ts'

import { errorResponse, type McpServer } from './helpers.ts'

export const registerExportTools = (server: McpServer, user: string, requestDumpLink: DumpLinkIssuer) => {
  server.tool(
    'export_data_dump',
    "Get a short-lived link to download the user's whole Aurboda database as a gzipped plain SQL dump (pg_dump), restorable into another Aurboda installation (see docs/data-export.md). The link needs no authorization header and expires after a few minutes. The dump contains stored integration credentials (e.g. Garmin, Oura tokens), so it must be kept safe.",
    {},
    async () => {
      const link = await requestDumpLink(user)
      if (!link.ok) return errorResponse(`Export unavailable: ${link.error}`)
      return {
        content: [
          {
            text: [
              "Download the user's whole database as a gzipped plain SQL dump (aurboda-<user>-<date>.sql.gz).",
              `URL: ${link.url}`,
              `Expires: ${link.expires_at.toISOString()}`,
              'It contains stored integration credentials (e.g. Garmin, Oura tokens): keep it safe.',
              'Restore steps: https://github.com/fiddur/aurboda/blob/develop/docs/data-export.md',
            ].join('\n'),
            type: 'text' as const,
          },
        ],
      }
    },
  )
}
