/**
 * Extract an actor's presentation (handle / display name / avatar) from a
 * resolved Fedify actor — shared by the follow direction (`following.ts`, when
 * we resolve someone we follow) and the follower direction (`federation.ts`,
 * when someone follows us) so both cache the same fields the same way.
 *
 * The handle is derived from `preferredUsername` + the actor id's host (offline,
 * deterministic — no WebFinger round-trip that could hang). The avatar comes
 * from the actor's `icon`: Mastodon inlines it (no fetch), but a server that
 * only links it would make `getIcon()` dereference a URL, so it's bounded by a
 * timeout — a slow icon host must never hang a synchronous follow/inbox handler.
 */
import type { Actor } from '@fedify/fedify/vocab'

import { withTimeout } from '../with-timeout.ts'

export interface ActorPresentation {
  handle: string | null
  display_name: string | null
  avatar_url: string | null
}

/** Map a `LanguageString | string | null` (Fedify vocab value) to a plain string or null. */
const toPlainString = (value: unknown): string | null => {
  if (value == null) return null
  const str = String(value).trim()
  return str.length > 0 ? str : null
}

/** How long to wait for an actor's icon before giving up (avatar is non-essential). */
const ICON_FETCH_TIMEOUT_MS = 3000

export const extractActorPresentation = async (actor: Actor): Promise<ActorPresentation> => {
  const username = toPlainString(actor.preferredUsername)
  const handle = username == null || actor.id == null ? null : `@${username}@${actor.id.host}`
  let avatarUrl: string | null = null
  try {
    const icon = await withTimeout(actor.getIcon(), ICON_FETCH_TIMEOUT_MS)
    avatarUrl = icon?.url instanceof URL ? icon.url.href : null
  } catch {
    avatarUrl = null
  }
  return { avatar_url: avatarUrl, display_name: toPlainString(actor.name), handle }
}
