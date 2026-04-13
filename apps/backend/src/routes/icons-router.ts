/**
 * Icons route group.
 *
 * Handles: /icons/*
 *
 * POST /icons — upload an icon (authenticated)
 * GET /icons/:user/:id — serve an icon (public, cached 1 year)
 * DELETE /icons/:id — delete an icon (authenticated)
 */
import type { RequestHandler } from 'express'

import multer from 'multer'

import { getIcon } from '../db/icons.ts'
import { isAllowedContentType, processAndStoreIcon, removeIcon } from '../services/icons.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  storage: multer.memoryStorage(),
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const createIconsRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<{ user: string; id: string }, { error: string; success: boolean } | Buffer>(
    '/:user/:id',
    async (req, res) => {
      const { user, id } = req.params
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: 'Invalid icon ID', success: false })
        return
      }

      const icon = await getIcon(user, id)
      if (!icon) {
        res.status(404).json({ error: 'Icon not found', success: false })
        return
      }

      res.set('Content-Type', icon.content_type)
      res.set('Cache-Control', 'public, max-age=31536000, immutable')
      res.send(icon.data)
    },
  )

  router.post<Record<string, never>, { success: boolean; id?: string; url?: string; error?: string }>(
    '/',
    authMiddleware,
    upload.single('icon'),
    async (req, res) => {
      const user = req.user!
      const file = req.file
      if (!file) {
        res.status(400).json({ error: 'No file uploaded', success: false })
        return
      }

      if (!isAllowedContentType(file.mimetype)) {
        res.status(400).json({
          error: `Unsupported file type: ${file.mimetype}. Allowed: PNG, JPEG, WebP, GIF, SVG`,
          success: false,
        })
        return
      }

      const id = await processAndStoreIcon(user, file.buffer, file.mimetype)
      const url = `/api/icons/${user}/${id}`
      res.status(201).json({ id, success: true, url })
    },
  )

  router.delete<{ id: string }, { success: boolean; error?: string }>(
    '/:id',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const { id } = req.params
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: 'Invalid icon ID', success: false })
        return
      }

      const deleted = await removeIcon(user, id)
      if (!deleted) {
        res.status(404).json({ error: 'Icon not found', success: false })
        return
      }

      res.json({ success: true })
    },
  )

  return router
}
