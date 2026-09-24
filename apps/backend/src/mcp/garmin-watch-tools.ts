import { getGarminWatchConfig } from '../services/garmin-watch.ts'
import { jsonResponse, type McpServer } from './helpers.ts'

export const registerGarminWatchTools = (server: McpServer, user: string) => {
  server.tool(
    'get_garmin_watch_config',
    'Get what the Aurboda Connect IQ watch app fetches: the configured activity types in display order, each with its display name, session name, Garmin sport, and the code the watch writes into the FIT file so the Garmin import can recognise the type. Configure the list with update_user_settings (garmin_watch_types).',
    {},
    async () => jsonResponse(await getGarminWatchConfig(user)),
  )
}
