import type { HomeAssistantEntity } from '@aurboda/api-spec'

import type { UserSettings } from '../db/types.ts'
import type { HomeAssistantClient } from '../integrations/home-assistant/client.ts'

import { toHomeAssistantError } from '../integrations/home-assistant/client.ts'
import { trackableEntities } from '../integrations/home-assistant/process.ts'

export interface HomeAssistantEntitiesDeps {
  client: HomeAssistantClient
  getSettings: (user: string) => Promise<UserSettings>
}

export type HomeAssistantEntitiesResult =
  | { ok: true; entities: HomeAssistantEntity[] }
  | { ok: false; reason: 'not_configured' | 'unreachable'; error: string }

/**
 * The person.* and device_tracker.* entities with coordinates on the user's
 * Home Assistant, to pick the one to pull. Needs only the URL and the token,
 * so it doubles as a connection test before an entity is chosen.
 */
export const listHomeAssistantEntities = async (
  user: string,
  deps: HomeAssistantEntitiesDeps,
): Promise<HomeAssistantEntitiesResult> => {
  const settings = await deps.getSettings(user)
  if (!settings.home_assistant_url || !settings.home_assistant_token) {
    return { error: 'Set the Home Assistant URL and access token first', ok: false, reason: 'not_configured' }
  }
  try {
    const states = await deps.client.getStates({
      baseUrl: settings.home_assistant_url,
      token: settings.home_assistant_token,
    })
    return { entities: trackableEntities(states), ok: true }
  } catch (error) {
    return { error: toHomeAssistantError(error).message, ok: false, reason: 'unreachable' }
  }
}
