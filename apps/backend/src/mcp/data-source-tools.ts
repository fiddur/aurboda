import { getDataSourcesOverview } from '../services/data-sources-overview.ts'
import { jsonResponse, type McpServer } from './helpers.ts'

export const registerDataSourceTools = (server: McpServer, user: string) => {
  server.tool(
    'get_data_sources_overview',
    'Which data sources the user has connected (status active, configured or not_set_up), the kinds of data each brings, which sources feed each kind, and where two sources send the same thing (`overlap`: a kind where one source is enough, such as location or computer screen time, with two or more active sources). The same as `GET /data-sources/overview`.',
    {},
    async () => jsonResponse(await getDataSourcesOverview(user)),
  )
}
