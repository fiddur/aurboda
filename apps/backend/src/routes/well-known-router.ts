/**
 * `/.well-known/*` static metadata served by the backend.
 *
 * - `assetlinks.json` (Digital Asset Links) lets the Android Credential
 *   Manager share passkeys registered against this backend's domain with
 *   the matching official APK. Self-hosters can append additional Android
 *   signing fingerprints (e.g. for a custom-built APK) via the
 *   `ANDROID_APP_FINGERPRINTS` env var.
 */
import type { TypedRouter } from '../typed-router.ts'

import { typedRouter } from '../typed-router.ts'

export interface WellKnownConfig {
  androidPackageName: string
  androidFingerprints: string[]
}

interface AssetLinksTarget {
  namespace: 'android_app'
  package_name: string
  sha256_cert_fingerprints: string[]
}

interface AssetLinksStatement {
  relation: string[]
  target: AssetLinksTarget
}

const buildAssetLinks = (config: WellKnownConfig): AssetLinksStatement[] => {
  if (config.androidFingerprints.length === 0) return []
  return [
    {
      relation: [
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds',
      ],
      target: {
        namespace: 'android_app',
        package_name: config.androidPackageName,
        sha256_cert_fingerprints: config.androidFingerprints,
      },
    },
  ]
}

export const createWellKnownRouter = (config: WellKnownConfig): TypedRouter => {
  const router = typedRouter()
  const assetLinks = buildAssetLinks(config)

  router.get<Record<string, never>, AssetLinksStatement[]>(
    '/.well-known/assetlinks.json',
    (_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.json(assetLinks)
    },
  )

  return router
}
