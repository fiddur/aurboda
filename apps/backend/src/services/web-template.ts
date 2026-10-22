/**
 * Loads the built SPA index.html so the share-page router can inject
 * crawler-visible <head> meta into it. In the production image nginx and the
 * backend share a filesystem, so the backend reads the same index.html nginx
 * serves (path via WEB_INDEX_PATH). A successful read is cached for the process
 * lifetime; a missing/unreadable path yields null (the router then falls back
 * to a minimal document).
 */
import { readFile } from 'node:fs/promises'

export const createTemplateLoader = (indexPath: string | undefined): (() => Promise<string | null>) => {
  let cached: string | null = null
  return async () => {
    if (cached !== null) return cached
    if (!indexPath) return null
    try {
      cached = await readFile(indexPath, 'utf8')
      return cached
    } catch {
      return null
    }
  }
}
