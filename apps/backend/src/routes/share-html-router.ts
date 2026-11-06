/**
 * nginx proxies `/u/*` to this router so JS-less crawlers receive an
 * index.html whose <head> carries Open Graph / Twitter / description meta for
 * the resolved resource. The body is still the SPA shell — browsers hydrate it
 * as usual; only the head is enriched.
 *
 * Rich meta is emitted only for `is_public` resources. Unlisted dashboards
 * (reachable by slug but not listed) and unknown resources fall back to generic
 * site meta so a private resource's title/description is never handed to a
 * crawler.
 */
import { type Response, Router } from 'express'

import { isValidUsername } from '../api/auth-routes.ts'
import {
  getActivityTypeDefinition,
  getChallengeBySlug,
  getFeedPostById,
  getSharedDashboardBySlug,
  getSharedExerciseBySlug,
  listChallengeMembers,
  listPublicSharedDashboards,
} from '../db/index.ts'
import { proseToPlainText } from '../services/activitypub/article-object.ts'
import { cardMembers, describeChallenge, type ResolvedChallenge } from '../services/challenge-card.ts'
import {
  buildArticleShareMeta,
  buildBlogShareMeta,
  buildChallengeShareMeta,
  buildDashboardShareMeta,
  buildDefaultShareMeta,
  buildExerciseShareMeta,
  buildProfileShareMeta,
  injectShareMeta,
  oembedDiscoveryUrl,
  renderShareMetaTags,
  type ShareMeta,
} from '../services/share-meta.ts'
import {
  buildArticlesAtomUrl,
  buildBlogUrl,
  buildPostUrl,
  buildProfileUrl,
  buildShareUrl,
} from '../services/share-urls.ts'

/** A public resource resolved just far enough to build meta from. */
interface ResolvedResource {
  name: string
  is_public: boolean
  /** Author-provided description (dashboards only), for the meta description. */
  description?: string
}

export interface ResolvedExercise {
  id: string
  is_public: boolean
  name: string
  activity_type: string
  field: string
  value: string
  activity_type_name: string
}

/** An article post resolved just far enough to build its permalink meta from. */
export interface ResolvedArticle {
  /** `public` only: an unlisted article is reachable but never described to crawlers. */
  is_public: boolean
  title: string
  /** Plain text of the article's first prose block. */
  excerpt: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ShareHtmlDeps {
  /** Public base URL of the web app, used to build canonical/share URLs. */
  webHost: string
  /** Public base URL of the API, for the Atom feed discovery link. */
  apiBaseUrl: string
  /** Loads the SPA index.html template, or null if unavailable. */
  loadTemplate: () => Promise<string | null>
  resolveDashboard: (username: string, slug: string) => Promise<ResolvedResource | null>
  resolveChallenge: (username: string, slug: string) => Promise<ResolvedChallenge | null>
  resolveExercise: (username: string, slug: string) => Promise<ResolvedExercise | null>
  /** An article post by id (non-article posts resolve to null). */
  resolveArticle: (username: string, postId: string) => Promise<ResolvedArticle | null>
  /** True if the user's public profile exists (db reachable). */
  profileExists: (username: string) => Promise<boolean>
  now?: () => Date
}

/** Connecting to a non-existent user database fails with invalid_catalog_name. */
const isMissingDatabase = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { code?: string }).code === '3D000'

/**
 * Concrete, missing-database-safe resolvers backed by the user databases.
 * Split out so the router can be unit-tested with fakes.
 */
export const createShareResolvers = (): Pick<
  ShareHtmlDeps,
  'resolveDashboard' | 'resolveChallenge' | 'resolveExercise' | 'resolveArticle' | 'profileExists'
