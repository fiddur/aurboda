/** The public read side lives in public-avatar-router (`/u/:username/avatar.png`). */
import type { RequestHandler } from 'express'

import { singleUpload } from '../api/upload.ts'
import { deleteProfileAvatar } from '../db/index.ts'
import { isAllowedImageType } from '../services/avatar.ts'
import { PROFILE_AVATAR_MAX_BYTES, setProfileAvatar } from '../services/profile-avatar.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'

const upload = singleUpload({ field: 'avatar', fields: 2, fileSize: PROFILE_AVATAR_MAX_BYTES })

export const createProfileRouter = (
  authMiddleware: RequestHandler,
  webHost: string,
  /**
   * Fire-and-forget: called after the avatar is uploaded/replaced/removed, so
   * federation can deliver an `Update{Person}` to followers (remote servers
   * cache the old avatar until told otherwise).
   */
  onAvatarChanged?: (user: string) => void,
): TypedRouter => {
  const router = typedRouter()

  router.post<Record<string, never>, { success: boolean; url?: string; error?: string }>(
    '/avatar',
    authMiddleware,
    upload,
    async (req, res) => {
      const user = req.user!
      const file = req.file
      if (!file) {
        res.status(400).json({ error: 'No file uploaded', success: false })
        return
      }
      if (!isAllowedImageType(file.mimetype)) {
        res.status(400).json({
          error: `Unsupported file type: ${file.mimetype}. Allowed: PNG, JPEG, WebP, GIF`,
          success: false,
        })
        return
      }

      const result = await setProfileAvatar(user, file.buffer, webHost)
      if (!result.ok) {
        res.status(400).json({ error: 'Could not process image', success: false })
        return
      }
      onAvatarChanged?.(user)
      res.json({ success: true, url: result.url })
    },
  )

  router.delete<Record<string, never>, { success: boolean }>('/avatar', authMiddleware, async (req, res) => {
    if (await deleteProfileAvatar(req.user!)) onAvatarChanged?.(req.user!)
    res.json({ success: true })
  })

  return router
}
