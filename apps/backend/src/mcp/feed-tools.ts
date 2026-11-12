/** Mirrors the REST `/feed` and `/feed/following` capabilities. */
import {
  createArticleBodySchema,
  createArticleDraftBodySchema,
  feedPostsQuerySchema,
  shareChallengeBodySchema,
  shareDashboardPeriodBodySchema,
  shareExerciseBodySchema,
  followActorBodySchema,
  followTagBodySchema,
  followersQuerySchema,
  hashtagInputSchema,
  publicTagPostsQuerySchema,
  iso8601DateTimeSchema,
  postTagsInputSchema,
  previewArticleBodySchema,
  publishArticleDraftBodySchema,
  replyToPostBodySchema,
  shareActivityBodySchema,
  timelineQuerySchema,
  updateArticleBodySchema,
  updateArticleDraftBodySchema,
  updateFeedPostBodySchema,
  updateFollowingBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { FeedDeliver } from '../routes/feed-router.ts'
import type { ArticlePreviewer } from '../services/article-preview.ts'
import type { ReactionActions, ReactionResult, ReplyResult } from '../services/feed-reactions.ts'
import type { FollowerActions } from '../services/followers.ts'
import type { FollowActions } from '../services/following.ts'
import type { PublicTagActions } from '../services/public-tags.ts'
import type { RetroEnrichTrigger } from '../services/timeline-retro-enrich.ts'

import {
  createArticleDraft,
  createArticlePost,
  createChallengePost,
  createDashboardPost,
  createExercisePost,
  createFeedPost,
  deleteArticleDraft,
  deleteFeedPostWithQuotes,
  getActivityById,
  getArticleDraft,
  getFeedPostById,
  getTimelineEntryById,
  listArticleDrafts,
  listFeedFollowedTags,
  listFeedFollowers,
  listFeedFollowing,
  updateArticleDraft,
  updateFeedFollowingNotify,
  updateFeedPost,
} from '../db/index.ts'
import { isPubliclyVisible } from '../services/activitypub/object.ts'
import { REPLIES_TIMEOUT_MS } from '../services/activitypub/remote-replies.ts'
import {
  articleDraftPatch,
  emptyArticleDraftContent,
  normalizeArticleDraftContent,
  publishArticleDraft,
  serializeArticleDraft,
} from '../services/article-drafts.ts'
import { buildArticleMarkdown, renderableArticleBlocks } from '../services/article-export.ts'
import { mergeArticleContent, validateArticleContent } from '../services/article.ts'
import { resolveChallengeShare } from '../services/challenge-share.ts'
import {
  dashboardShareTags,
  previewDashboardShare,
  resolveDashboardShare,
} from '../services/feed-dashboard-share.ts'
import {
  exerciseShareTags,
  previewExerciseShare,
  resolveExerciseShare,
} from '../services/feed-exercise-share.ts'
import { listPostReactions } from '../services/feed-reactions.ts'
import {
  getFeedPage,
  normalizeFeedMessage,
  previewActivityShare,
  serializeFeedPost,
} from '../services/feed.ts'
import { serializeFollower } from '../services/followers.ts'
import { serializeFollowedTag, serializeFollowing } from '../services/following.ts'
import {
  activityKindTag,
  articleTexts,
  CHALLENGE_KIND_TAG,
  loadEditedPostTags,
  resolvePostTags,
  retagPost,
} from '../services/post-tags.ts'
import { getSettings } from '../services/settings.ts'
import { getThreadSnapshot, listOwnPostReplies, MAX_POST_REPLIES } from '../services/timeline-replies.ts'
import { getTimelinePage, reactionTarget } from '../services/timeline.ts'
import { withTimeout } from '../services/with-timeout.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

/** Map the `status` filter to the follower-list DB options. */
const followerStatusFilter = (status: 'accepted' | 'all' | 'pending'): { accepted?: boolean } => {
  if (status === 'pending') return { accepted: false }
  if (status === 'accepted') return { accepted: true }
  return {}
}

export interface FeedToolsOptions {
  deliver?: FeedDeliver
  followActions?: FollowActions
  followerActions?: FollowerActions
  /** Outbound like ⭐ / boost 🔄 / reply 🗨 actions; absent → those tools report unavailable. */
  reactionActions?: ReactionActions
  apiBaseUrl?: string
  retroEnrichTimeline?: RetroEnrichTrigger
  /** Canonical web origin, to build a shared challenge's public URL (#994). */
  webHost?: string
  /** The public tag pages (`list_public_tag_posts`); absent, the tool reports none. */
  publicTagActions?: Pick<PublicTagActions, 'page'>
  /** The article preview (`preview_article`), with the chart data it draws from; absent, the tool reports unavailable. */
  previewArticle?: ArticlePreviewer
}

export const registerFeedTools = (server: McpServer, user: string, options: FeedToolsOptions = {}) => {
  const {
    apiBaseUrl,
    deliver,
    followActions,
    followerActions,
    previewArticle,
    publicTagActions,
    reactionActions,
    retroEnrichTimeline,
    webHost,
  } = options

  /** Answer a reaction toggle with the updated entry, or the failure as a tool error. */
  const reactionResult = (result: ReactionResult) =>
    result.ok ? jsonResponse(result.entry) : errorResponse(result.error)
  /** Answer a reply with the created post, or the failure as a tool error. */
  const replyResult = (result: ReplyResult) =>
    result.ok ? jsonResponse(result.post) : errorResponse(result.error)
  server.tool(
    'list_feed',
    "List posts you have published to your feed, newest first, with their shared metric selection, series opt-in, and visibility. Pass `cursor` (from a previous call's `next_cursor`) to page.",
    { ...feedPostsQuerySchema.shape },
    async ({ cursor, limit }) => {
      const settings = await getSettings(user).catch(() => null)
      return jsonResponse(await getFeedPage(user, limit, cursor, { origin: webHost, settings }))
    },
  )

  server.tool(
    'share_activity',
    'Publish an activity to your feed. `included_metrics` are the scalar summaries shared; `series_metrics` is a SEPARATE, explicit opt-in that also exposes those metrics on the public read-only series endpoint. Both default to empty (privacy-conservative) — a high-resolution series is far more revealing than an average, so only opt in deliberately. The post gets hashtags (federated, clickable on Mastodon): your default tags plus the activity type (e.g. `#aurboda #running`) unless `tags` replaces them; `#tags` typed in the message are always added.',
    { activity_id: z.string().uuid().describe('The activity to share'), ...shareActivityBodySchema.shape },
    async ({ activity_id, ...body }) => {
      const activity = await getActivityById(user, activity_id)
      if (!activity) return errorResponse('Activity not found')
      const message = normalizeFeedMessage(body.message) ?? null
      const record = await createFeedPost(user, {
        activity_id: activity.id ?? activity_id,
        include_chart: body.include_chart,
        include_exercises: body.include_exercises,
        include_map: body.include_map,
        included_metrics: body.included_metrics,
        message,
        series_metrics: body.series_metrics,
        tags: await resolvePostTags(user, {
          explicit: body.tags,
          kindTag: activityKindTag(activity.activity_type),
          texts: [message],
        }),
        visibility: body.visibility,
      })
      // Fan out to followers (best-effort), same as the REST share route.
      deliver?.created(user, record, activity)
      return jsonResponse(await serializeFeedPost(user, record, { webHost }))
    },
  )

  server.tool(
    'preview_activity_share',
    'Preview what sharing an activity WOULD federate — the exact post text (HTML), its hashtags and resolved metric values for a given selection — without creating a post. Use before share_activity to show the user what leaves the instance.',
    { activity_id: z.string().uuid().describe('The activity to preview'), ...shareActivityBodySchema.shape },
    async ({ activity_id, ...body }) => {
      const activity = await getActivityById(user, activity_id)
      if (!activity) return errorResponse('Activity not found')
      return jsonResponse(
        await previewActivityShare(
          user,
          activity,
          {
            include_exercises: body.include_exercises,
            included_metrics: body.included_metrics,
            ...(body.message === undefined ? {} : { message: body.message }),
            ...(body.tags === undefined ? {} : { tags: body.tags }),
          },
          webHost,
        ),
      )
    },
  )

  server.tool(
    'update_feed_post',
    'Update a feed post (scalar metric selection, series opt-in, visibility, attachments, message, hashtags). Only provided fields change.',
    { id: z.string().uuid().describe('Feed post ID'), ...updateFeedPostBodySchema.shape },
    async ({ id, ...body }) => {
      const message = normalizeFeedMessage(body.message)
      const retag = await loadEditedPostTags(user, id, { message, tags: body.tags })
      if (!retag.found) return errorResponse('Feed post not found')
      const record = await updateFeedPost(user, id, {
        include_chart: body.include_chart,
        include_exercises: body.include_exercises,
        include_map: body.include_map,
        included_metrics: body.included_metrics,
        message,
        series_metrics: body.series_metrics,
        tags: retag.tags,
        visibility: body.visibility,
      })
      if (!record) return errorResponse('Feed post not found')
      // Federate the edit as an Update, same as the REST update route. Articles
      // and challenge shares have no linked activity, so they must go through
      // their own paths — the generic `updated` would silently no-op.
      if (record.kind === 'article') deliver?.updatedArticle(user, record)
      else if (record.kind === 'challenge') deliver?.updatedChallenge(user, record)
      else if (record.kind === 'exercise') deliver?.updatedExercise(user, record)
      else if (record.kind === 'dashboard') deliver?.updatedDashboard(user, record)
      else if (record.kind === 'reply') deliver?.updatedReply(user, record)
      else deliver?.updated(user, record)
      return jsonResponse(await serializeFeedPost(user, record, { webHost }))
    },
  )

  server.tool(
    'share_challenge',
    "Publish a challenge INVITATION to your feed: your personal note (markdown) plus the challenge's canonical join-by-URL link. Pass exactly one of `challenge_id` (one of your own challenges) or `participation_id` (a challenge you joined, possibly hosted elsewhere) — the server resolves the linked name/URL itself.",
    { ...shareChallengeBodySchema.shape },
    async ({ challenge_id, include_chart, message, participation_id, tags, visibility }) => {
      const resolved = await resolveChallengeShare(user, { challenge_id, participation_id }, webHost)
      if (!resolved.ok) return errorResponse(resolved.error)
      const note = normalizeFeedMessage(message) ?? null
      const record = await createChallengePost(user, {
        challenge: resolved.challenge,
        include_chart,
        message: note,
        tags: await resolvePostTags(user, { explicit: tags, kindTag: CHALLENGE_KIND_TAG, texts: [note] }),
        visibility,
      })
      deliver?.createdChallenge(user, record)
      return jsonResponse(await serializeFeedPost(user, record, { webHost }))
    },
  )

  server.tool(
    'share_exercise',
    "Publish one exercise's progress to your feed (one item value of one activity type, e.g. `sets.exercise` = `Bench Press` of `strength_training`): records and session count, the trend (with a trend image), optionally the last 5 sessions' sets, and a link to the exercise's public page only when it is published as a shared exercise. The data is resolved whenever the post is read. Use preview_exercise_share first to show what leaves the instance.",
    { ...shareExerciseBodySchema.shape },
    async (body) => {
      const resolved = await resolveExerciseShare(user, body, webHost)
      if (!resolved.ok) return errorResponse(resolved.error)
      const record = await createExercisePost(user, {
        exercise: resolved.exercise,
        include_chart: body.include_chart,
        message: normalizeFeedMessage(body.message) ?? null,
        tags: await exerciseShareTags(user, resolved.exercise, body),
        visibility: body.visibility,
      })
      deliver?.createdExercise(user, record)
      return jsonResponse(await serializeFeedPost(user, record, { webHost }))
    },
  )

  server.tool(
    'preview_exercise_share',
    'Preview what sharing an exercise WOULD federate — the exact post text (HTML) and the structured payload for the given opt-ins — without creating a post.',
    { ...shareExerciseBodySchema.shape },
    async (body) => {
      const preview = await previewExerciseShare(user, body, webHost)
      if (!preview.ok) return errorResponse(preview.error)
      return jsonResponse({ content: preview.content, structured: preview.structured, tags: preview.tags })
    },
  )

  server.tool(
    'share_dashboard_period',
    "Publish one FINISHED period of a period dashboard to your feed: the dashboard's widgets resolved for that period, with the change against the period before. Pass `dashboard_id` (one of your dashboards, from `list_shared_dashboards`) or omit it for the home dashboard; the dashboard must be a period dashboard, and `period` a finished period of its granularity: `2026-10` (month), `2026-W44` (ISO week) or `2026` (year). The post stores a snapshot of the dashboard's config at share time, so a later edit of the dashboard never changes it. A link to the dashboard's public page is included only when the dashboard is published (unlisted or public) and `include_link` is true; the home dashboard is never linked. Use preview_dashboard_period_share first to show what leaves the instance.",
    { ...shareDashboardPeriodBodySchema.shape },
    async (body) => {
      const resolved = await resolveDashboardShare(user, body, webHost)
      if (!resolved.ok) return errorResponse(resolved.error)
      const record = await createDashboardPost(user, {
        dashboard: resolved.dashboard,
        message: normalizeFeedMessage(body.message) ?? null,
        tags: await dashboardShareTags(user, resolved.dashboard, body),
        visibility: body.visibility,
      })
      deliver?.createdDashboard(user, record)
      return jsonResponse(await serializeFeedPost(user, record, { webHost }))
    },
  )

  server.tool(
    'preview_dashboard_period_share',
    "Preview what sharing a finished period of a period dashboard WOULD federate — the exact post text (HTML), the structured payload (the config snapshot and each widget's data for the period) and the hashtags — without creating a post. `dashboard_id` from `list_shared_dashboards`, or omitted for the home dashboard; `period` like `2026-10`, `2026-W44` or `2026`. The link is included only when the dashboard is published.",
    { ...shareDashboardPeriodBodySchema.shape },
    async (body) => {
      const preview = await previewDashboardShare(user, body, webHost)
      if (!preview.ok) return errorResponse(preview.error)
      return jsonResponse({ content: preview.content, structured: preview.structured, tags: preview.tags })
    },
  )

  server.tool(
    'create_article',
    'Publish a long-form ARTICLE to your feed: a title, markdown prose, and inline chart blocks over locked time windows. `blocks` is an ordered list of `{type:"prose", markdown}` or `{type:"chart", metric, start?, end?, bucket?, caption?}`. A chart block over `[start, end]` re-resolves live against that window; omit its start/end to inherit `default_start`/`default_end`. A `{type:"challenge", challenge_url, caption?}` block embeds a challenge\'s live standings and a join link; take `challenge_url` from `list_challenges` (`share_url`) or from a joined challenge\'s URL. A `{type:"impact", activity, activity_type, window_minutes?, start?, end?, caption?}` block shows HRV, heart rate and stress before, during and after each session of one activity over its window (like `get_activity_impact` with `match: "exact"`); name `activity` exactly as `get_hrv_activities_correlation` lists it. Use this (not `share_activity`) for a written analysis spanning multiple charts. It publishes (and federates) immediately; to let the user review first, use `create_article_draft` instead.',
    { ...createArticleBodySchema.shape },
    async (body) => {
      const built = await validateArticleContent({
        blocks: body.blocks,
        default_end: body.default_end,
        default_start: body.default_start,
        title: body.title,
      })
      if (!built.ok) return errorResponse(built.error)
      const record = await createArticlePost(user, {
        article: built.article,
        tags: await resolvePostTags(user, { explicit: body.tags, texts: articleTexts(built.article) }),
        visibility: body.visibility,
      })
      deliver?.createdArticle(user, record)
      return jsonResponse(await serializeFeedPost(user, record, { webHost }))
    },
  )

  server.tool(
    'update_article',
    'Update an ARTICLE post (title, blocks, default window, visibility). Provided fields replace the stored ones; omitted fields are unchanged. The `blocks` array, when given, replaces the whole ordered block list.',
    { id: z.string().uuid().describe('Feed post ID'), ...updateArticleBodySchema.shape },
    async ({ id, ...body }) => {
      const existing = await getFeedPostById(user, id)
      if (!existing || existing.kind !== 'article' || existing.article == null) {
        return errorResponse('Article not found')
      }
      const built = await validateArticleContent(mergeArticleContent(existing.article, body), {
        stored: existing.article,
      })
      if (!built.ok) return errorResponse(built.error)
      const record = await updateFeedPost(user, id, {
        article: built.article,
        tags: retagPost({
          after: articleTexts(built.article),
          before: articleTexts(existing.article),
          explicit: body.tags,
          stored: existing.tags,
        }),
        visibility: body.visibility,
      })
      if (!record) return errorResponse('Article not found')
      deliver?.updatedArticle(user, record)
      return jsonResponse(await serializeFeedPost(user, record, { webHost }))
    },
  )

  server.tool(
    'create_article_draft',
    'Save an ARTICLE DRAFT: a private, unpublished article the user can keep working on in the web editor (or via `update_article_draft`) and publish when ready. A draft is never federated or shown on any feed. It may be incomplete — an empty title, a chart block without `metric`, a correlation block without `trigger`/`outcome`, an impact block without `activity`. `article` takes the same shape as `create_article` (`title`, `blocks`, `default_start`, `default_end`); `visibility` is the audience it gets once published.',
    { ...createArticleDraftBodySchema.shape },
    async ({ article, visibility }) => {
      const record = await createArticleDraft(user, {
        article: article ? normalizeArticleDraftContent(article) : emptyArticleDraftContent(),
        visibility,
      })
      return jsonResponse(serializeArticleDraft(record))
    },
  )

  server.tool(
    'update_article_draft',
    'Update an ARTICLE DRAFT (title, blocks, default window, visibility). Provided fields replace the stored ones; omitted fields are unchanged. The `blocks` array, when given, replaces the whole ordered block list. The draft stays private until `publish_article_draft`.',
    // The window bounds are re-declared without `.nullable()`: a nullable field makes
    // clients that validate the tool list (e.g. Claude) drop the whole tool.
    {
      id: z.string().uuid().describe('Draft ID'),
      ...updateArticleDraftBodySchema.shape,
      default_end: iso8601DateTimeSchema.optional().describe('Default window end (ISO 8601)'),
      default_start: iso8601DateTimeSchema.optional().describe('Default window start (ISO 8601)'),
      tags: postTagsInputSchema
        .optional()
        .describe(
          "Hashtags the article gets when published, replacing your default tags; omitted keeps the draft's. A draft given tags here cannot be set back to the default tags over MCP (the REST PATCH can, with `tags: null`)",
        ),
    },
    async ({ id, ...body }) => {
      const existing = await getArticleDraft(user, id)
      if (!existing) return errorResponse('Draft not found')
      const record = await updateArticleDraft(user, id, articleDraftPatch(existing.article, body))
      if (!record) return errorResponse('Draft not found')
      return jsonResponse(serializeArticleDraft(record))
    },
  )

  server.tool(
    'list_article_drafts',
    'List your private ARTICLE DRAFTS, most recently saved first, with their content. Drafts are never federated or shown on any feed.',
    {},
    async () => jsonResponse({ drafts: (await listArticleDrafts(user)).map(serializeArticleDraft) }),
  )

  server.tool(
    'get_article_draft',
    'Get one private ARTICLE DRAFT by ID, with its full content.',
    { id: z.string().uuid().describe('Draft ID') },
    async ({ id }) => {
      const record = await getArticleDraft(user, id)
      return record ? jsonResponse(serializeArticleDraft(record)) : errorResponse('Draft not found')
    },
  )

  server.tool(
    'delete_article_draft',
    'Delete a private ARTICLE DRAFT by ID. Nothing was ever published from it, so nothing is retracted.',
    { id: z.string().uuid().describe('Draft ID') },
    async ({ id }) =>
      (await deleteArticleDraft(user, id))
        ? jsonResponse({ deleted: true, id })
        : errorResponse('Draft not found'),
  )

  server.tool(
    'publish_article_draft',
    "Publish an ARTICLE DRAFT to your feed (and federate it): validates it exactly like `create_article` — a title, a metric on every chart, trigger and outcome on every correlation, and a time window for each — and on success creates the article post and deletes the draft. An incomplete draft is refused with the reason and kept. `visibility` overrides the draft's own.",
    { id: z.string().uuid().describe('Draft ID'), ...publishArticleDraftBodySchema.shape },
    async ({ id, ...body }) => {
      const result = await publishArticleDraft(user, id, body)
      if (!result.ok) return errorResponse(result.error)
      deliver?.createdArticle(user, result.post)
      return jsonResponse(await serializeFeedPost(user, result.post, { webHost }))
    },
  )

  server.tool(
    'preview_article',
    "Preview what an ARTICLE (or an unfinished draft) WOULD federate, creating nothing: the Note `content` HTML, its title `name`, tags and numbered figure `attachments` (alt text, and whether Mastodon shows each: it keeps the first 4), `publish_error` (what still keeps it from publishing, or null), and `mastodon`: an emulation of Mastodon's web UI — the content after Mastodon's sanitiser without the trailing hashtag paragraph, and the hashtag bar — plus `notes` on what Mastodon changes for this post. Only complete blocks are previewed. `include_images` also returns each shown figure as SVG markup (`image_svg`, null when the block has no data to draw); it is meant for UIs.",
    { ...previewArticleBodySchema.shape },
    async (body) => {
      if (!previewArticle) return errorResponse('Article preview is not available')
      return jsonResponse(await previewArticle(user, body))
    },
  )

  server.tool(
    'export_article_markdown',
    'Export a published ARTICLE as paste-ready markdown for a text-only destination (e.g. r/QuantifiedSelf): the title, the prose blocks verbatim, and one image link per chart, correlation, challenge or impact block pointing at its rendered PNG. Paste the result and add your own write-up around the linked charts.',
    { id: z.string().uuid().describe('Feed post ID (must be an article)') },
    async ({ id }) => {
      const post = await getFeedPostById(user, id)
      if (!post || post.kind !== 'article' || post.article == null) return errorResponse('Article not found')
      // Export targets a public paste; a followers-only article's images need its
      // private token, so refuse rather than leak it (parity with the REST route).
      if (!isPubliclyVisible(post.visibility)) {
        return errorResponse(
          'A followers-only article can’t be exported — its charts need a private link. Make it public or unlisted first.',
        )
      }
      if (!apiBaseUrl) return errorResponse('Export is not available')
      const markdown = buildArticleMarkdown(
        apiBaseUrl,
        user,
        post.id,
        post.visibility,
        post.image_token,
        post.updated_at,
        post.article,
        // Blocks whose image would 404 (no data) get a note, not a dead link (#974).
        await renderableArticleBlocks(user, post.id, post.article),
      )
      return jsonResponse({ markdown })
    },
  )

  server.tool(
    'delete_feed_post',
    'Delete a feed post of any kind (activity share, article, or challenge) by ID. Unpublishes it and stops its public series from resolving.',
    { id: z.string().uuid().describe('Feed post ID') },
    async ({ id }) => {
      const existing = await getFeedPostById(user, id)
      if (!existing) return errorResponse('Feed post not found')
      const stamps = await deleteFeedPostWithQuotes(user, id)
      // Retract from followers with a Delete{Tombstone}, same as the REST route.
      deliver?.deleted(user, existing, stamps ?? [])
      return jsonResponse({ deleted: true, id })
    },
  )

  server.tool(
    'list_following',
    'List the people you follow (accepted and pending), with their handle, display name, and acceptance state. Followed hashtags are listed by `list_followed_tags`.',
    {},
    async () => {
      const records = await listFeedFollowing(user)
      return jsonResponse(records.map(serializeFollowing))
    },
  )

  server.tool(
    'list_timeline',
    'List your home timeline: posts received from the actors and hashtags you follow, newest first. Pass `cursor` (from a previous call) to page, and `tag` to list only posts carrying that hashtag. Each entry has its `tags`; a card boosted by a followed tag actor has `boosted_by.tag`.',
    { ...timelineQuerySchema.shape },
    async ({ cursor, limit, tag }) => {
      const page = await getTimelinePage(user, limit, cursor, { origin: webHost, tag })
      retroEnrichTimeline?.(user)
      return jsonResponse(page)
    },
  )

  server.tool(
    'list_public_tag_posts',
    "List a public tag page (`/tags/<tag>`): the public posts carrying the hashtag, from this server and others, newest first — what this server's instance actor receives from the tag's actor on the tag actor host, plus this server's own public posts with the tag. Only tags the admin configured have a page. Pass `cursor` (from a previous call) to page.",
    { tag: hashtagInputSchema, ...publicTagPostsQuerySchema.shape },
    async ({ cursor, tag }) => {
      const result = publicTagActions ? await publicTagActions.page(tag, cursor) : { ok: false as const }
      return result.ok ? jsonResponse(result.page) : errorResponse(`No public page for #${tag}`)
    },
  )

  server.tool(
    'get_timeline_replies',
    "Fetch a bounded snapshot of the replies to one home-timeline post (by the entry's local `id`) from its origin server, with YOUR OWN replies to the same post merged in (`mine: true`). `partial: true` means the fetch budget ran out before the thread did; `fetched: false` means the origin's thread could not be read at all — an empty list then means unknown, not empty.",
    { id: z.string().uuid() },
    async ({ id }) => {
      const entry = await getTimelineEntryById(user, id)
      if (entry == null) return errorResponse('Not found')
      if (!webHost) return errorResponse('Replies are not available')
      // A boost card stands for the ORIGINAL Note — the same target a like or a
      // reply resolves.
      const result = await withTimeout(
        getThreadSnapshot(user, webHost, reactionTarget(entry)),
        REPLIES_TIMEOUT_MS,
      ).catch(() => ({ fetched: false, partial: true, replies: [] }))
      return jsonResponse(result)
    },
  )

  server.tool(
    'reply_to_timeline_post',
    "Reply 🗨 to a post in your home timeline, by the entry's local `id` from `list_timeline`. Publishes a reply post (an AS2 `Create{Note}` with `inReplyTo` and a `Mention` of the author) delivered to your followers AND the author's inbox. `visibility` defaults to `unlisted`, the Mastodon convention for replies. Returns the created feed post.",
    {
      id: z.string().uuid().describe('Home-timeline entry id (the `id` from list_timeline)'),
      ...replyToPostBodySchema.shape,
    },
    async ({ id, ...body }) => {
      if (!reactionActions) return errorResponse('Replies are not available')
      return replyResult(await reactionActions.reply(user, id, body))
    },
  )

  server.tool(
    'get_feed_post_replies',
    'List the comments this instance holds under one of YOUR feed posts (by feed post id): the latest 100, oldest first. These are the replies remote actors delivered to you — no network fetch. Each is a full timeline entry, so it carries your like/boost state and can itself be replied to with `reply_to_timeline_post`.',
    { id: z.string().uuid().describe('Feed post ID') },
    async ({ id }) => {
      if (!webHost) return errorResponse('Replies are not available')
      if ((await getFeedPostById(user, id)) == null) return errorResponse('Feed post not found')
      return jsonResponse(await listOwnPostReplies(user, webHost, id, MAX_POST_REPLIES))
    },
  )

  server.tool(
    'like_timeline_post',
    "Favourite (AS2 `Like`) a post in your home timeline, by the entry's local `id` from `list_timeline`. Delivers the Like to the post author. Idempotent — liking twice changes nothing. Returns the updated entry (`liked: true`).",
    { id: z.string().uuid().describe('Home-timeline entry id (the `id` from list_timeline)') },
    async ({ id }) => {
      if (!reactionActions) return errorResponse('Reactions are not available')
      return reactionResult(await reactionActions.like(user, id))
    },
  )

  server.tool(
    'unlike_timeline_post',
    "Remove your favourite from a home-timeline post (delivers an `Undo{Like}`), by the entry's local `id`. Idempotent — unliking something you never liked changes nothing.",
    { id: z.string().uuid().describe('Home-timeline entry id (the `id` from list_timeline)') },
    async ({ id }) => {
      if (!reactionActions) return errorResponse('Reactions are not available')
      return reactionResult(await reactionActions.unlike(user, id))
    },
  )

  server.tool(
    'boost_timeline_post',
    'Boost (AS2 `Announce`, Mastodon "reblog") a post in your home timeline, by the entry\'s local `id` from `list_timeline`. The boost is public and is delivered to your followers AND the post author. Idempotent. Returns the updated entry (`boosted: true`).',
    { id: z.string().uuid().describe('Home-timeline entry id (the `id` from list_timeline)') },
    async ({ id }) => {
      if (!reactionActions) return errorResponse('Reactions are not available')
      return reactionResult(await reactionActions.boost(user, id))
    },
  )

  server.tool(
    'unboost_timeline_post',
    "Retract your boost of a home-timeline post (delivers an `Undo{Announce}`), by the entry's local `id`. Idempotent.",
    { id: z.string().uuid().describe('Home-timeline entry id (the `id` from list_timeline)') },
    async ({ id }) => {
      if (!reactionActions) return errorResponse('Reactions are not available')
      return reactionResult(await reactionActions.unboost(user, id))
    },
  )

  server.tool(
    'list_feed_post_reactions',
    'List who favourited, boosted or quoted one of YOUR feed posts (by feed post id), newest first. Likes and boosts are the `Like`/`Announce` remote servers push; a quote (kind `quote`, with the quoting post in `url`) is one whose FEP-044f quote request we approved. A reaction with no resolvable actor still counts.',
    { id: z.string().uuid().describe('Feed post ID') },
    async ({ id }) => {
      if ((await getFeedPostById(user, id)) == null) return errorResponse('Feed post not found')
      return jsonResponse(await listPostReactions(user, id))
    },
  )

  server.tool(
    'follow_actor',
    'Follow a fediverse actor so their posts arrive in your feed. `handle` is `@user@host`, `user@host`, or an actor URL. Sends a Follow; the follow is `pending` until the remote server accepts it.',
    { ...followActorBodySchema.shape },
    async ({ handle }) => {
      if (!followActions) return errorResponse('Following is not available')
      const result = await followActions.follow(user, handle)
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse(serializeFollowing(result.record))
    },
  )

  server.tool(
    'unfollow_actor',
    'Unfollow an actor by the local follow id (from `list_following`). Sends an Undo{Follow} and removes them from your following list.',
    { id: z.string().uuid().describe('Local follow id (the `id` from list_following)') },
    async ({ id }) => {
      if (!followActions) return errorResponse('Following is not available')
      const removed = await followActions.unfollow(user, id)
      if (!removed) return errorResponse('Not following that actor')
      return jsonResponse({ id, unfollowed: true })
    },
  )

  server.tool(
    'list_followed_tags',
    'List the hashtags you follow (accepted and pending). Each is the follow of its tag actor (e.g. `running@tags.pub`). Tag follows never raise post notifications.',
    {},
    async () => {
      const records = await listFeedFollowedTags(user)
      return jsonResponse(records.flatMap((record) => serializeFollowedTag(record) ?? []))
    },
  )

  server.tool(
    'follow_tag',
    "Follow a hashtag, e.g. `#running`: follows the tag actor `<tag>@<tag actor host>` (default `running@tags.pub`), which boosts every public post it sees carrying that hashtag into your home timeline. Pending until the tag actor accepts. Filter the timeline to it with `list_timeline`'s `tag`.",
    { ...followTagBodySchema.shape },
    async ({ tag }) => {
      if (!followActions) return errorResponse('Following is not available')
      const result = await followActions.followTag(user, tag)
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse(serializeFollowedTag(result.record))
    },
  )

  server.tool(
    'unfollow_tag',
    'Unfollow a hashtag (by the tag, with or without `#`). Sends an Undo{Follow} to its tag actor and removes the posts it boosted from your timeline.',
    { ...followTagBodySchema.shape },
    async ({ tag }) => {
      if (!followActions) return errorResponse('Following is not available')
      const removed = await followActions.unfollowTag(user, tag)
      if (!removed) return errorResponse('Not following that tag')
      return jsonResponse({ tag, unfollowed: true })
    },
  )

  server.tool(
    'set_following_notify',
    'Enable or disable notifications for new posts from a followed actor (by the local follow id from `list_following`).',
    {
      id: z.string().uuid().describe('Local follow id (the `id` from list_following)'),
      ...updateFollowingBodySchema.shape,
    },
    async ({ id, notify_on_post }) => {
      const record = await updateFeedFollowingNotify(user, id, notify_on_post)
      if (!record) return errorResponse('Not following that actor')
      return jsonResponse(serializeFollowing(record))
    },
  )

  server.tool(
    'list_followers',
    'List the actors that follow you, with their handle, display name, and acceptance state. Pass `status` to see only `pending` follow requests or only `accepted` followers (default `all`). Requests are pending only when you have enabled manual follower approval.',
    { ...followersQuerySchema.shape },
    async ({ status }) => {
      const records = await listFeedFollowers(user, followerStatusFilter(status))
      return jsonResponse(records.map(serializeFollower))
    },
  )

  server.tool(
    'approve_follower',
    'Approve a pending follow request by the local follower id (from `list_followers`). Marks them an accepted follower and sends the Accept.',
    { id: z.string().uuid().describe('Local follower id (the `id` from list_followers)') },
    async ({ id }) => {
      if (!followerActions) return errorResponse('Follower management is not available')
      const follower = await followerActions.approve(user, id)
      if (!follower) return errorResponse('No such follower')
      return jsonResponse(follower)
    },
  )

  server.tool(
    'reject_follower',
    'Reject a pending follow request, or remove an existing follower, by the local follower id (from `list_followers`). Sends a Reject and drops them.',
    { id: z.string().uuid().describe('Local follower id (the `id` from list_followers)') },
    async ({ id }) => {
      if (!followerActions) return errorResponse('Follower management is not available')
      const removed = await followerActions.reject(user, id)
      if (!removed) return errorResponse('No such follower')
      return jsonResponse({ id, rejected: true })
    },
  )
}
