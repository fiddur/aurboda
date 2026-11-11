/**
 * Serves `/u/:username[/:slug]/opengraph-image.png` and
 * `/u/:username/posts/:postId/opengraph-image.png` — a 1200×630 branded card
 * rendered per resource. Mounted BEFORE the share-html router so these specific
 * routes win over the generic `/u/:username/:slug` HTML route.
 *
 * Only public resources get a rendered card; anything else (unlisted, unknown,
 * invalid) redirects to the branded static default, so a private resource never
 * yields a bespoke image. Rendered PNGs are memoised in a small bounded cache
 * (render is CPU-heavy and inputs rarely change).
 */
import type { SharedExerciseData } from '@aurboda/api-spec'

import { type Response, Router } from 'express'

import type { PostChart } from '../services/charts/post-chart-svg.ts'
import type { OgCard } from '../services/og-image.ts'
import type { ResolvedPost } from '../services/post-card.ts'
import type { ResolvedExercise } from './share-html-router.ts'

import { isValidUsername } from '../api/auth-routes.ts'
import { describeChallenge, type ResolvedChallenge } from '../services/challenge-card.ts'
import { describeExercise } from '../services/exercise-card.ts'
import { clampTitle } from '../services/og-image.ts'
import { postEyebrow } from '../services/post-card.ts'
import { timeBucket, TREND_BUCKET_MS } from '../services/post-chart.ts'
import { defaultOgImage } from '../services/share-meta.ts'
import { UUID_RE } from '../utils.ts'

interface ResolvedDashboard {
  name: string
  is_public: boolean
  /** ISO timestamp of the board's last edit, which keys its card. */
  updated_at: string
}

export interface OgImageDeps {
  webHost: string
  resolveDashboard: (username: string, slug: string) => Promise<ResolvedDashboard | null>
  resolveChallenge: (username: string, slug: string) => Promise<ResolvedChallenge | null>
  resolveExercise: (username: string, slug: string) => Promise<ResolvedExercise | null>
  resolvePost: (username: string, postId: string) => Promise<ResolvedPost | null>
  /** The chart a public post's feed attachment draws (`postCardChart`), or null when it has none. */
  loadPostChart: (username: string, postId: string) => Promise<PostChart | null>
  /** The chart a public dashboard's card draws (`loadPublicDashboardChartWith`), or null when it has none. */
  loadDashboardChart: (username: string, slug: string) => Promise<PostChart | null>
  /** The public page's data for a shared exercise, with the owner's timezone. */
  loadExerciseCard: (
    username: string,
    exercise: ExerciseShare,
  ) => Promise<{ data: SharedExerciseData; timeZone: string }>
  /** Start of the newest session with the shared value, or null; cheap enough to run per request. */
  latestExerciseSession: (username: string, exercise: ExerciseShare) => Promise<string | null>
  profileExists: (username: string) => Promise<boolean>
  renderImage: (card: OgCard) => Promise<Buffer>
  /** The owner's avatar as a `data:` URI, embedded in the rendered card. */
  loadAvatarDataUri: (username: string) => Promise<string>
  /** The challenge's banner as a `data:` URI, or undefined when it has none. */
  loadBannerDataUri: (username: string, challengeId: string) => Promise<string | undefined>
  now?: () => Date
}

type ExerciseShare = Pick<ResolvedExercise, 'activity_type' | 'field' | 'value'>

/** How many rendered cards to keep in memory before evicting the oldest. */
const MAX_CACHE_ENTRIES = 200

