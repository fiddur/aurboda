/**
 * The version this server reports (`/status`, NodeInfo, `/.well-known/aurboda`):
 * the release number `1.0.<n>` on an image built from `main`, else the commit sha.
 */
export const appVersion = (env: NodeJS.ProcessEnv = process.env): string =>
  env.APP_VERSION || env.BUILD_SHA || 'dev'
