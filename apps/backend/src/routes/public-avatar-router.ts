/**
 * Public avatar serving (UNAUTHENTICATED).
 *
 * `GET /u/:username/avatar.png` returns the user's uploaded avatar, or a
 * deterministic identicon when none is set / the user is unknown — so the
 * profile page, OG cards, and the ActivityPub actor `icon` always have an
 * image. Mounted before the share-html router so `avatar.png` isn't matched as
 * a dashboard slug.
 */
import { Router } from 'express'

import { isValidUsername } from '../api/auth-routes.ts'
import { loadAvatarImage } from '../services/avatar-resolve.ts'
import { generateIdenticon, type StoredImage } from '../services/avatar.ts'

export interface PublicAvatarDeps {
  /** Resolve a valid username to an avatar image (stored or generated fallback). */
  loadAvatar: (username: string) => Promise<StoredImage>
}

export const createPublicAvatarRouter = (
  deps: PublicAvatarDeps = { loadAvatar: loadAvatarImage },
): Router => {
  const router = Router()

  router.get('/u/:username/avatar.png', async (req, res) => {
    const { username } = req.params
    // Skip DB routing for invalid usernames — still yield an identicon so the
    // endpoint always returns an image.
    const image = isValidUsername(username)
      ? await deps.loadAvatar(username)
      : await generateIdenticon(username)
    res.set('Content-Type', image.content_type)
    res.set('Cache-Control', 'public, max-age=3600')
    res.send(image.data)
  })

  return router
}
