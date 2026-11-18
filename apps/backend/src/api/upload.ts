import type { RequestHandler } from 'express'

import multer from 'multer'

interface SingleUploadOptions {
  /** The multipart field that carries the file. */
  field: string
  fileSize: number
  /** How many text fields the route accepts besides the file. */
  fields: number
  /** The 413 body's message; defaults to `File too large`. */
  tooLargeMessage?: string
}

/**
 * One file in memory, with limits on the file's size, the file count and the
 * form fields. Going over the size answers 413, any other multer limit 400, so
 * a client's mistake is never a 500.
 */
export const singleUpload = ({
  field,
  fileSize,
  fields,
  tooLargeMessage = 'File too large',
}: SingleUploadOptions): RequestHandler => {
  const upload = multer({
    limits: { fields, fileSize, files: 1, parts: fields + 1 },
    storage: multer.memoryStorage(),
  }).single(field)

  return (req, res, next) =>
    upload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: tooLargeMessage, success: false })
          return
        }
        res.status(400).json({ error: 'Invalid upload', success: false })
        return
      }
      next(error)
    })
}
