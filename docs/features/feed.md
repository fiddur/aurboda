# Federated Activity Feed

The feed is how you share with friends. Share a run, a ride or a gym session from its page and
pick exactly which numbers to show, with a preview of what will leave your server; write a longer
article with live charts; invite people to a challenge; or post your progress on one exercise or a
month of your dashboard. Follow people on any Aurboda server, or on Mastodon and the rest of the
fediverse, and their posts appear in your home timeline, where you can like, boost and reply.
People on Mastodon can follow you in turn. This page describes how it works in detail;
[Using it in the web app](#using-it-in-the-web-app) is the user-facing part.

The activity feed lets a user publish an **activity** (a run, a night's sleep, a
meditation, …) to their public feed, choosing **per post exactly which data leaves the
instance**, and have it delivered over **ActivityPub** to followers on Mastodon and the
wider fediverse. It reuses the same base-URL identity and `/u/<username>` namespace as
[shared dashboards](./sharing.md) and [challenges](./challenges.md).

The feed is built on [Fedify](https://fedify.dev). It has three layers:

1. **Persistence + metric selection** — what a post is and what it exposes.
2. **Public series endpoint** — the unauthenticated, data-driven privacy boundary for
   high-resolution series.
3. **ActivityPub federation** — a per-user actor, WebFinger discovery, follower
   inbox/outbox, and delivery of the post's lifecycle (create / update / delete).

## Feed posts

A feed post has a **`kind`**:

- **`activity`** (the default) — references one of the user's activities and shares a
  bounded metric selection (below). This is the original kind.
- **`article`** — a long-form post: a `title`, markdown prose, and inline **chart**,
  **correlation** and **impact** blocks, each over a locked `[start, end]` window (blocks inherit an
  article-level default window unless they override it). Data re-resolves **live**
  against the locked window — no data snapshot. A **chart block** draws one metric; a
  **correlation block** pairs a `trigger` and an `outcome` selector (the exploratory
  correlation engine's dimensions, with an optional `lag_days`) and renders as a scatter
  with the Pearson/Spearman coefficients and n. An **impact block** names one `activity`
  exactly as the Analyze context table groups it (with its `activity_type`: an activity
  type, a location, a screen-time category, or — set through the API — an app or a tag) and
  an optional `window_minutes` (10–1440, default 30), and shows the Analyze page's impact
  chart over its window: HRV, heart rate and stress in the buckets before, during and after
  each session, each on its own scale, with the paired before → after change of each
  (`GET /correlations/activity-impact/:activity` with `match=exact` and the block's
  `start`/`end`). A **challenge block** embeds a challenge by
  its public URL (`challenge_url`, plus an optional `caption`): one hosted here (your own or
  another local user's) or on another instance. It has no window; it shows the challenge's
  live standings (race chart and leaderboard) and a **Join** link to the challenge page,
  where the join flow is. The URL is stored canonically (no query string or fragment, scheme
  and host lowercased). Saving checks that a URL hosted here names an existing challenge
  ("Block N: challenge not found"); an edit checks only the challenge URLs the stored article
  does not already link, so a challenge deleted since does not block later edits. A remote URL
  is not fetched at save time and resolves best-effort when the article renders. Modelled as a post kind on the same
  storage, so an article reuses the whole feed (visibility, federation, timeline,
  permalinks). The ordered blocks live in an `article` JSONB column. Authored via
  `POST /feed/articles` / `PATCH /feed/articles/:postId` (and the `create_article` /
  `update_article` MCP tools), or in the web app's article composer; prose renders
  through the shared markdown sanitiser — which, like the outbound one, drops form
  controls, `style` and non-http(s) image sources, so the web shows what federates
  (#1028) — and each windowed block resolves its data live
  over the locked window. An article **federates as a `Note`** (title in `name`, prose
  HTML in `content`, and a rendered PNG **figure** per chart/correlation/challenge/impact block
  attached) so followers on Mastodon see the prose and the charts. (A `Note`, not an AS2
  `Article`: Mastodon treats `Article` as a converted type and discards its `content`,
  rendering only a title and link.) The `content` is shaped for Mastodon, whose inbound
  sanitiser drops tables, images and `hr` and always lays attachments out after the text:
  - every image the Note attaches is a **numbered figure**, counted in document order —
    each non-prose block and each prose image with an http(s) `src` — and the text carries
    `Figure N: label` where the image stood (the label is the block's caption, else its data
    label; a prose image's alt text). A block's attachment is its
    [`figure.png`](#images), which repeats `Figure N` and the label in a title band
    above the chart, so an image seen out of order still says which reference it answers.
    Mastodon shows at most 4 attachments, so from figure 5 on the words `Figure N` link to
    the image itself; a prose image with a non-http(s) `src` is no figure and leaves only
    its alt text;
  - a GFM **table** becomes one paragraph of lines — the corner header in italics, then one
    line per row, `**row**: Column value · Column value` — instead of run-together cell text;
  - a challenge block adds a **Join the challenge** link to the challenge page after its
    reference.

  The prose still passes the outbound sanitiser (no script, style or event handler; http(s)
  and mailto links only). The [Atom feed](#blog-view-and-atom-feed) and Aurboda peers keep
  the full formatting (tables, inline images). Because an article
  federates as an ordinary `Note`, an Aurboda peer's existing inbound timeline ingestion
  (see [Home timeline](#home-timeline-inbound)) already stores it like any other post —
  sanitised prose + image attachments — with no article-specific ingest code. On top of
  that, a following Aurboda instance's [structured-enrichment
  fetch](#native-charts-from-aurboda-peers-structured-enrichment) resolves an article to
  its native `FeedStructuredArticle` payload (title + every block re-resolved live —
  bucketed chart samples, the computed correlation + scatter points, or an impact block's
  timeline and effects), so an Aurboda
  follower's timeline renders the full inline article — real interactive charts and
  scatters — instead of just the flattened prose and attached PNGs a Mastodon follower
  sees. **Export** — `GET /feed/articles/:postId/export` (and the `export_article_markdown`
  MCP tool) renders an article as paste-ready markdown — the title, the prose blocks
  verbatim, one image link per chart/correlation/impact block (the block-image endpoint
  below), and for a challenge block its standings image (when it would draw), caption and a
  `[Join the challenge](…)` link — for pasting into a text-only destination like r/QuantifiedSelf, where the
  author adds their own write-up around the linked charts. A block whose image would 404
  (a chart window with no samples, a correlation with n < 3, an impact window without
  sessions) gets an italic "not enough
  data in this window" note instead of a dead image link (#974). A **`followers`-only** article
  can't be exported (400): the export targets a public paste, but its chart images require
  the post's private capability token, which must never land in publicly-pasted text —
  make the article public or unlisted first.

- **`challenge`** — an **invitation to a challenge** (#994): the author's personal note
  (markdown, shaped for Mastodon like article prose: tables as lines, images as links)
  plus the challenge's canonical public URL — one of the user's own challenges (its share
  URL) or a challenge they joined (the host's URL), resolved **server-side** so a post can never carry a
  spoofed link. The payload (name + URL, and the host identity for a joined challenge)
  lives in a nullable `challenge` JSONB column; no join token and no standings data are
  stored on the post — anyone following the link goes through the normal public page /
  join-by-URL flow. Federates as a `Note` (Mastodon renders the link with the challenge
  page's existing OG preview card); an Aurboda peer additionally fetches the post's
  [structured payload](#native-charts-from-aurboda-peers-structured-enrichment) — the
  challenge document and a standings snapshot resolved at fetch time — and renders the
  race chart and leaderboard natively. With `include_chart` (the default for a share,
  "Attach standings chart image" in the dialog) the `Note` delivered to followers also
  attaches the race rendered as a `Standings` PNG (see [Images](#images)), which an
  Aurboda peer hides because its card draws the race itself. Shared via
  `POST /feed/challenges` (and the `share_challenge` MCP tool) or the **Share to feed**
  button on the challenges page.
  The host instance's automatic **completion post** (see
  [challenges.md](challenges.md#completion--winner-announcement)) is the same kind
  with a `result` payload in the `challenge` column — the final podium (ranks, names,
  identities, totals) and member count — rendered natively as a podium on the card and
  federated with a "has finished" heading, the winner as a Mastodon-style mention link,
  and a `Mention` tag (plus `cc` + inbox delivery) per winner.

- **`exercise`** — **one exercise's progress** (#1398): one item value of one activity
  type, e.g. `sets.exercise` = `Dumbbell Bench Press` of `strength_training`, the same
  thing a [shared exercise](sharing.md#shared-exercises) publishes. The post stores only a
  pointer and the author's opt-ins in a nullable `exercise` JSONB column (type, item path,
  value, the display name at share time, `include_records`, `include_sessions`, and the
  `url` of the exercise's public page); the data itself is **resolved at read time**
  through the same projection a public exercise page gets (`resolveSharedExerciseData`),
  filtered by the opt-ins: the records (best e1RM, max weight, …) and the session count
  (`include_records`, default on), the decaying-best trend and weekly series
  (`include_chart`, default on), and the last 5 sessions' sets (`include_sessions`, default
  off). Publishing the exercise is **not** a prerequisite: the post links the public page
  (and takes its name) only when the exercise is published as a shared exercise at share
  time and `include_link` (default on) is set; otherwise it carries no link and is named
  by the value. An exercise without sessions can't be shared (404), and a non-categorical
  item path is rejected (400). Federates as a `Note` whose content — name and type, the
  note, a line per record (`Best e1RM 39.5 kg (21 Dec 2025, 7×32 kg)`), the session count,
  a line per shared session and the link — is rendered from the data as of delivery; with
  `include_chart` the `Note` delivered to followers also attaches the trend as a `Trend`
  PNG (see [Images](#images)). An Aurboda peer fetches the
  [structured payload](#native-charts-from-aurboda-peers-structured-enrichment) instead,
  resolved as of that fetch. Shared via `POST /feed/exercises` (and the `share_exercise`
  MCP tool); `POST /feed/exercises/preview` (`preview_exercise_share`) returns the exact
  `Note` HTML and structured payload without creating a post.

- **`dashboard`** — **one finished period of a period dashboard** (#1505): the home dashboard
  or one of the user's [shared dashboards](dashboard.md#period-dashboards), for one finished
  period of its granularity (`2026-10`, `2026-W44`, `2026`). The post stores, in a nullable
  `dashboard` JSONB column, the period, the dashboard's name at share time (`Home` for the
  home dashboard), its id (absent for the home dashboard), `include_link`, the `url` and a
  **snapshot of the dashboard's config** taken at share time and sanitized like a public
  dashboard's (quick-link hrefs neutered), so a later edit of the dashboard never changes
  what was shared. The figures are **not stored**: whenever the post is read they are
  resolved from the stored snapshot for the stored period (`resolveDashboardData` over the
  period's window, with the previous period for the deltas), so nothing beyond the shared
  widgets leaves the instance. Only a **period dashboard** can be shared (a rolling one is a
  400), the period must match its granularity (400) and be **finished** in the owner's
  timezone (400); an unknown dashboard is a 404. The post links the dashboard's public page
  only when it is a published (unlisted or public) shared dashboard and `include_link`
  (default on) is set; a private dashboard and the home dashboard are never linked.
  Federates as a `Note`, with no image, whose content is the name and period (`Month in
data · October 2026`), the note, then **one line per figure widget** in config order —
  metric and sparkline cards as `Steps 9375 (↑ 4%)` (the arrow and whole percent against the
  previous period, `→` within half a percent), the activity summary as `Workouts 12 · 600 min`,
  `Sleep 7.3 h` and `Meditation 3`, a record card as `Best e1RM 101.3 kg`, an activity type
  card as `Workouts 3 · 2h 10m · 15.0 km` (sleep as `Sleep 30 nights · avg 7h 30m`), a top
  list as `Music 3 plays — Artist A, Artist B`, the places card as
  `Places 13 nights Hökås, 3 Lönnåsen, 2 elsewhere · 4 places` (the top three named places by
  nights, then the nights elsewhere) — and the link;
  charts have no one-line form and are left to the structured payload, and quick links are
  never rendered. An Aurboda peer fetches the
  [structured payload](#native-charts-from-aurboda-peers-structured-enrichment) and draws
  the widgets natively. Shared via `POST /feed/dashboards` (and the `share_dashboard_period`
  MCP tool); `POST /feed/dashboards/preview` (`preview_dashboard_period_share`) returns the
  exact `Note` HTML, structured payload and tags without creating a post.

An **`activity`** feed post references one of the user's activities and records the
explicit metric selection that bounds what is shared:

- **`included_metrics`** — the scalar summaries the user opted to share (e.g.
  `duration`, `distance`, `heart_rate_avg`, `heart_rate_max`, `hr_zone_minutes`,
  `calories`, `stress_avg`). This is the single source of truth for the human-readable
  summary and the machine-readable scalars a remote Aurboda instance reads. Each scalar
  aggregates its time-series over the activity window; `distance` and `calories` fall back
  to the activity's own summary fields (`data.distance` in metres, `data.calories` in kcal)
  when the window has no such series — Garmin and Strava store them only there (#1026).
  The share dialog offers them on the same terms, and the preview, the delivered `Note`, the
  owner card and the structured payload all go through the one resolver, so they agree.
- **`series_metrics`** — a **separate, explicit opt-in** for high-resolution continuous
  series (e.g. per-5-second heart rate or stress). A per-sample trace is far more
  revealing than an average, so series are **off unless deliberately chosen**, even for
  a metric whose scalar summary is shared.
- **`visibility`** — `public`, `unlisted`, or `followers`. The `public`/`unlisted`
  pair is the shared `ShareVisibility` vocabulary (see [Sharing](./sharing.md)) that
  [challenges](./challenges.md) and shared dashboards also use; the feed extends it
  with the `followers` audience.
- **`include_chart` / `include_map`** — attach a rendered heart-rate chart and/or
  GPS route-map image to the post (see [Images](#images)).
- **`include_exercises`** — share each exercise of the session: its sets (reps, weight,
  time, warm-up/drop/failure flag), its e1RM and volume and the other measures over the
  working sets, and the records it set against the author's earlier sessions (the same
  measures and records as the activity detail page's item history). The exercises are the
  activity type's first categorical list item field (`sets.exercise` for
  `strength_training`), resolved over the **merged** session, so a post anchored on a
  Garmin row carries the sets logged on its overlapping Gravl row. They appear as an
  "Exercises" paragraph in the Note content (one line per exercise, e.g.
  `Bench Press: 8×60 kg (w), 8×80 kg · e1RM 101.3 kg · volume 640 kg · PR e1RM`), as
  `quant:exercises` in-band, and as `exercises` in the structured payload, which the
  native card renders as a list under the stats. Off by default in the API; the share
  dialog offers the checkbox only when the preview finds exercises in the session
  (`has_exercises` on the preview response), checked for a new share.
- **`message`** — an optional personal message (plain text, linebreaks preserved)
  shown at the top of the post. The share dialog prefills it from the activity's
  description (its user-typed comments) — always shown editable before sharing, so
  private context can be redacted; an empty field shares no text. Cleared on edit
  by saving an emptied field.

Defaults are privacy-conservative: sharing an activity with no explicit selection
shares no scalars and, crucially, **no series**.

### Article drafts

An article can be saved as a **draft** and worked on over time — in the web editor, or
started by Claude over MCP and finished in the editor (#1465). Drafts live in their own
`article_drafts` table (`id`, `article` JSONB, `visibility`, `created_at`, `updated_at`),
**not** as a status on `feed_posts`, so no query that reads posts — the feed listing, the
outbox, federation delivery, the public profile, the blog view, the Atom feed, timelines,
`list_feed` — can ever see one. A draft is never federated.

A draft may be **incomplete** (`ArticleDraftContent`): the title may be empty, a chart
block's `metric`, a correlation block's `trigger`/`outcome` and an impact block's `activity`
may be unset ("Impact block N has no activity — pick one before publishing."), and windows are
not checked. **Publishing** validates it exactly like `POST /feed/articles` — the
`CreateArticleBody` schema, then the same window and challenge checks — and on success, in
one transaction, **claims** the draft (deletes it and takes the deleted row in one statement,
so of two concurrent publishes only one gets it and the other answers 404), validates the
claimed row again and creates the article post (its `created_at` is the publish time); it
federates the post after the commit. An invalid draft gets a 400 with the reason; if anything
fails before the commit — the draft saved invalid in between, or the post insert — the
transaction rolls back and the draft stays as it was. A draft's own `tags`
(see [Hashtags](#hashtags)) are kept in its content and become the post's explicit tags. A published article is edited in place
as before (`PATCH /feed/articles/:postId`); there is no unpublish-to-draft.

| REST                                    | MCP                     | Purpose                                                                                                                                                                           |
| --------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /feed/article-drafts`              | `list_article_drafts`   | My drafts, most recently saved first                                                                                                                                              |
| `POST /feed/article-drafts`             | `create_article_draft`  | Start a draft (`{ article?, visibility? }`; no `article` = empty and untitled)                                                                                                    |
| `GET /feed/article-drafts/:id`          | `get_article_draft`     | One draft                                                                                                                                                                         |
| `PATCH /feed/article-drafts/:id`        | `update_article_draft`  | Save changes; provided `title` / `blocks` / default window / `tags` / `visibility` replace the stored ones; over REST a `null` `default_start` / `default_end` / `tags` clears it |
| `DELETE /feed/article-drafts/:id`       | `delete_article_draft`  | Delete a draft (nothing to retract)                                                                                                                                               |
| `POST /feed/article-drafts/:id/publish` | `publish_article_draft` | Validate and publish; `{ visibility? }` overrides the draft's                                                                                                                     |

#### Preview

`POST /feed/articles/preview` (MCP `preview_article`, #1605) shows what an article — a draft
or an unsaved editor state, `{ article, visibility?, include_images? }` in the
`ArticleDraftContent` shape — would federate as, and creates nothing. Only its **complete**
blocks are previewed (a chart with a metric, a correlation with trigger and outcome, a
challenge with a challenge URL, an impact block with an activity, and for a windowed block a
bounded, increasing window); a blank title previews as `Untitled`. The answer
(`ArticlePreviewResponse`) has the Note `content` and `name` exactly as `renderArticleNote`
and the hashtag linking build them, the `tags`, the numbered figure `attachments` (alt text,
`block_index` back into the draft's blocks, `shown_in_mastodon`), `publish_error` — what
still keeps it from publishing, the same checks as publishing, or `null` — and `notes` on
what Mastodon changes for this post (figures past the fourth, figures with no data yet, the
cropped grid, followers-only image tokens). With `include_images` each block figure Mastodon
shows comes back as SVG markup (`image_svg`, the same titled image `figure.png` rasterises;
`null` when the block has nothing to draw yet), drawn one at a time and cached for the hour
so retyping prose does not draw the charts again. A block figure has no URL before the post
exists, so a figure past the fourth is linked as `#figure-N` in the preview.

`mastodon` is an **emulation of Mastodon's web UI**, not Mastodon itself: `content` after a
port of Mastodon's `MASTODON_STRICT` sanitiser (`mastodon-sanitize.ts`: its elements and
attributes, headings as bold paragraphs, forced `rel="nofollow noopener" target="_blank"`, a
link with an unsupported or relative scheme replaced by its text) without the trailing
paragraph of hashtag links, and the `hashtag_bar` Mastodon shows under the media instead.
The web's article editor shows it as a **Mastodon** tab beside the **Aurboda** tab (the real
feed card), side by side with the form on a wide screen: the first four images in Mastodon's
cropped grid with their alt text, the hashtag bar, and the "Read more" fold a status taller
than 706 px gets in Mastodon timelines.

| REST                          | MCP               | Purpose                                                                   |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------- |
| `POST /feed/articles/preview` | `preview_article` | Preview the federated article and its Mastodon rendering; creates nothing |

#### Pictures

Anything written in the markdown editor — an article's prose blocks, a comment or reply, a
timeline comment, an activity's description — can carry pictures from the device (#1606):
**paste** one, **drop** it on the text, or **pick** it with the picture button at the right of
the Write/Preview tabs (on Android the app's WebView opens the system file chooser). Each
picture goes in at the cursor, on a line of its own, as `![Uploading name…]()` while it is
sent, and is replaced by `![](url)` when it is stored; describe it between the square
brackets, which becomes its alt text. A failed upload removes the placeholder and says why.
Save, Reply, Publish and Save draft wait until every placeholder is gone, so one is never
saved. An SVG is refused in the browser before it is sent.

The server normalises every picture (`services/feed-image.ts`): the format is checked on the
bytes sharp detects, not the claimed type (PNG, JPEG, WebP or GIF; never SVG); the EXIF
orientation is applied and the picture turned upright; its longest edge is shrunk to at most
1600 px (a smaller picture is not enlarged); an animated GIF keeps its first frame; and it is
stored as WebP (quality 82) with **no metadata** — no camera, no GPS position. An upload is at
most 10 MB.

Pictures live in the writer's own database, in `feed_image` (`id`, `content_type`, `data`
BYTEA, `width`, `height`, `byte_size`, `created_at`), so the [data export](../data-export.md)
holds them and deleting the account removes them. One account may store **500**; an upload at
the cap is refused (409) until some are deleted. Nothing removes a picture that no text uses any
more: the reference lives inside markdown.

A picture is public at `GET /api/public/:username/images/:id.webp` — anyone with the link can
see it — served with `Cache-Control: public, max-age=31536000, immutable` (an id's bytes
never change) and `X-Content-Type-Options: nosniff`.

| REST                      | MCP                 | Purpose                                                                                          |
| ------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `POST /feed/images`       | `add_feed_image`    | Store a picture (multipart field `image`; MCP: `data_base64`); answers `{ id, url, width, ... }` |
| `GET /feed/images`        | `list_feed_images`  | My pictures, newest first, with the cap (`limit`)                                                |
| `DELETE /feed/images/:id` | `delete_feed_image` | Delete a picture; markdown that embeds it shows a broken picture                                 |

The MCP tool is `add_…` rather than `upload_…` so the read-only gate, which decides by prefix,
refuses it for an account whose plan has ended, as REST's account gate does for `POST` and
`DELETE`.

**Who sees a picture in an article**: the author, in the article on their own feed; a visitor
of a public or unlisted post (`/u/<user>`, `/u/<user>/posts/<id>`, signed out or not) and an
Aurboda peer's timeline, inline where it stands in the prose, because the structured payload
declares it (see [structured enrichment](#native-charts-from-aurboda-peers-structured-enrichment));
and Mastodon, as a numbered figure attachment. A picture is never wider than the card or text
that holds it.

**On Mastodon**: an uploaded picture in an article's prose is an ordinary http(s) prose image,
so `renderArticleNote` sends it as a numbered figure attachment (`media_type: image/webp`,
its alt text as the description) within Mastodon's four, and links it past the fourth. In
any other post's text it federates as a link.

### Hashtags

Every post carries **tags**, Mastodon-style hashtags (#1466), stored lowercase without the
`#` in `feed_posts.tags` and returned as `tags` on every `FeedPost`. A tag is letters,
digits and `_` (any script, NFC-normalised), with at least one non-digit and at most 64
characters; a post has at most 10. The rules live in `@aurboda/api-spec` (`hashtags.ts`),
shared by the backend and the web.

A post's tags are its **automatic** tags — or the explicit `tags` list the share body gives
instead — plus every `#tag` typed in its own text (the message, an article's title and prose
blocks; code spans, fences and URL fragments do not count):

- the owner's **default tags** (`feed_default_tags` in the settings, `["aurboda"]` until
  changed; `[]` turns them off), and
- a **kind tag** unless `feed_type_tag` is off: an activity's type (`running`; a custom type's
  key with only letters and digits kept, `strength_training` → `strengthtraining`), an
  exercise's name, else its value (`Dumbbell Bench Press` → `dumbbellbenchpress`), a
  dashboard's name (`Month in data` → `monthindata`), or `challenge`. An article has no kind
  tag.

The list is cut at 10 in that order (automatic or explicit first, then typed), so a typed tag
past the cap stays plain text.

A **reply** gets only the tags typed in it. An [auto-share rule](auto-share-rules.md) with
its own `tags` uses them in place of the default tags; the kind tag still follows the setting.
Editing a post with an explicit `tags` list replaces its tags (plus those typed in the text);
editing only the message keeps the stored tags and swaps the tags typed in the old text for
those typed in the new one, so a choice made at share time survives an edit. The previews
(`preview_activity_share`, `preview_exercise_share`, `preview_dashboard_period_share`) return
the tags the post would get.

**Federation.** Each Note carries one AS2 `Hashtag` per tag (`name` `#tag`, `href` the
owner's profile filtered by it, `https://<web host>/u/<user>?tag=<tag>`), next to any
`Mention`. In the `content` HTML a typed tag becomes a Mastodon-style link
(`<a href="…" class="mention hashtag" rel="tag">#<span>Tag</span></a>`, keeping the written
casing); text inside links, `code` and `pre` is left alone, and the tags the text does not
show follow in one trailing paragraph. Only the post's own tags are linked.

**Web.** The activity, exercise, dashboard-period and challenge share dialogs and the article
editor have a **Tags** field, prefilled with the automatic tags (or the post's, when editing) and sent only
once changed; the auto-share rule form can replace the default tags; Settings → **Sharing**
holds the default tags and the type-tag switch. A post card lists its tags (unless its body is
the `content` HTML, which already links them), each linking to the public profile filtered by
it: `/u/<user>?tag=<tag>` shows "Posts tagged #tag · clear", backed by
`GET /public/:username/posts?tag=`.

**Following a hashtag** (#1540). A user can follow a hashtag, not only a person. Every
hashtag is an ActivityPub actor on a **tag actor host**: on [tags.pub](https://tags.pub), the
public tag relay run by the Social Web Foundation, `#running` is `running@tags.pub`, which
`Announce`s every public post it sees carrying `#running` to its followers (and sends
`Undo{Announce}` when one is deleted or untagged). Following a tag is therefore an ordinary
follow of `<tag>@<host>`: the same pending → accepted lifecycle, the same `Undo{Follow}` on
unfollow, and its posts arrive as boost cards through the normal inbox. The `feed_following`
row is marked with the tag, so followed tags are listed apart from followed people
(`GET /feed/following` and `list_following` return people only) through
`GET/POST /feed/followed-tags` and `DELETE /feed/followed-tags/:tag` (a tag is addressed by its
name, unique per user), and over MCP `list_followed_tags`, `follow_tag` and `unfollow_tag`.
A tag follow never raises a post notification: the Android notifier reads only the people
list. A card boosted by a followed tag actor carries `boosted_by.tag` and
shows a `#running` chip in place of the "🔄 X boosted" line. The host is a server setting,
`tag_actor_host` (Admin → **Federation**, default `tags.pub`). Only posts from servers that
push to tags.pub arrive this way; every Aurboda server pushes its own public posts there
through the tags.pub relay it subscribes to by default (see [Relays](../admin.md#federation)).

**Web.** Feed → **People & sharing** has a **Followed tags** block (follow `#tag`, the Pending
badge and Unfollow), and the **Following** timeline shows a chip row (`All` plus one
`#tag` per followed tag) that filters the timeline with `?tag=`.

## ActivityPub federation

Each user is a single ActivityPub **actor** (a `Person`) at:

```
<public-base>/users/<username>          e.g. https://aurboda.net/users/fiddur
```

The `/users/` prefix is dedicated to federation and never collides with the human-facing
`/u/<username>` profile/dashboard pages. The actor publishes an RSA public key (used to
verify HTTP Signatures) held in the per-user `feed_actor` table.

**Discovery (WebFinger).** The actor is resolvable by handle:

```
acct:<username>@<host>                  e.g. @fiddur@aurboda.net
```

so anyone on Mastodon (or any fediverse server) can search for `@fiddur@aurboda.net`,
open the profile, and **Follow**. A `Follow` arrives at the actor's inbox; Aurboda
verifies its HTTP Signature and records the follower (`feed_follower`). By default it
replies immediately with an `Accept` so the remote server marks the relationship
established; if the user has enabled **manual approval** the follow is held as a pending
request instead (see [Follower approval](#follower-approval-inbound)). `Undo{Follow}`
removes the follower.

Canonical absolute URLs (actor id, inbox/outbox, object ids, WebFinger self-link) are
always built from the configured public base (`WEB_HOST`) as **https**, so they stay
correct behind the TLS-terminating proxy (which forwards over loopback http).

**Instance actor and relays.** Besides the per-user actors, the server itself is an
`Application` actor at `<public-base>/actor` (WebFinger `acct:<host>@<host>`, inbox at
`/users/~actor/inbox`, shared inbox `/inbox`), whose key pair lives in the central database. It
exists to subscribe to [relays](../admin.md#federation), which admins add in Admin Settings; the
tags.pub relay is subscribed to once by default, on a public https origin. Once
a relay accepts, every `public` post's `Create`, `Update` and `Delete` is delivered to the relay's
inbox too, signed by the author, as a separate best-effort leg of the fan-out (a dead relay never
fails the followers delivery). Unlisted and followers-only posts, replies, likes, boosts and
`Update{Person}` are not pushed. Relays get a `Delete` whenever a post stops being public (an edit
to unlisted or followers-only sends them a `Delete` instead of the `Update`) and whenever a
non-reply post is deleted, whatever its visibility; a post made public by an edit reaches them
only as an `Update`, which a relay may ignore. Deleting an account sends the actor `Delete` to the
relays too. The instance actor answers only `Accept`/`Reject` of its own relay
follows and a LitePub relay's follow-back; everything else delivered to it, including whatever a
relay forwards, is dropped.

### Publishing & lifecycle delivery

Sharing, editing, or unsharing a post federates the matching activity to the user's
followers (best-effort, fire-and-forget; delivery is synchronous — a durable retry queue
is a later slice):

| Action  | Federated activity  | Effect on followers                       |
| ------- | ------------------- | ----------------------------------------- |
| Share   | `Create{Note}`      | The post appears in their timeline        |
| Edit    | `Update{Note}`      | Their stored copy is replaced             |
| Unshare | `Delete{Tombstone}` | The post is retracted from their timeline |

A post whose activity gains its **Garmin detail** after it was shared (GPS, per-second
HR, distance — the detail sync often lands minutes after a Health Connect session) is
re-delivered as an `Update{Note}` with a bumped `updated_at`, so followers get the
settled scalars and the attachments that now have data. A manual detail re-sync of the
activity does the same. This immediate refresh only covers posts whose activity had no
detail before; any other re-sync that actually changes the row (a full Garmin re-sync
included) is re-delivered by the window pass described next.

More generally, a shared activity that **changes** after it was shared — a new title or
data (an enrich rule, a re-sync with different values, an edit), a merge with another
source's row — is re-delivered the same way once the change has settled (the auto-share
stabilisation delay, 10 minutes). A rename of the activity type or of its category, and
the one-off data migrations that rewrite activity rows at boot, are changes too, on
purpose: the post's title carries the type name. Every shared activity they touch is
re-delivered, lazily, as later mutation windows cover it, so renaming a widely shared
type fans its `Update`s out over days rather than all at once. Every activity row
records when it last changed (`activities.updated_at`, set by a trigger only on a real
change, so an identical re-sync counts as nothing, and stamped with the statement's
wall-clock time, so a row touched late in a long sync transaction still compares as
newer than a post created mid-transaction), and the auto-share queue's pass over each mutation window
looks at the shared activities in it (the ones an activity post references, superseded
rows included) and re-delivers every activity post whose version (`updated_at`) is
older than its merge group's newest change. This covers manual shares too, has no age limit, and runs
whether or not any auto-share rule is enabled. During a deploy's overlap two replicas may
both deliver an `Update` for the same post; remotes treat the duplicate as idempotent.

The `Note` is Mastodon-compatible: a structured HTML `content` — the bold title
headline, the author's personal message (if any), a line saying when the **activity**
happened (rendered in the author's device timezone, since AS2 `published` stays the
share time for timeline ordering), and the shared scalar summaries one per line —
plus a `name` headline, addressed per the post's visibility
(`public` → AS2 Public + followers; `unlisted` → followers + Public in `cc`; `followers`
→ followers only).
The title headline is the shared activity's title; when that row has since been replaced
(`superseded_by`, e.g. a synced Garmin row an aurboda override now stands in for), it is the
replacing row's title, so renaming the activity — by hand or by a
[deduction rule](deduction-rules.md#copying-a-data-field-into-the-title-output_title_field) —
renames the post.

**QuantPub extension (#896).** An activity share's `Note` is dual-typed
`["Note", "quant:Exercise"]` and carries the typed [QuantPub](../fep/quantpub.md)
`0.2` extension in-band (the draft now describes `0.3`, which Aurboda does not emit
yet): the AS2 window as native `startTime`/`endTime`, plus
`quant:activityType`, `quant:metrics` (the shared scalar summaries as
`key`/`value`/`unit` objects, keys in lowerCamelCase such as `heartRateAvg`),
`quant:series` links into the public series endpoint (`metric` such as `heartRate`)
(only for `public`/`unlisted` posts with a bounded window), `quant:exercises` (the
shared exercises, only under `include_exercises`), and
`quant:structuredUrl` pointing at the structured post endpoint (carrying the
capability token on `followers`-only deliveries). The `quant:` term definitions are
embedded as an inline `@context` entry on every delivered/served document
(`quant:metrics`/`quant:series`/`quant:exercises` are JSON literals, `"@type": "@json"`), and the
canonical context document is served at `GET /ns/quantpub`
(`application/ld+json`); `GET /.well-known/quantpub` is the FEP §4 discovery
document. Fedify's typed vocabulary drops unknown properties, so the extension is
spliced into the serialized JSON-LD of the outermost delivered/served object
(`services/activitypub/quant-extension.ts`); plain fediverse clients ignore the
extra type and terms and render the Note as before.

**QuantPub versions.** Aurboda serves QuantPub `0.2`, whose payload layer is
lowerCamelCase: the discovery document's `apiBase`, the structured payload's
`activityType`/`startTime`/`endTime`/`name`, and metric keys (`heartRateAvg`,
`hrZoneMinutes`, `heartRate`). Aurboda's own names stay snake_case (metric types,
`included_metrics`, the owner-facing `FeedPost`, `/.well-known/aurboda`); the
conversion is mechanical and happens at the boundary in
`services/activitypub/quant-wire.ts`. It still accepts `0.1` (snake_case, with
`api_base` and `duration_seconds`) from peers: inbound discovery documents and
structured payloads are normalised to `0.2` before validation, and timeline entries
stored before the switch were rewritten to `0.2` once by the
`quantpub_0_2_structured_camelcase` migration.

**Merged activities.** A post stores only `activity_id` (the plain anchor uuid). When that
activity is part of a **merge group** (overlapping cross-source records, shown in the
detail view as `merged:<anchor>`), the delivered/served/listed scalars and the rendered
chart/route images are resolved over the **full merged span** — the same window the detail
view and share dialog present — not the anchor sub-activity's narrower slice. The window is
resolved at query time (via the same `resolveActivityWindow` the `merged:` detail view
uses), so nothing denormalised is persisted on the post. An aurboda override in the group
wins the merged view's title, span and data outright, as it does in the listing, so the
window is then the override's own.

### Outbox & object serving

- **Outbox** (`/users/<username>/outbox`) — a **cursor-paginated** `OrderedCollection`
  of the user's `public` + `unlisted` posts as `Create{Note}` activities, newest-first, so
  the actor's profile shows their posts — both an activity share and an article are a
  `Create{Note}`. The root returns `totalItems` + `first`/`last` page links; each page
  (`?cursor=<offset>`) serves up to a fixed page size with a `next` link. `followers`-only
  posts are never listed.
- **Object** (`/users/<username>/feed/<postId>`) — the post's `Note`, served at its
  canonical id so a remote server can dereference it (an article's Note carries its prose
  in `content`; an activity's carries the shared-scalars summary). Only `public`/`unlisted`
  resolve; `followers`-only and unknown ids return 404. Once a `public`/`unlisted` post is
  **deleted**, that id returns **`410 Gone` with an AS2 `Tombstone`** (recorded in
  `feed_tombstone`) so a dereferencing server learns the object is _permanently_ gone
  rather than transiently missing. A `followers`-only id is never tombstoned — it never
  resolved publicly, so a 410 would leak that a post once existed.
- **Permalink page** — the Note's `url` is that same id, so Mastodon's "Open original
  page" opens it in a browser. The id is content-negotiated like the actor URL: an
  ActivityPub type, a wildcard or no `Accept` gets the Note, while a request that prefers
  HTML gets a `302` (`Vary: Accept`) to the post's web page `/u/:username/posts/:postId`,
  which renders the post through `GET /api/public/:username/posts/:postId`. Any post id
  of an existing account redirects — `public`, `unlisted`, `followers`-only, deleted or
  never-existing alike — so the redirect leaks nothing about the post; the page itself
  shows "Post not found" for anything that isn't public. An unknown account's id is a 404.
  Machine clients are unaffected: a `followers`-only or unknown id is still a 404 and a
  deleted one the `410` Tombstone.

The `Note` carries `published` = the post's share time (its `created_at`), so remote
servers order and timestamp it correctly instead of stamping it at receipt.

The object we deliver, list in the outbox, and serve at that id are all built from one
place, so they can't drift.

### Following other actors (inbound)

The feed also runs the **inbound** direction: a user can follow other fediverse actors
(remote _or_ another local Aurboda user). Following `@alice@mastodon.social`:

1. resolves the target actor (WebFinger + actor fetch) to its inbox + presentation,
2. records a **pending** follow in `feed_following`, then
3. sends a signed `Follow` from the user's actor to the followee's inbox.

Following **yourself** is rejected (it would deliver a `Follow` to your own inbox and echo your
posts into your timeline). Resolving the actor's avatar is bounded by a short timeout, so a slow
icon host can't hang the (synchronous) follow. When a follow fails, the web panel surfaces the
server's specific reason (e.g. an unresolvable handle) rather than a generic message.

Every remote fetch made on a user's behalf — resolving a followee, the backfill's outbox walk,
the actor documents behind inbound bylines and boosts, mention and reaction delivery lookups —
is **signed with that user's actor key**, so instances running authorized fetch (Mastodon
secure mode, GoToSocial) answer instead of refusing with a 401.

When the followee's server answers with an `Accept`, the inbox marks the follow
**accepted**; a `Reject` drops it. Unfollowing sends an `Undo{Follow}` to the cached inbox
and removes the row. Local follows use the exact same path (delivered to the local inbox
over loopback), so there is no special-casing. Delivery is best-effort/synchronous, matching
the rest of the feed — a failed `Follow` POST leaves the pending row so the user can retry.

**Inbound `Update{Person}`** (#1057) — the mirror of the `Update{Person}` we deliver when our
own profile changes. A remote actor renaming themselves (or changing their avatar) sends one to
everyone who follows them, and nothing else ever re-reads a remote actor, so without it our
cached handle / display name / avatar stay stale indefinitely. An `Update` whose object id
**is** its actor id is the actor editing themselves — that equality is the same-actor rule, so
an `Update{Person}` describing anybody else is ignored — and the new presentation is then
fetched from that (signature-verified) actor id, never read off the embedded `Person`. Every
cached copy is refreshed together: the `feed_follower` and `feed_following` rows, the author
snapshot on their timeline entries, the "🔄 X boosted" line on cards they boosted, and their
reactions on the owner's own posts. Presentation only — the cached inbox URIs never move.

Each follow carries a **`notify_on_post`** flag (default `true`), toggled per-actor with the
bell in the web Following panel (or the `set_following_notify` MCP tool / `PATCH
/feed/following/:id`). It controls whether the Android app raises a notification for that
actor's new home-timeline posts; muting is preserved across a re-follow.

**Replies and mentions** (#1060): ingest stores a received Note's `inReplyTo` id as
`timeline_entry.in_reply_to_uri` and whether it carries a `Mention` of the timeline owner as
`mentions_me`. The timeline exposes both (plus `in_reply_to_mine`, true when the reply target
is one of the reader's own posts) and filters by the **`timeline_show_replies`** user setting
(toggle on the Feed page and in Settings): off (the default) hides only replies to posts that
**aren't in the reader's timeline**. A reply to a post the timeline already holds — a followee
continuing their own thread, or two followees talking to each other — stays visible, which is
what Mastodon's home shows; so do posts the reader is **involved** in (replies to their own
posts, Mentions of them), marked on the card, and boost cards of replies. The inbox admits an
involvement Note **from any actor**, not only followees (a stranger's reply to your post, or a
post mentioning you, is the Mastodon-style interaction; the author snapshot comes from the
signature-verified sender) — everything else from non-followees is still dropped. The live
"new post" ping applies the same filter (#1062): a reply the reader has chosen not to see
never announces a card their timeline doesn't list. The Android notifier follows the same
rule: top-level posts notify per the per-follow bell, involvement notifies regardless of who
wrote it — deliberately including an account whose bell is explicitly OFF, since a reply to
you or a mention of you is addressed to you, not merely published near you. Entries also
expose **`received_at`** (when this instance stored the post) — the notifier's high-water
mark, since `published_at` can arrive out of order after federation retries. Entries ingested
before this shipped are **lazily backfilled**: each timeline read re-fetches a few unchecked
objects (SSRF-guarded) and stamps their reply/Mention state.

**Expanding a thread**: `GET /feed/timeline/:id/replies` (and the MCP `get_timeline_replies`
tool) fetches a live, bounded snapshot of the post's remote `replies` collection — at most 20
replies from at most 15 SSRF-guarded requests within a 12s budget, HTML sanitised
server-side; `partial: true` marks a thread longer than the budget. Nothing is stored — the
web's "Show replies" button on each timeline card renders it on demand.

The snapshot also carries **`fetched`** (#1065): `false` means the origin's thread could not
be read at all (the post never loaded, or it declared a `replies` collection we couldn't
resolve). An empty list is then _unknown_, not _empty_, and the web says "Couldn't read the
thread from `<host>`." instead of "No replies found" — a failed fetch that reads as an empty
thread is a lie about someone else's conversation.

The reader's **own replies** to the same object are merged into the snapshot (marked
`mine: true`, matched on the reply's `object_uri`). The origin need not list our Note yet —
Mastodon adds it only once it has processed the `Create`, and a followers-only thread may
never expose it — and a thread that hides its own reader's reply reads as if it were never
sent. A reply the origin _does_ list is kept as the origin's copy (that is what everyone else
sees) and only flagged `mine`; one it doesn't is appended in `published_at` order.

**Marker composition** (#1066): the card's markers compose rather than exclude each other —
`↩ replied to you` when the post answers one of yours, else `↩ a reply`, **plus** `@ mentioned
you` whenever it also carries a Mention of you. (A reply to your own post already implies the
mention, so that pair collapses to one marker.)

The actor advertises a **following collection** (`/users/<username>/following`) listing only
_accepted_ follows of people (a pending follow isn't a confirmed relationship yet; followed
hashtags are left out, matching the people list the owner sees, and so is the count). The followee's
inbox URIs are internal delivery details and are never exposed on the owner-facing API.

### Follower approval (inbound)

By default an account is **open**: an inbound `Follow` is auto-accepted and answered with an
`Accept` immediately. A user can instead switch on **manual approval** (the
`manually_approve_followers` setting) — a "locked account", advertised to the fediverse via
`manuallyApprovesFollowers: true` on the actor document, so Mastodon shows a follow _request_
and holds it pending.

With manual approval on, an inbound `Follow`:

1. is recorded in `feed_follower` as **pending** (`accepted = false`) — caching the
   follower's handle / display name / avatar (so the approval UI can show _who_ is asking)
   and the id of their `Follow` activity, but **no** `Accept` is sent yet;
2. surfaces as a request the owner can **approve** or **reject**.

**Approving** flips the row to accepted and sends the deferred `Accept` — echoing the
original `Follow` id so the follower's server matches it to its pending request.
**Rejecting** (or later **removing** an accepted follower) sends a `Reject` and drops the
row. Both are best-effort/synchronous like the rest of the feed. A re-delivered `Follow`
from an already-accepted follower never demotes them back to pending.

Only **accepted** followers appear in the followers collection + count and receive
`followers`-only posts — a pending request is not yet a follower. Switching the setting off
does not retroactively accept the already-pending requests; new follows simply auto-accept
again. The follower's inbox URIs are internal and never exposed on the owner-facing API.

### Home timeline (inbound)

Posts from followed actors arrive at the user's inbox and are stored as a **home timeline**.
When a `Create` or `Update` for a `Note` is delivered, the inbox:

1. confirms the sender is an **accepted** followee (`feed_following`) — activities from
   anyone else are ignored, so an unsolicited `Create` can't inject into the timeline,
2. **sanitises** the note's HTML content server-side (`sanitize-html`, a strict tag/attribute
   allowlist) — remote content is untrusted, so this is the XSS boundary, then
3. captures the note's **image attachments** (rendered chart / route map, or a Mastodon
   photo) — only inline `http(s)` images survive, then
4. upserts a `timeline_entry` (keyed by the note's `object_uri`, so an `Update` or a
   redelivery replaces in place rather than duplicating), with the note's AS2 `Hashtag`s
   stored as `tags` (lowercase, no `#`, at most 10; on a card boosted by a
   [followed tag actor](#hashtags) the followed tag is added). `GET /feed/timeline?tag=running`
   and `list_timeline`'s `tag` list only the entries carrying that tag; an invalid tag is a
   `400`.

A card with **no** native structured payload (a Mastodon post) renders the sanitised HTML
plus the delivered **image attachment(s)**, the way Mastodon shows them. A card **with** one
(an Aurboda peer's post, see below) renders natively instead and suppresses the redundant
flattened HTML: an activity share shows its title, the author's message, the activity's
date, a stat grid, **one combined multi-metric chart** with per-metric toggle buttons, and a
**time-synced interactive map** that marks the position at the hovered chart time — the same
components the activity detail view uses (#1011) — while an article shows the full inline
article. The map (Leaflet and its OpenStreetMap tiles) is only started once its card comes
within 200 px of the viewport, and is kept from then on, so a long timeline does not load
tiles for every route in it (#1016). Each delivered image is kept unless its native counterpart actually draws: the
chart PNG renders heart rate only, so it is skipped exactly when a drawable _heart-rate_
series is present, and the route PNG is skipped when the payload carries a drawable route.
A `followers`-only Aurboda share federates
its native payload to accepted followers too (via the capability token, see below), so a
follower gets the interactive chart rather than just the flat image; a Mastodon photo post
shows its photos.

A `Delete` removes the matching entry; unfollowing removes all of that actor's entries. The
timeline is read back **newest-first**, keyset-paginated on `(published_at, id)` behind an
opaque `next_cursor` — the same cursor style as the outbox — via `GET /feed/timeline` and the
`list_timeline` MCP tool. The cursor carries the timestamp at Postgres' own **microsecond**
precision (selected as text alongside the row), because the page predicate compares at that
precision: a millisecond-rounded cursor made a row sharing that millisecond unreachable from
every page (#1025). Cursors issued before that fix are still accepted, at their old precision.
Because the content was sanitised on ingest, the web client renders it directly.

Two ingest guards keep the timeline honest given `object_uri` is a **globally-unique** upsert
key: the note's id must be on the **sender's host** _and_ it must declare `attributedTo` naming
the sender (so an accepted followee can't overwrite another actor's post by colliding its id —
a note with no `attributedTo` at all is refused too, since every real implementation sets it);
and `published_at` is **clamped to "not in the future"** on ingest (it's the sort key, so a
far-future timestamp would otherwise pin a post to the top).

**Backfill on follow.** So the timeline isn't empty until a new followee next posts, accepting
a follow triggers a one-off **backfill**: the followee's recent **public** posts are fetched
from their ActivityPub **outbox** and ingested through the exact same path as live delivery
(same sanitisation, image capture, structured enrichment, and `object_uri` upsert — so a
backfilled post that later arrives live just updates in place). It's driven off the `Accept`,
so it covers **remote** followees (on their server's Accept) and **local** ones alike (a local
follow auto-accepts through the same handler). Only the **outbox** is read, so `followers`-only
and older private posts are never backfilled — exactly what a non-follower could already see.
Servers whose outbox lists no items get a fallback: [FitPub](https://codeberg.org/fitpub/fitpub)
serves only a `totalItems` count, so for a FitPub server (detected via its NodeInfo
`software.name`) the post ids come from its public web API, and each post is still fetched as an
ActivityPub `Note` and checked like any other; only publicly addressed posts are kept.
Backfill is **best-effort and bounded**: fire-and-forget (a slow or unreachable outbox never
blocks the follow), capped at the latest ~20 posts, and time-boxed. Backfilled posts are
historical, so they don't trigger the live **"N new posts"** pill — they simply appear in the
timeline on the next load, in their published order.

### Likes and boosts

Two Mastodon-style interactions, both over open ActivityPub vocabulary and both directions:
a **like** ⭐ is an AS2 `Like` (Mastodon's "favourite"), a **boost** 🔄 an AS2 `Announce`
("reblog"); each is retracted with an `Undo` of the same activity.

**Outbound** (the user taps ⭐ / 🔄 on a home-timeline card). The local `feed_reaction` row is
written first and is the source of both the card's state and the **activity id** we deliver
(`/users/<user>/likes/<id>`, `/users/<user>/announces/<id>`, `#undo` appended for the
retraction) — so an `Undo` always references exactly the activity that was sent. Those ids are
never dereferenced by Mastodon, so a GET on one may 404. Addressing follows Mastodon:

- a `Like` carries no `to`/`cc` and is delivered to the **post author's inbox only**;
- an `Announce` is `to: Public`, `cc: [followers, author]` and is delivered to **followers and
  the author as two independent sends**, so one dead inbox can't cancel the other.

The author's inbox comes from the cached `feed_following` row when we follow them (no network);
otherwise a bounded actor lookup, and a reaction we can't address fails with `502` rather than
storing a row the card would lie about. Delivery itself is **best-effort** (like `Follow`): a
failed POST is logged and the local state stands. Both toggles are **idempotent** — a second
like is a local no-op with no second delivery, and un-reacting something you never reacted to
changes nothing. Reacting to a **boost card** targets the _original_ post, not the `Announce`.

**Inbound.** A `Like`/`Announce` of one of **our own** posts is recorded in
`feed_post_reaction` with a best-effort snapshot of the sender (handle / name / avatar), so the
owner can see who reacted; it is open to any actor (Mastodon requires no follow to favourite),
but strictly scoped to a post that is ours and still exists. That snapshot is **fetched from
the sender's actor id** (see the rule below), so an unresolvable actor leaves a countable but
anonymous reaction rather than an unverified byline. An `Undo` retracts it, scoped to the
undoing actor; when the `Undo`'s inner object doesn't resolve, the remote activity's own id is
matched instead.

**Quotes.** A quote of one of our own posts that we approved (FEP-044f, see the
`feed_quote_authorization` table under [Storage](#storage)) is listed with the post's likes and
boosts as a reaction of kind `quote`, whose `url` is the quoting Note's id, and counted in the
listing's `quote_count`; the web shows it as "❝ Quoted by …" with a link to the quoting post
(only an http(s) URL becomes a link). Nothing is ingested for it: the approval row is the
record, and the quoting actor's handle / name / avatar are read at query time from whatever
local row already caches that actor (follower, followee, reactor, timeline author), so an actor
we hold nothing for lists with no byline. Revoking the stamp (the quoting Note deleted, the post
deleted or narrowed to followers-only) drops the row, and the quote with it.

An `Announce` **by an accepted followee of a third party's post** becomes a **boost card** in
the home timeline. A boost is its own row: `object_uri` is the _`Announce` activity id_ (so two
followees boosting one post give two cards, and a boost never collides with the original's own
entry), `boost_of_uri` is the announced Note's id, `boosted_by_*` the followee, and
`published_at` is the boost time — so the card sorts where Mastodon puts it. Everything else
(author, content, images, structured payload) describes the **original** post, which is what
renders, under a "🔄 X boosted" line. Guards: only an **accepted** followee can boost into the
timeline; the announced object must resolve to a `Note` **on the same host as the announced
id** and declare `attributedTo` (whose host must match the Note's, as for any ingest); and a
post that is **already in the timeline directly** gets no boost card (Mastodon likewise hides a
reblog of a post you already have). The dedupe holds in both arrival orders: when the boost
lands first and the post itself arrives directly later (its author's `Create`/`Update`, or the
on-follow backfill), storing the direct entry removes the boost cards of that Note, so the
timeline ends up with the direct entry alone either way.

An edit by a boosted author **we don't follow** updates their boost cards in place, whenever
their server delivers the `Update` to us (which recipients it reaches is up to that server).
Only the card's own author can do this: the card is matched on the signature-verified sender
as well as the Note, and the edited Note must still be on that author's host and attributed to
them. The card keeps its boost time.

A boost card's `published_at` is the boost time, so it sorts where the boost happened. And a
boost is never treated as a _reply_, even when
the boosted Note is one: it stays visible with `timeline_show_replies` off (Mastodon shows
reblogs of replies), and it is left out of an own post's comment list + `reply_count`, which
would otherwise show the same comment twice under someone else's byline.

**An object embedded in an activity is never used.** The announced `Note`, its author, and
every actor whose name we store are always **dereferenced from their own ids**. This is the
security of the whole feature, not an optimisation: an AS2 activity may inline its object, and
a library will hand that inlined copy back without fetching anything — so a followee could
deliver an `Announce` carrying a `Note` with any `id` and an `attributedTo` `Person` with any
`preferredUsername` they chose, and every host/attribution check would be satisfied by data
they wrote, storing forged content under a real person's byline. Fetching by id makes the
claimed origin server the only thing that can describe its own posts and people (and the
lookup refuses a document whose `@id` is cross-origin to the URL it came from). Mastodon sends
a bare id for a boost anyway, so this is also the ordinary path.

The rule covers **every inbound path that writes a byline** (#1103), each choosing what an
unreadable actor document means: an inbound `Like`/`Announce` still records a countable but
anonymous reaction; an inbound `Follow` still records the follow (the relationship is real)
with unknown display fields, while its inbox — delivery addressing, not presentation — comes
from the signature-verified sender as before; a **stranger's** reply/mention Note is dropped
outright, since showing who replied is the entire point of admitting it; a boosted post's
author, likewise, yields no card.

`Undo{Announce}` removes the card, scoped to the booster; an author's `Delete` removes their
post _and_ every boost of it; unfollowing removes that actor's own posts and their boosts, but
keeps other people's boosts of their posts (those are in the timeline on the booster's
account).

A `followers`-only post can't be boosted meaningfully — the `Announce` is public, but the
object stays unreadable to anyone who doesn't already follow the author, so their servers show
nothing.

### Replies (comments)

The third Mastodon-style interaction, also over open vocabulary. Replying 🗨 to a
home-timeline card publishes a **feed post of kind `reply`** — replies are not a separate
entity, so they reuse the whole feed machinery (visibility, delivery, editing, tombstoning,
permalinks) rather than a parallel one.

**Outbound.** `POST /feed/timeline/:id/reply` (MCP `reply_to_timeline_post`) takes
`{ message, visibility }` and resolves the target itself from the addressed timeline entry:
the object is `boost_of_uri ?? object_uri` (replying to a **boost card** answers the _original_
post) and the author is the entry's `actor_uri` / `handle`. Nothing about the target is
client-supplied, so a reply can never claim to answer a post the reader never received. The
author's inbox resolves exactly as for a like — cached `feed_following` row, else a bounded
actor lookup — and a reply we can't address fails with `502` **before** the row is written,
so no post is left claiming to answer someone who was never told.

`visibility` defaults to **`unlisted`**: Mastodon's convention is that a reply belongs to its
thread rather than on public timelines. The author can still choose `public` or `followers`.

The federated object is a `Note` at the post's canonical id
(`/users/<user>/feed/<postId>`) with:

- `inReplyTo` — the answered object's id;
- `content` — the author as a leading mention paragraph
  (`<span class="h-card"><a href="…" class="u-url mention">@user@host</a></span>`) followed by
  the reply markdown shaped for Mastodon like article prose and challenge notes (tables as
  lines, images as links) through the shared outbound sanitiser (`renderNoteProse`);
- `tag` — a `Mention` of the answered author, named by the `@user@host` snapshot taken at reply
  time (derived from the actor URI when the entry never carried one);
- `to`/`cc` — the visibility table, **plus the answered author in `cc`** so their server accepts
  the reply even though they don't follow us.

`Create`/`Update`/`Delete` wrap it exactly like every other post kind (`#create`,
`#update-<epoch>`, `#delete` ids) and all three are fanned out to **followers and the answered
author as two independent sends** — the same shape the challenge completion post uses, so one
dead follower inbox can't cancel the notification that exists precisely for someone who
doesn't follow us. The author actor is dereferenced from its id (`lookupObject`), never read
off anything inline.

Replies appear in the **outbox** like any post, but are **excluded from the public-profile
post listing** (`GET /public/:username/posts`) — Mastodon's own default profile tab hides
replies, and a bare comment lifted out of its thread reads as noise on a profile.

**Own-post comments (inbound).** Nothing new is ingested: a reply to one of the owner's still
existing posts is already admitted to the timeline from **any** actor (#1060, above), so the
comments under a post are simply the `timeline_entry` rows whose `in_reply_to_uri` is that
post's object id. `GET /feed/:postId/replies` (MCP `get_feed_post_replies`) returns the
**latest 100** of them oldest-first as full `TimelineEntry`s — carrying the reader's own
like/boost state and repliable in turn — with **no network fetch at all**. The owner's feed
listing carries a `reply_count` per post from one batched count query per page (like the
reaction counts beside it), so the web shows a `🗨 n` chip that expands the comments in place,
noting "Showing the latest N of M replies" when the count exceeds what was listed.

**Web.** Each timeline card's action row gains a 🗨 button opening an inline composer
(textarea capped at `feedPostMessageMaxLength`, a compact visibility selector defaulting to
`unlisted`, Post / Cancel). Posting closes the composer, refetches an open thread snapshot, and
leaves a "Reply posted ✓" note. The same action row serves the comment cards under an own post,
so a comment can be favourited, boosted or replied to without leaving the post. A `reply` post
on the owner's own feed renders with a `↩ replying to <handle>` line (linked to the author) and
the message through the shared markdown renderer.

### Native charts from Aurboda peers (structured enrichment)

A delivered `Note` carries the QuantPub scalar summary in-band (see above), but not the
high-resolution series data itself. To render a **native interactive chart** (with real,
hoverable values) instead of the plain HTML when a post comes from **another Aurboda
instance**, the receiver fetches the structured data out-of-band on ingest (the FEP §7
id-convention path — reliable even when a typed consumer drops the in-band extension):

1. **Emit.** Every instance serves `GET /public/:username/feed/:postId` — a native JSON payload
   (`FeedStructuredPost`: a discriminated union on `kind`). An **activity** post resolves to
   `FeedStructuredActivity`, the QuantPub `0.2` payload (`activityType`, the
   `startTime`/`endTime` window, `name`, typed scalar `metrics`, inline
   high-resolution `series` samples, and — only when the post attaches the route map
   (`include_map`) — a downsampled GPS `route` of timestamped points, capped at 500, from the
   same locations the route image draws, and — only under `include_exercises` — the session's
   `exercises` with their sets, measures and records), reusing the exact same scalar resolution as delivery
   and the same data-scoped series resolution as the [public series
   endpoint](#public-series-endpoint-the-privacy-boundary). An **article** post resolves to
   `FeedStructuredArticle` (the title and every block, resolved in the same order as the
   article: a prose block's raw markdown verbatim, with `images` declaring the http(s)
   pictures its markdown embeds (alt text and URL, in document order) — a receiver draws an
   inline picture only when its URL is declared there, so an undeclared one (a tracking pixel,
   raw `<img>` HTML) is dropped; a chart block's bucketed samples over its
   locked window, bucketed the same way as its block image; a correlation block's computed
   Pearson/Spearman/n, the present-vs-absent group comparison, and the aligned scatter points —
   the same `getContinuousCorrelation` call the block image uses; an impact block's `activity`,
   `activity_type`, `window_minutes`, window, `occurrences`, `avg_duration_min`, `timeline`
   buckets and `hrv_effect` / `hr_effect` / `stress_effect` — the same `getActivityImpact`
   call (exact match, no freshness sync) the block image uses, present for any bounded window
   even without sessions; a challenge block's `url` and
   caption, plus — when the challenge resolves — its QuantPub document and a standings
   snapshot, resolved like a challenge post's below, and also for another local user's
   challenge (from that user's database) or a remote one the author has not joined (the
   host's QuantPub document and standings, fetched within the same timeout; any failure
   leaves the block with only its URL and caption, which renders as a link card). An older
   Aurboda peer that predates challenge or impact blocks fails the strict parse of such a payload and
   falls back to the article's `Note` HTML — prose, captions, the join link and the attached
   images). A **challenge** post
   resolves to `FeedStructuredChallenge`: the author's note, the frozen `result` on a
   completion post, the challenge as its QuantPub Challenges §3 document (as publicly listed,
   without `joinToken`/`members`) and a §6 `standings` snapshot. An own challenge is found by
   parsing its share URL back to a slug; a joined one through the participation row, its
   document built locally and its standings fetched from the host only when the host speaks
   QuantPub (`/.well-known/quantpub` with `challenges: true`), time-boxed to 8 s and omitted on
   any failure. A challenge that is gone (deleted, or the participation left) 404s. The
   snapshot is only as fresh as the fetch that stored it, so the card says when it was taken
   and links the live page. An **exercise** post resolves to `FeedStructuredExerciseShare`:
   the name, the activity type and its display name, the author's note, the link when the
   exercise was published, and `data` — the public exercise page's `SharedExerciseData`
   with the records and session count emptied unless shared, the trend and per-week series nulled unless the
   chart was, and the history cut to the newest 5 sessions when sessions were shared (else
   empty); an exercise left with no sessions (its value merged away) 404s. A **dashboard** post
   resolves to `FeedStructuredDashboardShare`: the name, the period and its `window`, the
   stored `config` snapshot, the author's note, the link when the dashboard was published and
   linked, and `widget_data` — each widget's data for the period, resolved from the snapshot
   when the payload is served. Either way a peer can never
   read more than the author shared/published. `public`/`unlisted` posts resolve
   unconditionally; a `followers`-only post resolves only with a matching `?token=<image_token>`
   — the **same capability token** that authorizes its followers-only images (below), so the
   structured payload and the images share one authorization boundary.
2. **Detect + fetch.** On ingesting a `Create`/`Update`, if the note's id matches Aurboda's own
   object path (`/users/{user}/feed/{postId}` — a Mastodon status id never does, so no needless
   request is made), the receiver discovers the peer via `/.well-known/quantpub` (reading
   `apiBase`, or `api_base` from a `0.1` peer) and fetches its structured endpoint, normalising a
   `0.1` payload to `0.2` before storing it — the same path for an activity share or an article, since both federate
   as a `Note` and the object id doesn't distinguish them. For a `followers`-only post it lifts
   the capability token from the delivered image URL (the `?token=` embedded only in the
   follower's `Note`) and forwards it, so an accepted follower fetches the native payload while a
   public guess still 404s. A post whose origin is **this instance itself** (a local-to-local
   follow) skips discovery and HTTP entirely and resolves **in-process** through the same
   `resolveStructuredPost` the endpoint serves — fetching our own public origin would hairpin
   through the reverse proxy and, from inside the container, typically resolve to a private
   address the SSRF guard rightly refuses (#996). Remote fetches are **SSRF-guarded**
   (`safe-fetch`: public hosts only, no redirects, size + time bounded) and time-boxed; the
   origin is the accepted followee's own host. Any failure (non-Aurboda host, 404, malformed,
   timeout) still resolves to "no payload" — the post shows with its HTML — but is **logged**,
   so a broken enrichment path is diagnosable instead of looking identical to a Mastodon post
   (#996).
3. **Store + render.** The payload is stored on `timeline_entry.structured` (JSONB, NULL for
   non-Aurboda posts; a redelivery that can't re-fetch keeps the last-known value — a
   challenge's stale standings snapshot included — except an article's, which is dropped so
   the card falls back to the fresh `content` rather than showing the pre-edit title and prose
   (#973)). The web
   timeline card renders, per `structured.kind`: for an **activity** post the native
   activity card — title, personal message, the activity's date, a Strava-style **stat
   grid** from the typed scalars, one **combined multi-metric chart** (per-metric toggles,
   crosshair tooltip) over the shared series, and a **time-synced interactive map** over the
   shared route (the hovered chart time marks the position, exactly like the activity detail
   view) — or the full inline article — title, prose, per-block chart/scatter — for
   an **article** post (mirroring the author's own live `ArticleContent` render, but built from
   the embedded payload rather than a live fetch, since a receiving peer has no credentials to
   call the author's authenticated endpoints) — or, for a **challenge** post, the name linked
   to the live page, the podium on a completion post, the note, the spec line, the same
   cumulative race chart the public challenge page draws, a leaderboard, a "Standings as of"
   line and the join link. The author's public profile listing (`/public/:username/posts`)
   attaches the same payload, so a visitor sees the same card; the owner's own authenticated
   feed keeps the plain invitation card.

Enrichment is strictly best-effort and additive: it never blocks or fails basic ingest, an
activity's series that weren't shared (the opt-in) simply produce no chart, and an article's
chart/correlation/impact block with too little data renders the same "not enough data" fallback the
author's own live render shows.

**Lazy retro-enrichment (#996).** Entries ingested before enrichment shipped — or whose
ingest-time enrichment failed transiently — would otherwise keep `structured = NULL` forever.
Reading the timeline (REST `GET /feed/timeline` or the `list_timeline` MCP tool) kicks a
fire-and-forget pass that gives a small batch (3, newest first) of such Aurboda-shaped entries
one more attempt through the same enricher. A **definitive** outcome (payload stored, or a
gone/unauthorized/malformed response) stamps `enrich_attempted_at` so the entry is never
retried; a **transient** failure (network error, timeout) leaves it unstamped for a later
read — up to `MAX_TRANSIENT_ATTEMPTS` (3): the third transient failure stamps the entry
too, so a permanently unreachable peer can't hold the head of the newest-first queue
(#1021). At most one pass runs per user at a time, and a partial index keeps the drained-backlog
case free. An `Update` redelivery still re-enriches through the normal ingest path. The read
itself is never delayed; entries that gain a payload render natively on the next load.

### Live updates

New posts appear **without a refresh**. When a genuinely new `timeline_entry` is inserted, the
ingest path emits a Postgres `NOTIFY` ping on the user's DB (each user has one long-lived
connection, so the ping is received in-process). The web client holds an **SSE** stream open at
`GET /feed/timeline/stream`; each ping is forwarded as an empty `event: new` (no post content on
the wire — just "your timeline changed"). The client then refetches the newest page and shows a
**"N new posts"** pill; clicking it prepends the new posts.

The stream uses `fetch` (not `EventSource`) so the bearer token rides in the `Authorization`
header rather than the URL, and sends `X-Accel-Buffering: no` so nginx flushes each event
immediately. If the stream can't be opened or drops, the client **falls back to polling** the
same newest page every 30s — so the pill still works without a live connection. In-process
fan-out is handled by a single `TimelineHub` that keeps one `LISTEN` channel open per user
regardless of how many tabs are streaming.

### Images

A post can carry a rendered **heart-rate chart** (`include_chart`) and/or a **GPS
route map** (`include_map`) as AS2 `Image` attachments, so Mastodon shows them inline.
Both are rendered on demand (SVG → PNG) from the activity's data at public,
unauthenticated endpoints:

```
GET /api/public/:username/feed/:postId/chart.png
GET /api/public/:username/feed/:postId/chart.svg
GET /api/public/:username/feed/:postId/route.png
```

An opted-in image is only **attached when its data exists** (heart-rate samples or GPS
points in the activity's window): Mastodon drops an attachment whose URL fails to fetch
for good, so a promise of `route.png` before the route has synced would never recover.
The attachment URLs carry the post's version (`?v=<updated_at>`, beside `token` for a
`followers`-only post) because Mastodon re-downloads an attachment on an `Update` only
when its URL changed; the endpoints ignore `v` and key their render cache on the post's
stored `updated_at`, so an edit or a detail sync renders afresh and a guessed `v` cannot
bust the cache.

The chart is offered in two formats over the same series and window: the **PNG** is
what Mastodon and other peers attach, while **`chart.svg`** serves the same chart as
crisp, scalable `image/svg+xml` for **Aurboda-native** rendering (it stays sharp at
any size). Both share the same eligibility gate, capability-token model, and
`no-store` revocability.

A **challenge** post opted into `include_chart` renders its **standings race** (one
cumulative line per member, in leaderboard colours, with a legend of the first eight
members, the window's dates in the challenge timezone and the snapshot time) at:

```
GET /api/public/:username/feed/:postId/standings.png
GET /api/public/:username/feed/:postId/standings.svg
```

The data is the post's [structured payload](#native-charts-from-aurboda-peers-structured-enrichment)
resolved at request time, so the image shows the standings as they are, not as they were
at share time. The endpoints 404 for a non-challenge post, a post without the opt-in, a
`followers`-only post without its token, and a challenge without standings or without a
member that has a sample. The render cache keys on the post's `updated_at` plus a
5-minute bucket, the time remote members' standings are cached for. The delivered `Note`
attaches it as `Standings` (1000×420) only when it would draw, checked by resolving the
same payload before the `Create`/`Update` is sent; the `Note` served by the object
dispatcher and the outbox does not carry it. The owner's own feed card shows it in place
of the native race only when the post has no structured payload.

An **exercise** post opted into `include_chart` renders its **trend** (the decaying best of
the exercise's primary measure, labelled e.g. `Best e1RM · Dumbbell Bench Press`) at:

```
GET /api/public/:username/feed/:postId/trend.png
GET /api/public/:username/feed/:postId/trend.svg
```

resolved at request time from the post's structured payload, so the line includes sessions
logged after the share. The endpoints 404 for a non-exercise post, a post without the
opt-in, a `followers`-only post without its token, and a trend of fewer than 2 points. The
render cache keys on the post's `updated_at` plus a 1-hour bucket. The delivered `Note`
attaches it as `Trend` (1000×420) only when it would draw; the `Note` served by the object
dispatcher and the outbox does not carry it.

An **article** renders one image per chart/correlation/challenge/impact block for the same reason
(so Mastodon and export tools attach a raster of each block), at its own endpoints:

```
GET /api/public/:username/feed/:postId/blocks/:index/image.png
GET /api/public/:username/feed/:postId/blocks/:index/image.svg
GET /api/public/:username/feed/:postId/blocks/:index/figure.png
```

`figure.png` is the article `Note`'s attachment: the block's chart under a centred title band
(`Figure N` and the block's label, the caption cut with `…` to fit), so the image names the
reference the `Note`'s text makes to it — centred because Mastodon's two-image grid crops to
the middle. Its number and label come from the same walk over the article that writes the
`Note`'s `content`, so the two cannot disagree. `image.png` and `image.svg` stay the bare
chart, for the markdown export and the blog.

Unlike an activity chart, a block has **no `include_chart` opt-in flag** — a chart or
correlation block can embed any metric over any window, so the post's **visibility** is
the whole authorization boundary (public/unlisted open; `followers`-only via the
`?token=` capability). The chart block renders the metric bucketed over the locked
window; the correlation block renders the scatter with its OLS line and coefficient
headline; the impact block renders the impact chart (1000×560: the title, the three lines
with the during bucket shaded, the bucket labels, a legend and the before → after effect
lines) and moves hourly like a chart block; the challenge block renders the linked challenge's standings race chart (the same
chart as a challenge post's `standings.png`), cached in five-minute buckets like that image
rather than hourly, and 404s while the challenge has no standings to draw. It buckets in the author's **device timezone** (`device_timezone`, set by the
Android app) so a `1d` bucket splits on the author's calendar days like the web render;
for an author whose device timezone is unknown it falls back to UTC (the web render uses
the live browser timezone, so the two can differ by a day only in that case). Because an
article (unlike a shared activity) is editable **and** its locked window can later gain
backfilled data, the render cache keys on the post's `updated_at` **and** a coarse hourly
bucket, so an edit or new data serves a fresh image within ≤ 1h; a `null` (no-data) render
is remembered under the same key so a sparse public block can't re-run the render engine
on every hit. The markdown export clears that remembered miss for every block it finds
drawable, so the image link it emits works at once rather than 404ing until the hour rolls
over. `figure.png` shares the eligibility, the negative cache and that clearing, under its
own render-cache entry. The AS2 `Image` attachment URL (`figure.png`) also carries
`?v=<updated_at>` so a remote media cache (which re-hosts the PNG at receipt) re-fetches
after an edit.

A block image endpoint **404s** when the block is too sparse to draw (a chart with < 2
points, a correlation with n < 3, an impact without sessions or with fewer than two buckets
holding any mean) or has a zero-duration bucket. The article's `Note`
attaches one `Image` per figure **unconditionally** (the attachment list is built without a
synchronous pre-render), so a sparse block ships an attachment URL that resolves to 404 — a
plain fediverse client just shows one fewer image. Each attachment is named
`Figure N: label` and sized as the chart plus the 88px title band. **Mastodon caps a remote
status at 4 media attachments** (`MEDIA_ATTACHMENTS_LIMIT`) when processing an inbound
`Create`, so it shows only the first four figures; the text's reference to figure 5 and on
is a link to the image instead (Aurboda peers, which fetch the native payload, aren't
capped).

An image is served when the matching flag was opted into. `public`/`unlisted` posts
serve their images unauthenticated. A `followers`-only post's image URLs instead carry
the post's **unguessable capability token** (`?token=<image_token>`), which is embedded
only in the `Note` delivered to followers; a request without a matching token 404s. This
is a deliberate capability-URL model (like the shared-dashboard slugs), chosen because
the fediverse fetches media **without** HTTP signatures — Mastodon's "authorized fetch"
signs ActivityPub object/actor requests, not media downloads — so a signed-request gate
wouldn't be exercised and followers would just see a broken image. The tradeoff is that a
leaked image URL grants access to that one rendered image (a chart or a route map,
not the underlying high-resolution series, which stays `followers`-excluded entirely).
Responses are `no-store`, so an unshare / cleared flag / a public→followers flip takes
effect immediately (the now-untoken'd public URL 404s). The route is drawn over an
**OpenStreetMap street basemap** (see below); **no privacy trimming** is applied (area
masking is a planned follow-up), so a route map reveals the precise area.

The chart image and the heart-rate **series** are the same data in two formats, so the
share dialog exposes them as **one control**: opting into the heart-rate series
(`series_metrics` ∋ `heart_rate`) also sets `include_chart`, so Aurboda followers get the
native interactive chart (from the series) and Mastodon/other peers get the rendered PNG.
The dialog derives `include_chart` from that one toggle rather than offering it separately
(the REST/MCP fields stay independent for programmatic callers). It only offers the
heart-rate control when the activity has heart-rate data, and the map toggle when it has an
actual GPS track.

**Route basemap.** The route map projects the GPS track into Web Mercator, fetches the
covering OpenStreetMap tiles, and composites them behind the track (with a white halo for
legibility) plus start/end markers. The required "© OpenStreetMap contributors"
attribution is baked into the image. OSM's tile usage policy is respected: a descriptive
`User-Agent`, and low volume — route renders are cached per post, so tiles are fetched at
most once per route until eviction. Tile fetching is best-effort with a short timeout; if
the tiles can't be fetched (e.g. offline) it falls back to a bare polyline on a dark
background.

## Public series endpoint (the privacy boundary)

High-resolution series are **never** embedded in a post. Instead each shared series is
exposed through a public, read-only endpoint:

```
GET /public/:username/series?metric=<key>&start=<iso>&end=<iso>&bucket=<5s|60s|1h|1d|…>
```

`metric` is the lowerCamelCase QuantPub key (`heartRate`); the `0.1` snake_case form
(`heart_rate`) is also accepted, and the response's `metric` is always the camelCase
form. An unknown key is the same plain 404 as any other unauthorized request.

Like a shared-dashboard slug, it takes **no auth token** — so the scoping below is the
_entire_ privacy boundary, and it is **data-driven, not obscurity-based**. A request
resolves only when **all** of these hold:

1. some feed post shared **that exact metric as a series** (`series_metrics`) — sharing
   only the scalar summary never exposes the series;
2. that post is **`public` or `unlisted`** (a `followers`-only post has no public series);
3. the shared activity is **not soft-deleted** and has a bounded window (an `end_time`);
4. the activity's window **covers** the requested `[start, end]` range.

When it resolves, the effective range is **clamped** to the activity's window (the
caller's bounds can never widen it), the bucket granularity is **floored** server-side
(minimum 5s) to bound payloads, and only the requested metric's aggregated buckets are
returned — per-measurement timestamps are dropped. Anything else — an unshared metric,
a `followers`-only share, a window outside any shared activity — returns **404**.

Deleting a feed post, changing its visibility to `followers`, removing the metric from
`series_metrics`, or soft-deleting the activity all immediately stop the series from
resolving.

## Using it in the web app

- **Share** — an activity's detail page has a **Share to feed** button. It opens a dialog
  to write an optional personal message (prefilled from the activity's description /
  comments, fully editable), pick the summary metrics, optionally opt into full series,
  share a strength session's exercises (offered when it has any, checked by default),
  and choose the audience — with a **live preview** (#902) of the exact federated
  content (resolved server-side through the same code path as delivery, debounced) and
  which images would attach, so what leaves the instance is visible before Share. The **owner's own feed** renders each activity post with the
  **same native card component a subscribing Aurboda peer's timeline uses** — the owner-facing
  feed responses include the full structured payload (typed scalars + inline series + route,
  assembled by the same helper the public structured endpoint uses), so the author sees the
  interactive combined chart and time-synced map exactly as a follower would, and can verify
  what they shared. The listing is **keyset-paginated** (20 per page, "Load more" — the same
  cursor style as the home timeline), so the inline payload weight stays bounded per request
  however many posts exist (#1012). The **public profile** (`/u/:username`) attaches the same
  full structured payload per activity **and article** post (through the per-post LRU the
  structured endpoint shares), and pages the same way — 20 per page with a "Load more" driven
  by `next_cursor` (#1055) — so visitors see the identical native card and can reach every
  public post. An article renders from that server-resolved payload for a visitor (the same
  `TimelineArticle` a follower's timeline uses), since its live chart/correlation blocks fetch
  the owner-authenticated metric endpoints a visitor can't reach; the owner's own feed keeps
  the live render (#1054). The MCP `list_feed`
  tool remains the one surface that omits `structured` (an intentional payload-weight divergence
  from `GET /feed`, not a capability gap: the underlying data is all reachable via the
  metric-query tools).
- **Share an exercise** — an exercise's page (`/activity-type/:name/item/…`) has a **Share
  to feed** arrow button next to **Publish** / **Published**. Its dialog takes an optional
  message (markdown), the data opt-ins (records and session count, the trend chart, the last
  5 sessions' sets), **Link the public page** (offered only when the exercise is published;
  otherwise a note says to publish it first) and the audience, with a debounced **live
  preview** of the exact native card and, folded under it, the plain text Mastodon sees. The
  owner's feed, the public profile and a peer's timeline render the post natively — records,
  the one chart (weekly bars with the decaying-best line, or the trend alone), the last
  sessions — and show the `Trend` image only where the card has no chart to draw.
- **Share a dashboard period** — a period dashboard (the home dashboard, or one of your
  dashboards opened at `/u/<you>/<slug>`) has a **Share to feed** arrow button right of the
  period switcher, which shares the period shown. Its dialog takes an optional message
  (markdown), **Link the dashboard's public page** (offered only when the dashboard is
  unlisted or public), the tags and the audience, with a debounced **live preview** of the
  native card and, folded under it, the plain text Mastodon sees. The owner's feed, the
  public profile and a peer's timeline render the post as the dashboard's widgets for that
  period (quick links left out); a post whose period could not be resolved shows its name,
  period, note and link.
- **Feed page layout** — the **Feed** page (`/feed`, the 📣 item under the **Sharing** section
  in the sidebar) puts writing first: a **Write an article** button with your **Drafts** listed
  under it, then tabs — **Following** (your home timeline, the default) and
  **Your posts** — kept in the URL as `?tab=mine` so a reload or the Android embed stays on it.
  A third tab, **People & sharing** (`?tab=manage`), holds the Following, Followers and auto-share
  rule panels.
- **Write an article** — opens the article composer: a title, an optional default time
  window, and an ordered list of **prose** (markdown), **chart** (a metric + optional
  per-block window + caption), **correlation** (a trigger + outcome selector + optional
  lag/window/caption) and **challenge** (one of your challenges or a joined one, or a pasted
  challenge URL, + caption) blocks, plus the audience. Each chart draws its metric live over the
  locked window; each correlation draws a live scatter (with the coefficients) over its
  window. **Save draft** saves without publishing (and shows "Saved hh:mm"); **Publish**
  validates and publishes. Closing with unsaved changes asks whether to save them as a
  draft. Each listed draft has **Continue** (reopens it in the composer) and **Delete**.
- **Your posts** — lists everything you've shared, with each post's audience and metrics.
  From there you can **Edit** a post — an activity share re-opens the share dialog (saving
  federates an `Update`); an article re-opens the article composer — or **Unshare** it
  (federates a `Delete`). An article also has an **Export markdown** button that fetches its
  paste-ready markdown export and offers a **Copy to clipboard** button for pasting into
  r/QuantifiedSelf or a similar text-only destination.
- **Follow** — the **Following** panel (under **People & sharing**) lets you follow a fediverse actor by
  handle (`@user@host`) and see who you follow, with a **Pending** badge until the remote
  server accepts and an **Unfollow** button.
- **Followers** — the **Followers** panel (under **People & sharing**) lists who follows you. If you've
  turned on **Manually approve new followers** (Settings → _Feed & Followers_), incoming follows
  show up here as **follow requests** with **Approve** / **Reject** buttons; accepted followers
  can be **Removed**. With approval off (the default), anyone can follow you automatically.
- **Home timeline** — the **Following** tab shows posts from the actors you follow,
  newest-first, as native cards with a **Load more** button to page further back. New posts
  arrive **live** (or via polling fallback) as a **"N new posts"** pill at the top; click it to
  reveal them.
- **Public profile** — a user's `/u/<username>` page shows their public feed (their
  `public`/`unlisted` posts, newest-first, as the same post card) alongside their shared
  dashboards and challenges. It's unauthenticated, so anyone — including a follower who saw
  a post in their timeline — can browse a person's public posts and info. A **local**
  author's name in the home timeline / Following / Followers lists links to their
  `/u/<username>` page; a remote (Mastodon &c.) author isn't linked (they have no page here).
  When the user has any public/unlisted article, the profile header links their **Blog**.

### Blog view and Atom feed

A user's blog is their **articles** — there is no separate blog storage. The instance's own
blog is the [official feed](#official-feed).

- **Blog view** — `/u/<username>/articles` lists only that user's `public`/`unlisted`
  articles, newest-first, with **Load more**, via `GET /public/:username/posts?kind=article`
  (the profile listing's `kind` filter; replies and `followers`-only posts never appear).
- **Atom feed** — `GET /public/:username/articles.atom` (under `/api` behind nginx) serves
  the 20 newest **`public`** articles as Atom 1.0 for readers without a fediverse account —
  `unlisted` ones stay out, since syndicating to feed readers is listing them. Each
  entry's id and link are the post's permalink (`/u/:username/posts/:postId`), and its HTML
  content is the article's markdown export (prose plus each chart block as an inline image of
  its public PNG, a "not enough data" line where the block would not render) through the same
  sanitiser as federated prose. Unlike the JSON listing (`no-store`), the feed is cached for
  five minutes (`public, max-age=300`) because feed readers poll; an un-shared article drops
  out within that window. The server also memoizes the rendered XML in-process (100 feeds),
  keyed on the listed articles' ids and `updated_at` plus the hour, so a poll with nothing
  changed costs the listing query rather than a chart query per block. It has **no MCP
  twin**: it is a syndication format, like the OpenAPI document.
- **Link previews** — the share-HTML router gives `/u/:username/articles` blog meta with an
  Atom discovery `<link rel="alternate" type="application/atom+xml">`, and a **`public`**
  article's permalink `/u/:username/posts/:postId` its title and an excerpt of its first prose
  block (`og:type` `article`). Unlisted articles and other post kinds keep the generic meta.
- **Instance blog** — see the [official feed](#official-feed) below; it replaced the single
  `blog_username` setting.

### Official feed

The instance's front page links an **official feed** at `/blog`: the `public` posts of
admin-chosen local users, and of authors on other servers, that carry one of admin-chosen
hashtags — a curated instance blog, e.g. everyone's `#aurboda` posts.

- **Setting** — `official_feed: { users, remote_authors, tags }` in the server settings (Admin
  Settings → Official Feed, `PATCH /admin/settings`). `users` is 0–20 existing usernames (an
  unknown one is a 400 naming it), `remote_authors` 0–20 fediverse handles (`@user@host` or
  `user@host`, stored as `user@host`, deduplicated ignoring case; a handle on this server's own
  host is moved to `users`), `tags` 0–20 hashtags stored like post tags (lowercase, without `#`,
  deduplicated). Remote authors need at least one tag (a 400 otherwise): their posts reach this
  server only through the tag follows below. The feed is off while both `users` and
  `remote_authors` are empty; empty `tags` lists every public post of the users.
  `remote_authors` may be left out of a request and of a setting stored before it existed, and
  reads as empty. `GET /status` says `official_feed: true` while it lists a remote author or a
  user who still exists, and the web app then links **Blog** from the logged-out front page and
  the site footer. Deleting an account takes that user off the list.
- **Default for new installations** — at startup, a server with no user accounts, no stored
  `official_feed` and no legacy `blog_username` stores
  `{ users: [], remote_authors: ['fiddur@aurboda.net'], tags: ['aurbodablog'] }`: the Aurboda
  project blog. Existing installations (which have users) are unchanged: their feed stays off until
  an admin sets it, and an admin can change or clear the default like any other setting.
- **Remote authors** — while `remote_authors` is non-empty, the instance actor follows each of
  the feed's tags on the tag actor host (`<tag>@tags.pub` by default), alongside the
  [public tag pages](#public-tag-pages)' tags, and stores what the tag actor announces in the same
  central `public_tag_posts` table; a feed tag does not get a public page of its own. The follows
  are applied when the setting is saved, once at startup (in the background, with a timeout: a
  server the tag actor host cannot reach, such as a localhost dev server, logs one line and boots
  on) and nightly before the prune. The author's own server must deliver their public posts to
  the tag actor host: on aurboda.net that is the tags.pub relay (Admin Settings → Federation →
  Relays); elsewhere the author can follow `@_followback@tags.pub`. A remote author's posts in the
  feed are kept without the public tag pages' retention limit; the nightly prune keeps every row
  by a listed remote author carrying one of the feed's tags.
- **Migration** — until `official_feed` is first written, a legacy `blog_username` reads as
  `{ users: [blog_username], tags: [] }`. Writing `official_feed` clears `blog_username`. The
  admin `PATCH` still accepts the deprecated `blog_username` for one release (as
  `official_feed.users = [it]`, `null` turning it off); the responses no longer carry it.
- **Which posts** — from each listed user, `public` posts only (an instance-wide listing is a
  public timeline, so `unlisted` stays off it, as on Mastodon), any kind but `reply`, and with
  tags set, only posts carrying at least one of them (`tags && $tags`, backed by the GIN index).
- **Which remote posts** — rows of `public_tag_posts` whose `handle` (`@user@host`, compared
  case-insensitively) is a listed remote author and whose tags overlap the feed's, not this
  server's own (`local_user` set).
- **Paging** — every user has their own database, so `GET /public/official-feed?cursor=` asks
  each listed user for 21 rows after the cursor, and the central table for 21 remote rows, and
  merges them newest-first on `(created_at, id)` for local posts and `(published_at, id)` for
  remote ones, at microsecond precision; 20 make the page and the last one the `next_cursor`.
  Ids are UUIDs, so the key is unique across sources. A listed user whose database is missing is
  skipped (logged once). Each entry carries `origin`: a `local` one serialises as on the
  author's profile listing (structured payload included, through the same cache), plus
  `author_username`; a `remote` one as on a public tag page (`OfficialFeedRemotePost`). The
  response also carries the feed's `users`, `remote_authors` and `tags`. Unauthenticated,
  `no-store`, a 404 while the feed is off. No MCP twin: it is a public read of what the
  profiles and the public tag pages already serve.
- **Atom** — `GET /public/official-feed.atom` serves the 20 newest entries, cached for five
  minutes like the articles feed. Each entry names its author; an article's body is its
  markdown export as above, any other post's the HTML it federates with (an activity or
  exercise summary, a challenge invitation, else its message), titled by the article,
  activity, exercise, dashboard or challenge name, else the first ~80 characters of its text. A
  remote entry is identified by the Note's id, links to the original (its `url`), carries the
  stored sanitised HTML and images, names its author (display name, else handle) and is titled
  by the first line of its text.
- **Web** — `/blog` (public, like the `/u/` pages) shows "Posts from … tagged …" (remote authors
  by their full `@user@host`), the Atom link and the posts: local ones as cards with each post's
  own author, remote ones as the public tag page shows them. The share-HTML router gives `/blog`
  meta titled "<host> blog" with the Atom discovery link (nginx proxies `/blog` to the backend
  as it does `/u/`).

### Public tag pages

`/tags/<tag>` lists the public posts, from this server and others, that carry `#<tag>`, for the
tags an admin configured (`public_tag_pages`, see [admin](../admin.md#federation)). It is fed two
ways, into one central `public_tag_posts` table, the first through the instance actor's follows:

- **From the fediverse** — the instance actor follows the tag's actor on the tag actor host
  (`<tag>@tags.pub`), which `Announce`s every public post it sees with the tag. These arrive on the
  instance actor's inbox or the shared `/inbox` and are kept only when: the sender is a followed
  tag actor whose follow it **accepted** (a stranger's `Announce`, or a stranger's `Accept` of our
  follow, changes nothing); the `Announce` id is on the sender's host; the Note is **fetched from
  its own id**, signed as the instance actor (a Note embedded in the `Announce` is ignored), and
  is on the same host as the announced id and as its author; it names the **Public collection**
  in `to` (an unlisted post, Public only in `cc`, or a followers-only one never lands on a public
  page); it **carries the followed tag itself**; it is **not a reply**; it is not behind a content
  warning (`sensitive`, or a non-empty `summary`); and its author's actor document answers at the
  attributed id. The content is sanitised like a timeline post's, the images captured the same
  way, the tags are the Note's own, and the link is the Note's `url` only when it is `http(s)`
  (else its id). One row per Note, keyed on its id: a second tag actor's `Announce` of the same
  post adds its Announce id to the row. A tag actor's `Undo{Announce}` removes its Announce id,
  and the row goes once no Announce keeps it. An author's `Delete` of a post removes its row
  (scoped to the sender, like the timeline's), and an actor's `Delete` of itself removes all of
  theirs; but a remote author's own `Delete` rarely reaches this server (it goes to their
  followers), so a deleted remote post usually leaves the page on the tag actor's
  `Undo{Announce}`, or at the latest when retention prunes it. Remote edits are not followed: a
  row keeps the Note as it was first fetched.
- **The follows** — each follow attempt has its own id, `<origin>/actor/follows/tags/<tag>/<uuid>`,
  stored on the row, and the `Undo{Follow}` is built from that stored id (`<id>#undo`). Saving
  the tag list (or the tag actor host) re-sends the `Follow`, with a fresh id, for every tag not
  yet accepted; when the tag actor host changes, the follows on the old host are undone and
  dropped and the tags followed anew on the new one. New tags are resolved and followed
  concurrently. The admin settings report each tag's state (`public_tag_follows`: `accepted`,
  `pending`, or `unresolved` when no follow exists).
- **From this server** — every `public` top-level post (not a reply) whose tags include a
  configured one is recorded as it is delivered, as the same leg of the fan-out that pushes it
  to relays, never failing the delivery. An edit re-records it; an edit making it non-public, or
  its deletion, removes it. Posts published before the tag was configured are not backfilled.

Rows older than the retention (`public_tag_retention_days`, default 30, by publication time),
except the [official feed](#official-feed)'s remote posts, and rows with no followed tag left (a
public page's, or the official feed's while it lists remote authors) are pruned nightly, and the listing and the Atom feed apply the
retention when read, so a shortened retention takes effect at once. There is no moderation of tag
pages yet beyond removing the tag; a follow-up issue tracks hiding posts and blocking actors and
domains. The listing is
`GET /public/tags/:tag/posts?cursor=` (unauthenticated, `no-store`; 404 for a tag without a
page): 20 entries newest-first by `(published_at, id)` with `next_cursor`, each in the home
timeline's entry shape (no structured payload, reactions or replies), plus the `tag` and
`retention_days`. `GET /public/tags/:tag.atom` is its Atom feed (20 newest, each entry titled by
its author, identified by the Note's id and linking to the original; a tag without a page falls
through to the next handler). The MCP tool `list_public_tag_posts` (`tag`, `cursor`)
returns the same page. The web page (public, like `/blog`) renders each post as a read-only card
with its `#tag` line, linking the tags that have a page of their own; the logged-out front page
and `/blog` link every configured tag ("See what people share with #aurboda").

## API

Owner-facing (authenticated, scoped to the caller):

| Method & path                                     | Purpose                                                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /feed`                                       | My feed posts, newest-first, keyset-paginated (`?cursor=` from the previous page's `next_cursor`); each post enriched with the shared activity's title/type, merged-span window, and full structured payload |
| `POST /feed/activities/:id/share`                 | Publish an activity with a chosen metric selection                                                                                                                                                           |
| `POST /feed/articles`                             | Publish a long-form **article** (title + prose + inline chart/correlation/challenge blocks)                                                                                                                  |
| `POST /feed/activities/:id/preview`               | Live share **preview** (#902): the exact federated content + resolved metrics for a selection; creates nothing                                                                                               |
| `POST /feed/challenges`                           | Share a **challenge invitation** (personal note + canonical link); exactly one of `challenge_id`/`participation_id`                                                                                          |
| `POST /feed/exercises`                            | Share an **exercise's progress** (records, trend, recent sessions per the opt-ins; a link only when the exercise is published)                                                                               |
| `POST /feed/exercises/preview`                    | Exercise share **preview**: the exact `Note` HTML and structured payload for the opt-ins; creates nothing                                                                                                    |
| `POST /feed/dashboards`                           | Share **one finished period of a period dashboard** (a config snapshot; a link only when the dashboard is published)                                                                                         |
| `POST /feed/dashboards/preview`                   | Dashboard-period share **preview**: the exact `Note` HTML, structured payload and tags; creates nothing                                                                                                      |
| `GET/POST /autoshare-rules` (+`/:id`, `/preview`) | [Auto-share rules](auto-share-rules.md): automatically publish matching settled activities (#903)                                                                                                            |
| `PATCH /feed/articles/:postId`                    | Edit an article (title / blocks / default window / visibility)                                                                                                                                               |
| `/feed/article-drafts` (+`/:id`, `/:id/publish`)  | Private [article drafts](#article-drafts): list, save, edit, delete, publish (validated like `POST /feed/articles`)                                                                                          |
| `POST /feed/articles/preview`                     | Article **[preview](#preview)** (#1605): the Note content, figures, publish error and a Mastodon web UI emulation; creates nothing                                                                           |
| `/feed/images` (+`/:id`)                          | [Pictures](#pictures) added to what I write: upload (multipart `image`), list, delete                                                                                                                        |
| `GET /feed/articles/:postId/export`               | Export an article as paste-ready markdown (title + prose + one image link per block) for Reddit/text-only destinations                                                                                       |
| `PATCH /feed/:postId`                             | Edit an activity post's selection / visibility / attachments                                                                                                                                                 |
| `DELETE /feed/:postId`                            | Unpublish any post (an activity post's public series stops resolving)                                                                                                                                        |
| `GET /feed/following`                             | List the actors I follow (accepted + pending)                                                                                                                                                                |
| `POST /feed/following`                            | Follow an actor by handle (`@user@host` or actor URL)                                                                                                                                                        |
| `DELETE /feed/following/:id`                      | Unfollow (sends `Undo{Follow}`)                                                                                                                                                                              |
| `GET /feed/followed-tags`                         | List the [hashtags I follow](#hashtags) (accepted + pending), by tag                                                                                                                                         |
| `POST /feed/followed-tags`                        | Follow a hashtag (`{ tag }`): follows its tag actor `<tag>@<tag_actor_host>`                                                                                                                                 |
| `DELETE /feed/followed-tags/:tag`                 | Unfollow a hashtag (sends `Undo{Follow}` to its tag actor)                                                                                                                                                   |
| `GET /feed/followers`                             | List my followers; `?status=pending\|accepted\|all` (default `all`)                                                                                                                                          |
| `POST /feed/followers/:id/approve`                | Approve a pending follow request (sends the deferred `Accept`)                                                                                                                                               |
| `DELETE /feed/followers/:id`                      | Reject a request / remove a follower (sends `Reject`)                                                                                                                                                        |
| `GET /feed/timeline`                              | My home timeline (posts from followees), newest-first, `?cursor=` to page, `?tag=` to filter by a hashtag                                                                                                    |
| `GET /feed/timeline/stream`                       | Server-Sent Events stream of live "new posts" pings (falls back to polling)                                                                                                                                  |
| `POST/DELETE /feed/timeline/:id/like`             | Favourite ⭐ / un-favourite a timeline post (`Like` / `Undo{Like}`); idempotent, returns the updated entry                                                                                                   |
| `POST/DELETE /feed/timeline/:id/boost`            | Boost 🔄 / un-boost a timeline post (`Announce` / `Undo{Announce}`); idempotent, returns the updated entry                                                                                                   |
| `GET /feed/timeline/:id/replies`                  | Bounded snapshot of a timeline post's thread (origin's `replies` + my own replies merged); `fetched`/`partial`                                                                                               |
| `POST /feed/timeline/:id/reply`                   | Reply 🗨 to a timeline post — publishes a `reply` post (`Create{Note inReplyTo}` + `Mention`); `visibility` defaults to `unlisted`                                                                           |
| `GET /feed/:postId/reactions`                     | Who favourited, boosted or quoted one of MY posts (newest first, max 100); a quote has kind `quote` and the quoting post in `url`                                                                            |
| `GET /feed/:postId/replies`                       | The comments received under one of MY posts (the latest 100, oldest first), as full timeline entries — no network fetch                                                                                      |

Admin-only: `GET /admin/relays`, `POST /admin/relays` (`{ url, style }`) and
`DELETE /admin/relays/:id` manage the [relays](../admin.md#federation) public posts are pushed to
(MCP `list_relays`, `add_relay`, `remove_relay`).

Public / federation (unauthenticated):

| Method & path                                                 | Purpose                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /public/:username/series`                                | Bucketed samples for a **shared** series within its window                                                                                                                                                                                                               |
| `GET /public/:username/feed/:postId`                          | Native structured post (`FeedStructuredPost`: an activity's typed metrics + inline series, an article's title + resolved blocks, a challenge's document + standings snapshot, an exercise's progress, or a dashboard period's widgets) for Aurboda-to-Aurboda enrichment |
| `GET /public/:username/feed/:postId/chart.png`                | Rendered HR chart (PNG) for an opted-in post (`?token=` for followers-only)                                                                                                                                                                                              |
| `GET /public/:username/feed/:postId/chart.svg`                | Same HR chart as crisp `image/svg+xml` for Aurboda-native rendering (`?token=` for followers-only)                                                                                                                                                                       |
| `GET /public/:username/feed/:postId/route.png`                | Rendered GPS route map for an opted-in post (`?token=` for followers-only)                                                                                                                                                                                               |
| `GET /public/:username/feed/:postId/standings.png`            | Rendered standings race chart (PNG) for an opted-in challenge post (`?token=` for followers-only)                                                                                                                                                                        |
| `GET /public/:username/feed/:postId/standings.svg`            | Same standings race as crisp `image/svg+xml`                                                                                                                                                                                                                             |
| `GET /public/:username/feed/:postId/trend.png`                | Rendered exercise trend (PNG) for an opted-in exercise post (`?token=` for followers-only)                                                                                                                                                                               |
| `GET /public/:username/feed/:postId/trend.svg`                | Same exercise trend as crisp `image/svg+xml`                                                                                                                                                                                                                             |
| `GET /public/:username/feed/:postId/blocks/:index/image.png`  | Rendered PNG of an article's chart/correlation/challenge block (visibility-gated; `?token=` for followers-only)                                                                                                                                                          |
| `GET /public/:username/feed/:postId/blocks/:index/image.svg`  | Same article block as crisp `image/svg+xml`                                                                                                                                                                                                                              |
| `GET /public/:username/feed/:postId/blocks/:index/figure.png` | The article block's PNG under a `Figure N` title band: the article `Note`'s attachment (same gating as `image.png`)                                                                                                                                                      |
| `GET /public/:username/posts`                                 | A user's public/unlisted posts (newest-first, keyset page of 20 + `next_cursor`) for their profile feed; `?kind=article` for the blog view                                                                                                                               |
| `GET /public/:username/articles.atom`                         | Atom 1.0 feed of the user's 20 newest public articles ([Blog view and Atom feed](#blog-view-and-atom-feed))                                                                                                                                                              |
| `GET /public/official-feed`                                   | The instance's [official feed](#official-feed): public posts of the chosen users and remote authors with one of the chosen tags, newest-first, keyset page of 20 + `next_cursor`                                                                                         |
| `GET /public/official-feed.atom`                              | Atom 1.0 feed of the official feed's 20 newest entries                                                                                                                                                                                                                   |
| `GET /public/tags/:tag/posts`                                 | A [public tag page](#public-tag-pages): public posts with the tag from this server and others, newest-first, keyset page of 20 + `next_cursor` (MCP `list_public_tag_posts`)                                                                                             |
| `GET /public/tags/:tag.atom`                                  | Atom 1.0 feed of a public tag page's 20 newest posts                                                                                                                                                                                                                     |
| `GET /public/:username/posts/:postId`                         | One public/unlisted post, serialized like the listing (`FeedPostResponse`), for its permalink page `/u/:username/posts/:postId`                                                                                                                                          |
| `GET /.well-known/webfinger`                                  | Resolve `acct:<username>@<host>` → the actor                                                                                                                                                                                                                             |
| `GET /.well-known/quantpub`                                   | QuantPub discovery document (FEP §4): product, versions, `apiBase`                                                                                                                                                                                                       |
| `GET /ns/quantpub`                                            | The published QuantPub JSON-LD `@context` document (`application/ld+json`)                                                                                                                                                                                               |
| `GET /.well-known/nodeinfo`                                   | NodeInfo JRD pointing at the 2.1 document (#1047)                                                                                                                                                                                                                        |
| `GET /nodeinfo/2.1`                                           | NodeInfo 2.1: software `aurboda` + version, `activitypub` protocol (no usage stats — per-user DBs)                                                                                                                                                                       |
| `GET /users/:username`                                        | Content-negotiated (RFC 9110, `Vary: Accept`): the actor document (`Person`) for an ActivityPub type, a wildcard or no `Accept`; a 302 to `/u/:username` when HTML is the best match (a browser, `text/*`); `406` when neither is acceptable; `404` for an unknown user  |
| `GET /users/:username/outbox`                                 | Public + unlisted posts as `Create` activities                                                                                                                                                                                                                           |
| `GET /users/:username/followers`                              | The actor's followers collection                                                                                                                                                                                                                                         |
| `GET /users/:username/following`                              | The actor's following collection (accepted follows of people only; followed hashtags are left out)                                                                                                                                                                       |
| `GET /users/:username/feed/:postId`                           | Content-negotiated like the actor: a single post's `Note` — an activity share or an article (or `410` Tombstone once deleted); a 302 to `/u/:username/posts/:postId` for a browser on any post id of an existing user                                                    |
| `POST /users/:username/inbox` (+ `/inbox`)                    | Inbound `Follow` / `Undo{Follow}` / `Accept` / `Reject` (HTTP-Signature verified)                                                                                                                                                                                        |
| `GET /actor`                                                  | The instance actor (`Application`) that subscribes to [relays](../admin.md#federation)                                                                                                                                                                                   |

The actor's `icon` URL carries the avatar's upload time as a `?v=` version, and an avatar
upload/removal delivers an `Update{Person}` to accepted followers — remote servers (Mastodon
et al.) cache a copied avatar and re-download it only on one of those two signals, so without
them a changed avatar never propagates.

The actor's `name` is the user's display name (the `display_name` user setting, set at signup or
in Settings → **Profile**, via `PATCH /user/settings` or MCP `update_user_settings`), left out when
none is set so other servers show the username. Changing it delivers an `Update{Person}` the same
way an avatar change does. A display name with control characters (tab and newline included) or
bidirectional embedding, override or isolate characters is refused with `400` wherever it is set.
The public profile page (`/u/:username`, from
`GET /public/:username/dashboards`'s `display_name`) shows it above `@username`. The account's
email is never part of the actor or any public response.

The owner-facing capability is also available over MCP as `list_feed`, `share_activity`,
`preview_activity_share`, `share_challenge`, `share_exercise`, `preview_exercise_share`, `share_dashboard_period`, `preview_dashboard_period_share`, `create_article`, `update_article`, `preview_article`, the [article draft](#article-drafts) tools, `export_article_markdown`, `update_feed_post`,
`delete_feed_post`, `list_following`, `follow_actor`, `unfollow_actor`, `list_followed_tags`,
`follow_tag`, `unfollow_tag`, `list_followers`,
`approve_follower`, `reject_follower`, `list_timeline`, `like_timeline_post`,
`unlike_timeline_post`, `boost_timeline_post`, `unboost_timeline_post`,
`get_timeline_replies`, `reply_to_timeline_post`, `get_feed_post_replies`, and
`list_feed_post_reactions` — all backed by the same services as
the REST routes (`create_article` / `update_article` ↔ `POST /feed/articles` / `PATCH
/feed/articles/:postId`; `export_article_markdown` ↔ `GET /feed/articles/:postId/export`), so an
article can be drafted conversationally by Claude via the same tools — as a private draft
(`create_article_draft`) the user finishes in the web editor, or published directly. Manual follower approval is
toggled with the `manually_approve_followers` user setting (`get_user_settings` /
`update_user_settings`).

## Storage

Feed posts live in the user's own database in the `feed_posts` table (unpublished
[article drafts](#article-drafts) live apart, in `article_drafts`, and [pictures](#pictures) in `feed_image`). A `kind` column
discriminates an `activity` post from an `article`, `challenge`, `exercise`, `dashboard` or `reply` post; an
article's content (title + default window + ordered blocks) lives in a nullable `article` JSONB
column, a challenge share's link payload (name + canonical URL + optional host identity)
in a nullable `challenge` JSONB column, an exercise share's pointer and opt-ins (type, item
path, value, name, `include_records`, `include_sessions`, optional `url`) in a nullable
`exercise` JSONB column, a dashboard share's period and config snapshot (name, optional
`dashboard_id`, `period`, `config`, `include_link`, optional `url`) in a nullable `dashboard`
JSONB column, and in all four cases the `activity_id`/metric columns stay empty. A **reply** post likewise carries no activity or metrics: three nullable
columns hold what it answers — `in_reply_to_uri` (the AS2 object id), `in_reply_to_actor_uri`
(the `Mention` href) and `in_reply_to_handle` (the `@user@host` snapshot naming that mention,
taken at reply time like `timeline_entry.handle`) — with the reply text in `message`. All
three are resolved server-side from the timeline entry being replied to, never client-supplied.
A partial index on `(in_reply_to_uri, created_at)` backs the own-replies merge into a thread
snapshot. A nullable `message` column holds the author's
personal message (plain text; NULL when none was shared). `activity_id` is a
**soft reference** (no foreign key): activities are soft-deleted and the series lookup
re-checks `deleted_at` at query time, so a removed activity simply stops resolving rather
than cascading a delete. A GIN index over `series_metrics` backs the public series
endpoint's authorization check, and another over `tags` (`TEXT[]`, the post's
[hashtags](#hashtags)) the profile's `?tag=` filter. Each post also holds an unguessable `image_token`
(defaulted at insert) that gates its `followers`-only image URLs. Deleting a
`public`/`unlisted` post hard-deletes its row
and, in the same statement, records its id in `feed_tombstone` so the object id can still
answer `410 Gone`. Followers live in `feed_follower` (keyed by the follower's `actor_uri`,
with a local `id` for the approve/reject API, the cached inbox + handle / display name /
avatar, the id of the `Follow` they sent — echoed in a deferred `Accept`/`Reject` — and an
`accepted` flag that is false while a request is pending); the actors this user **follows**
live in `feed_following` (keyed by a local `id`, with the followee's cached inbox + handle /
display name / avatar, an `accepted` flag, and a nullable `tag` marking the follow of a
[hashtag's tag actor](#hashtags), unique per tag through a partial index); the actor's RSA
keypair in `feed_actor`.
Posts received from followees are stored in `timeline_entry` (keyed by the remote note's
`object_uri` so an `Update`/redelivery replaces in place), holding the **already-sanitised**
content plus the author's cached handle / display name / avatar, indexed on
`(published_at DESC, id DESC)` for the keyset-paginated home timeline. A nullable
`structured` JSONB column carries the native Aurboda payload (`FeedStructuredPost`: an
activity's typed metrics + inline series, or an article's title + resolved blocks) fetched
during enrichment — NULL for non-Aurboda posts. On a
re-delivery whose enrichment failed, the upsert keeps the last-known `structured` rather
than wiping a working chart — unless it is an article, whose stale title and prose would
hide the edited `content`, so it is cleared (the same rule applies to boost cards). A nullable `images` JSONB column holds the delivered
image attachments (`TimelineImage[]`: url + optional media type / alt / size), rendered as
the fallback when a post has no native structured chart. Four nullable columns
(`boost_of_uri`, `boosted_by_actor_uri`, `boosted_by_handle`, `boosted_by_display_name`) turn
a row into a **boost card** — see "Likes and boosts" above; they are NULL on a direct entry.
A `tags` `TEXT[]` column (GIN-indexed) holds the post's hashtags for the `?tag=` filter.
A partial index on `(in_reply_to_uri, published_at, id)` backs the **own-post comments**
listing and the batched per-page `reply_count`, so reading a feed page never scans the whole
timeline. An index on `actor_uri` backs every lookup of a remote actor's cached copy (the
`Update{Person}` refresh and a quoting actor's byline).

Reactions live in two tables, one per direction. `feed_reaction` holds the user's **own**
outbound likes/boosts: a `UNIQUE (kind, object_uri)` row per reacted-to post whose `id` mints
the delivered activity id (and its `#undo`), plus the post author's cached inbox so a
retraction needs no actor re-resolve — the uniqueness is what makes liking idempotent.
`feed_post_reaction` holds **inbound** reactions on the user's own posts, keyed
`(post_id, kind, actor_uri)` so a redelivery refreshes the presentation snapshot rather than
duplicating, with the remote activity's own id (`activity_uri`) so a bare-id `Undo` still
matches, and an index on `(post_id, created_at DESC)`. `post_id` is a **soft reference** like
`activity_id`, so `deleteFeedPost` drops the post's reactions in the same statement.
A `feed_reaction` row goes when its post leaves the timeline altogether (the author's `Delete`,
an unfollow, or an `Undo{Announce}` of the post's last boost card), while a direct entry or
another boost of it keeps the row. `feed_post_reaction` is kept unbounded by design: it is the
record of who reacted to the user's own posts, and goes only with the post or an `Undo`.

`feed_quote_authorization` records each FEP-044f quote approval: one row per remote Note
(`quote_uri`, its author `actor_uri`, the `QuoteRequest` id) allowed to quote one of the user's
public/unlisted posts, `UNIQUE (post_id, quote_uri)` so a redelivered request keeps its row,
and its first actor and request id: a later request for the same quote cannot re-attribute it.
The row's `id` mints the `QuoteAuthorization` stamp URL (`/users/<username>/stamps/<id>`) sent
in the `Accept`; a request for an already approved quote from a different actor is rejected. A stamp
is revoked by dropping its row, after which its URL answers `404`: when the quoting Note's own actor
sends a `Delete` of it, when that actor itself is deleted (every approval it held goes), and when the
post is deleted or narrowed to followers-only. In the last two cases a `Delete` of the stamp is also
sent to the quoting actor and to the author's followers, as Mastodon revokes its own, so other
servers that verified the quote drop it too. `post_id` is a soft reference, so `deleteFeedPost`
drops the post's approvals in the same statement and returns them, and those rows are what the
`Delete`s are sent for.

## Caveats & limitations

These are known and intentional for the current implementation:

- **Visibility downgrade doesn't retract from non-followers.** Narrowing a `public`
  post to `followers` federates an `Update` addressed only to followers; servers that
  showed it to non-followers keep their copy. This is an inherent ActivityPub limitation
  (Mastodon behaves the same) — there is no addressable "public" inbox to retract from.
- **The public series endpoint uses the anchor window for merged shares.** The delivered
  Note's scalar summary and the rendered images cover the full merged span, but
  `GET /public/:username/series` still authorizes only the shared activity's _own_ window
  (`findCoveringSharedSeriesWindow` joins on `activity_id`). The delivered Note's
  `quant:series` links are built over the merged span, so for a **merged** share with
  shared series those links can 404 until series authorization expands across a merge
  group (which needs the merge algorithm at query time — a planned follow-up); QuantPub
  consumers treat a failed series fetch as best-effort, so the post still renders.
- **Reactions are `Like`/`Announce`, plus approved quotes.** Approved quotes are listed beside them
  (see **Quotes** under [Likes and boosts](#likes-and-boosts)). There is no `EmojiReact`
  (Misskey/Akkoma's custom-emoji reactions), and likes/boosts are not listed in the actor's
  `outbox` or on the public profile — they are a private-to-the-owner record plus the delivered
  activity.
- **Remote cards carry no like/boost counts.** Mastodon does not push a post's totals to
  subscribers, so a home-timeline card shows only _your own_ reaction state. Counts appear on
  the owner's own posts, from what was delivered to us.
- **Boosts are not backfilled on follow.** The on-follow backfill reads the followee's outbox
  for their own posts; their earlier boosts don't appear retroactively.
- **You can only reply to a post this instance holds.** A reply targets a home-timeline entry
  by its local id, so a reply that exists only inside a live thread snapshot fetched from a
  remote origin has nothing to address — reply to the card instead. Serving a `replies`
  collection on our own Notes (so other servers can walk our threads) is a follow-up.
- **No reply editing from the web.** The API supports it (`PATCH /feed/:postId` federates an
  `Update` to followers and the answered author), but the web card offers no editor — a reply
  is short enough to delete and repost.
- **Route maps have no privacy trimming.** The route is drawn over an OpenStreetMap
  basemap and shows the full track, so a public route map reveals the precise area
  (including start/end points, i.e. likely home/work); start-point and area masking are
  planned follow-ups. Only share a route publicly when that exposure is acceptable.

## Related

- [Sharing & public pages](./sharing.md) — the shared-dashboard foundation and the
  base-URL identity model this reuses.
- [Challenges](./challenges.md) — cross-instance federated competitions on the same
  `/u/:username` namespace.
- [QuantPub FEP draft](../fep/quantpub.md) (`0.3`; Aurboda implements `0.2`) — the vendor-neutral generalisation of
  this feed's federation pattern (vocabulary + out-of-band structured payloads),
  drafted for the FEP process so other QS tools can interoperate.