export const createOgImageRouter = (deps: OgImageDeps): Router => {
  const {
    latestExerciseSession,
    loadAvatarDataUri,
    loadBannerDataUri,
    loadDashboardChart,
    loadExerciseCard,
    loadPostChart,
    profileExists,
    renderImage,
    resolveChallenge,
    resolveDashboard,
    resolveExercise,
    resolvePost,
    webHost,
  } = deps
  const now = deps.now ?? (() => new Date())
  const router = Router()

  // The avatar is decorative, so a transient avatar-load failure must not drop
  // an otherwise-renderable public card to the generic default — render without
  // it instead.
  const avatarOrUndefined = async (username: string): Promise<string | undefined> => {
    try {
      return await loadAvatarDataUri(username)
    } catch (error) {
      console.error('OG avatar load failed, rendering card without it:', error)
      return undefined
    }
  }
  // Decorative too: a failed banner load renders the themed card instead.
  const bannerOrUndefined = async (username: string, challengeId: string): Promise<string | undefined> => {
    try {
      return await loadBannerDataUri(username, challengeId)
    } catch (error) {
      console.error('OG banner load failed, rendering the themed card:', error)
      return undefined
    }
  }
  // A card without its chart still says what it is, so a failed chart load renders that; `failed`
  // tells `sendImage` not to keep it.
  const guardedChart = (load: () => Promise<PostChart | null>) => {
    let failed = false
    return {
      failed: () => failed,
      load: async (): Promise<PostChart | null> => {
        try {
          return await load()
        } catch (error) {
          console.error('OG chart load failed, rendering the card without it:', error)
          failed = true
          return null
        }
      },
    }
  }
  const cache = new Map<string, Buffer>()
  // Collapses concurrent misses for the same key into a single render, so a
  // fresh share hit by several crawlers at once doesn't run N identical
  // CPU-heavy Satori renders in parallel.
  const inFlight = new Map<string, Promise<Buffer>>()

  // The card is built lazily so the avatar is only fetched on a cache miss, not
  // on every request. The cache key embeds the resource name (renames refresh);
  // an avatar change propagates on cache eviction / process restart.
  // `memoise` is asked once the card is rendered: a card built from a failed load is served but
  // not kept, so the next request tries again.
  const render = async (
    key: string,
    buildCard: () => Promise<OgCard>,
    memoise: () => boolean,
  ): Promise<Buffer> => {
    const cached = cache.get(key)
    if (cached) return cached

    const pending = inFlight.get(key)
    if (pending) return pending

    const promise = buildCard().then((card) => renderImage(card))
    inFlight.set(key, promise)
    try {
      const png = await promise
      if (!memoise()) return png
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      cache.set(key, png)
      return png
    } finally {
      inFlight.delete(key)
    }
  }

  const redirectToDefault = (res: Response): void => {
    // Cache the redirect briefly so crawler hits on non-public/unknown share
    // URLs don't re-resolve the DB every time; short enough that a resource
    // turned public starts serving its rendered card within minutes.
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.redirect(302, defaultOgImage(webHost))
  }

  const sendImage = async (
    res: Response,
    key: string,
    buildCard: () => Promise<OgCard>,
    memoise: () => boolean = () => true,
  ): Promise<void> => {
    let png: Buffer
    try {
      png = await render(key, buildCard, memoise)
    } catch (error) {
      // The whole design is "always yield some image", so a transient
      // Satori/sharp failure degrades to the branded default rather than 500.
      console.error('OG image render failed, serving default:', error)
      return redirectToDefault(res)
    }
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.type('png').send(png)
  }

  router.get('/u/:username/posts/:postId/opengraph-image.png', async (req, res) => {
    const { postId, username } = req.params
    if (!isValidUsername(username) || !UUID_RE.test(postId)) return redirectToDefault(res)
    const post = await resolvePost(username, postId)
    if (!post?.is_public) return redirectToDefault(res)
    const description = post.description.trim()
    const subtitle = description ? clampTitle(description, 70) : undefined
    // The chart reads live data (a challenge's standings, an exercise's sessions) that moves without
    // the post changing; the time bucket redraws it as often as its feed image, and it is loaded
    // only on a miss.
    const bucket = post.chart_bucket_ms ? `:${timeBucket(now().getTime(), post.chart_bucket_ms)}` : ''
    const chart = guardedChart(() => loadPostChart(username, postId))
    return sendImage(
      res,
      `post:${username}/${postId}:${post.updated_at}:${post.title}:${subtitle ?? ''}${bucket}`,
      async () => {
        const drawn = await chart.load()
        return {
          avatarDataUri: await avatarOrUndefined(username),
          eyebrow: postEyebrow(post.kind),
          kind: 'post',
          title: post.title,
          username,
          ...(subtitle ? { subtitle } : {}),
          ...(drawn ? { chart: drawn } : {}),
        }
      },
      () => !chart.failed(),
    )
  })

  router.get('/u/:username/:slug/opengraph-image.png', async (req, res) => {
    const { slug, username } = req.params
    if (!isValidUsername(username)) return redirectToDefault(res)

    const dashboard = await resolveDashboard(username, slug)
    if (dashboard?.is_public) {
      // An edit bumps the version; the data under the chart moves on with the time bucket, and is
      // loaded only on a miss.
      const bucket = timeBucket(now().getTime(), TREND_BUCKET_MS)
      const chart = guardedChart(() => loadDashboardChart(username, slug))
      return sendImage(
        res,
        `d:${username}/${slug}:${dashboard.name}:${dashboard.updated_at}:${bucket}`,
        async () => {
          const drawn = await chart.load()
          return {
            avatarDataUri: await avatarOrUndefined(username),
            kind: 'dashboard',
            title: dashboard.name,
            username,
            ...(drawn ? { chart: drawn } : {}),
          }
        },
        () => !chart.failed(),
      )
    }

    const challenge = dashboard ? null : await resolveChallenge(username, slug)
    if (challenge?.is_public) {
      const details = describeChallenge(challenge, now())
      // The phrase moves daily and totals move as data syncs; keying on both
      // re-renders the memoised card instead of serving stale standings.
      const standings = details.members.map((m) => `${m.name}=${m.total}`).join(',')
      return sendImage(
        res,
        `c:${username}/${slug}:${challenge.name}:${details.phrase}:${standings}:${challenge.banner_updated_at ?? ''}`,
        async () => ({
          avatarDataUri: await avatarOrUndefined(username),
          challenge: challenge.banner_updated_at
            ? { ...details, bannerDataUri: await bannerOrUndefined(username, challenge.id) }
            : details,
          kind: 'challenge',
          title: challenge.name,
          username,
        }),
      )
    }

    const exercise = dashboard || challenge ? null : await resolveExercise(username, slug)
    if (exercise?.is_public) {
      // A new session moves the records and the trend; keying on its start re-renders the card.
      const latest = await latestExerciseSession(username, exercise)
      return sendImage(
        res,
        `x:${username}/${slug}:${exercise.name}:${exercise.activity_type_name}:${latest ?? ''}`,
        async () => {
          const { data, timeZone } = await loadExerciseCard(username, exercise)
          return {
            avatarDataUri: await avatarOrUndefined(username),
            exercise: describeExercise(data, exercise.activity_type_name, timeZone),
            kind: 'exercise',
            title: exercise.name,
            username,
          }
        },
      )
    }

    return redirectToDefault(res)
  })

  router.get('/u/:username/opengraph-image.png', async (req, res) => {
    const { username } = req.params
    if (isValidUsername(username) && (await profileExists(username))) {
      return sendImage(res, `p:${username}`, async () => ({
        avatarDataUri: await avatarOrUndefined(username),
        kind: 'profile',
        title: username,
      }))
    }
    return redirectToDefault(res)
  })

  return router
}