> => ({
  profileExists: async (username) => {
    try {
      await listPublicSharedDashboards(username)
      return true
    } catch (error) {
      if (isMissingDatabase(error)) return false
      throw error
    }
  },
  resolveArticle: async (username, postId) => {
    try {
      const post = await getFeedPostById(username, postId)
      if (!post || post.kind !== 'article' || !post.article) return null
      const firstProse = post.article.blocks.find((block) => block.type === 'prose')
      return {
        excerpt: firstProse ? proseToPlainText(firstProse.markdown) : '',
        is_public: post.visibility === 'public',
        title: post.article.title,
      }
    } catch (error) {
      if (isMissingDatabase(error)) return null
      throw error
    }
  },
  resolveChallenge: async (username, slug) => {
    try {
      const challenge = await getChallengeBySlug(username, slug)
      if (!challenge) return null
      const members = challenge.is_public ? await listChallengeMembers(username, challenge.id) : []
      return {
        banner_updated_at: challenge.banner_updated_at?.toISOString() ?? null,
        end_ts: challenge.end_ts.toISOString(),
        id: challenge.id,
        is_public: challenge.is_public,
        members: cardMembers(members, username),
        name: challenge.name,
        spec: {
          filter_value: challenge.spec.filter_value,
          measure: challenge.spec.measure,
          pattern: challenge.spec.pattern,
          source_type: challenge.spec.source_type,
          unit: challenge.spec.unit,
        },
        start_ts: challenge.start_ts.toISOString(),
        timezone: challenge.timezone,
      }
    } catch (error) {
      if (isMissingDatabase(error)) return null
      throw error
    }
  },
  resolveExercise: async (username, slug) => {
    try {
      const exercise = await getSharedExerciseBySlug(username, slug)
      if (!exercise) return null
      const definition = exercise.is_public
        ? await getActivityTypeDefinition(username, exercise.activity_type)
        : null
      return {
        activity_type: exercise.activity_type,
        activity_type_name: definition?.display_name ?? exercise.activity_type,
        field: exercise.field,
        id: exercise.id,
        is_public: exercise.is_public,
        name: exercise.name,
        value: exercise.value,
      }
    } catch (error) {
      if (isMissingDatabase(error)) return null
      throw error
    }
  },
  resolveDashboard: async (username, slug) => {
    try {
      const dashboard = await getSharedDashboardBySlug(username, slug)
      return dashboard
        ? {
            description: dashboard.config.description,
            is_public: dashboard.is_public,
            name: dashboard.name,
          }
        : null
    } catch (error) {
      if (isMissingDatabase(error)) return null
      throw error
    }
  },
})

/** Minimal crawler-friendly document when the SPA template is unavailable. */
const fallbackHtml = (meta: ShareMeta): string =>
  `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${meta.title.replaceAll('<', '&lt;')}</title>
    ${renderShareMetaTags(meta)}
  </head>
  <body>
    <p><a href="${meta.url.replaceAll('"', '&quot;')}">${meta.title.replaceAll('<', '&lt;')}</a></p>
  </body>
</html>`

const sendHtml = async (
  loadTemplate: ShareHtmlDeps['loadTemplate'],
  meta: ShareMeta,
  isRich: boolean,
  res: Response,
): Promise<void> => {
  const template = await loadTemplate()
  const html = template ? injectShareMeta(template, meta) : fallbackHtml(meta)
  // Rich (public) meta is safe to cache aggressively; generic fallbacks briefly.
  res.setHeader('Cache-Control', isRich ? 'public, max-age=300' : 'public, max-age=60')
  res.type('html').send(html)
}

export const createShareHtmlRouter = (deps: ShareHtmlDeps): Router => {
  const {
    apiBaseUrl,
    loadTemplate,
    profileExists,
    resolveArticle,
    resolveChallenge,
    resolveDashboard,
    resolveExercise,
    webHost,
  } = deps
  const now = deps.now ?? (() => new Date())
  const router = Router()

  // Attach the oEmbed discovery link to a public resource's meta.
  const withOembed = (meta: ShareMeta, resourceUrl: string): ShareMeta => ({
    ...meta,
    oembedUrl: oembedDiscoveryUrl(webHost, resourceUrl),
  })

  router.get('/u/:username/articles', async (req, res) => {
    const { username } = req.params
    const url = buildBlogUrl(webHost, username)
    if (isValidUsername(username) && (await profileExists(username))) {
      const meta = buildBlogShareMeta({
        feedUrl: buildArticlesAtomUrl(apiBaseUrl, username),
        profileUrl: buildProfileUrl(webHost, username),
        url,
        username,
      })
      return sendHtml(loadTemplate, meta, true, res)
    }
    return sendHtml(loadTemplate, buildDefaultShareMeta(webHost, url), false, res)
  })

  router.get('/u/:username/posts/:postId', async (req, res) => {
    const { postId, username } = req.params
    const url = buildPostUrl(webHost, username, postId)
    const article =
      isValidUsername(username) && UUID_RE.test(postId) ? await resolveArticle(username, postId) : null
    if (article?.is_public) {
      const meta = buildArticleShareMeta({
        excerpt: article.excerpt,
        feedUrl: buildArticlesAtomUrl(apiBaseUrl, username),
        profileUrl: buildProfileUrl(webHost, username),
        title: article.title,
        url,
        username,
      })
      return sendHtml(loadTemplate, meta, true, res)
    }
    return sendHtml(loadTemplate, buildDefaultShareMeta(webHost, url), false, res)
  })

  router.get('/u/:username/:slug', async (req, res) => {
    const { slug, username } = req.params
    const url = buildShareUrl(webHost, username, slug)
    if (!isValidUsername(username)) {
      return sendHtml(loadTemplate, buildDefaultShareMeta(webHost, url), false, res)
    }

    const dashboard = await resolveDashboard(username, slug)
    if (dashboard?.is_public) {
      return sendHtml(
        loadTemplate,
        withOembed(
          buildDashboardShareMeta({
            description: dashboard.description,
            name: dashboard.name,
            url,
            username,
          }),
          url,
        ),
        true,
        res,
      )
    }

    const challenge = dashboard ? null : await resolveChallenge(username, slug)
    if (challenge?.is_public) {
      const { joined, measure, members, phrase, range, status } = describeChallenge(challenge, now())
      return sendHtml(
        loadTemplate,
        withOembed(
          buildChallengeShareMeta({
            details: { joined, measure, participants: members.length, phrase, range, status },
            name: challenge.name,
            url,
            username,
          }),
          url,
        ),
        true,
        res,
      )
    }

    const exercise = dashboard || challenge ? null : await resolveExercise(username, slug)
    if (exercise?.is_public) {
      return sendHtml(
        loadTemplate,
        withOembed(
          buildExerciseShareMeta({
            activityTypeName: exercise.activity_type_name,
            name: exercise.name,
            url,
            username,
            value: exercise.value,
          }),
          url,
        ),
        true,
        res,
      )
    }

    // Unlisted (found but not public) or unknown: generic meta, no leak.
    return sendHtml(loadTemplate, buildDefaultShareMeta(webHost, url), false, res)
  })

  router.get('/u/:username', async (req, res) => {
    const { username } = req.params
    const url = buildProfileUrl(webHost, username)
    if (isValidUsername(username) && (await profileExists(username))) {
      return sendHtml(loadTemplate, withOembed(buildProfileShareMeta({ url, username }), url), true, res)
    }
    return sendHtml(loadTemplate, buildDefaultShareMeta(webHost, url), false, res)
  })

  // nginx proxies the whole /u/* subtree here, so any other shape (trailing
  // slash, a future deeper route) must still return the SPA shell — with
  // generic meta — instead of a 404, mirroring nginx's index.html fallback.
  router.get(/^\/u\//, (req, res) => {
    const url = `${webHost.replace(/\/+$/, '')}${req.path}`
    return sendHtml(loadTemplate, buildDefaultShareMeta(webHost, url), false, res)
  })

  return router
}
