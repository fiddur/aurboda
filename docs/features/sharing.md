# Sharing & Public Pages

Aurboda lets a user publish read-only **shared dashboards** under their own public
namespace, so other people — anonymous visitors, or users on a different Aurboda
instance — can view a curated set of charts without signing in. This is the first
of the planned social features; the identity foundation it establishes is reused by
later features (e.g. challenges).

## Identity & URLs

Every user already has a stable **username** (e.g. `fiddur`). A user's public
presence is addressed by their full public **base URL**:

- Public profile: `<public-base>/u/<username>` — e.g. `https://aurboda.net/u/fiddur`
- A shared dashboard: `<public-base>/u/<username>/<slug>` — e.g.
  `https://aurboda.net/u/fiddur/a3GVcs14D`
- A shared exercise: `<public-base>/u/<username>/<slug>`, the same namespace (see
  [Shared exercises](#shared-exercises))

The federation key is this full base URL, **not** `username@host`. That means an
instance can be served over http or under a sub-path of another site
(`http://some.thing/with/other/things/u/fiddur`) and the URLs still work. Absolute
URLs are built from the configured public base (`WEB_HOST`), preserving any
sub-path.

## Shared dashboards

A shared dashboard is an **independent, named copy** of a dashboard config (see
[Dashboard](./dashboard.md) for the widget/section model). Creating or editing a
shared dashboard never affects your home dashboard, and you can create any number of
them.

Each shared dashboard has a url-safe random **slug** and a `visibility`:

- **`private`** — yours only. Every public path (the profile listing,
  `GET /public/:username/:slug`, the link-preview HTML, the preview image and oEmbed)
  answers exactly as for a slug that does not exist; you open and edit it at
  `/u/<you>/<slug>` while logged in. New dashboards are private by default.
- **`unlisted`** — not listed anywhere; reachable only by its unguessable slug. Share
  the link with whoever you want; anyone without it cannot discover it.
- **`public`** — listed on your public profile (`/u/<username>`) and reachable by slug.

`visibility` is the **`DashboardVisibility`** vocabulary (`private`/`unlisted`/`public`):
the shared **`ShareVisibility`** words (`public`/`unlisted`) that hosted
[challenges](./challenges.md) use and the [feed](./feed.md) extends with `followers`,
plus `private`. It is stored as two boolean columns, `is_public` and `is_private`
(`is_private` wins), and mapped to/from the vocabulary at the API boundary (backend
`services/visibility.ts`). Rows from before `is_private` existed keep `false`, so they
keep their old visibility.

## What a viewer can see (hard backend security)

A public viewer can only ever receive the exact data the dashboard's own widgets
render — never the owner's broader data API. This is enforced server-side:

1. The public endpoints take **no** data-shaping parameters from the request.
2. For each stored widget, the backend calls the same user-scoped service the
   authenticated dashboard uses, with parameters taken **only** from the saved
   widget config.
3. Each widget resolver returns a **minimal projection** — just the values the
   widget displays (aggregated buckets, averages, trend points). Raw rows with
   notes, titles, or locations are never included.
4. Quick-link widgets are neutralized (their hrefs point into the owner's private
   app and are stripped), and unknown widgets resolve to no data.

So even a crafted request with extra query parameters cannot widen the exposed data
beyond the saved widgets.

Bar-chart buckets (days, weeks, months, hours) follow the **owner's** stored timezone
(`tz` in settings), not the visitor's, so every visitor sees the owner's calendar days.
Without a stored timezone, or with one that is not a valid IANA name, they fall back
to UTC.

A published [period dashboard](./dashboard.md#period-dashboards) shows its **latest
finished period** (last month, last ISO week, last year), bounded in the owner's
timezone, with each figure compared against the period before it. The public page
names the period under the title and has no switcher: the public endpoint takes no
period parameter, so a viewer cannot pick another period. Lock modes (pinning a share
to one period, or letting viewers browse) are planned.

## Shared exercises

A shared exercise publishes the progress on **one exercise**: one item value of one
activity type, such as `sets.exercise` = `Bench Press` of `strength_training` — the
exercise page at `/activity-type/<name>/item/<field>/<value>` (see
[Activity types → Exercises and measures](./activity-types.md)). An item is shared at
most once. It has a slug in the same `/u/<username>/<slug>` namespace as dashboards
and challenges, a display `name` (the value by default), and the same `visibility`
(`unlisted` by default): public exercises are listed on the profile under
**Exercises**.

The public data is resolved on the server from the stored share alone
(`services/shared-exercise-data.ts`), the same boundary as dashboards' widgets. The
viewer gets exactly:

- **records** — per record measure (e1RM, max weight, longest hold, most reps in a
  set), the best value, the start time of the first session that reached it, and the
  set it came from;
- **done** — the number of sessions with the exercise and the first and latest start;
- **per week** and **trend**, drawn as one chart — weekly bars of the trend measure
  (e1RM, else most reps in a set, else longest hold; for an exercise without one, the
  first measure the sessions have, the best or the total of each week as on the exercise
  page) over all time from the first session's day, with the decaying best of the trend
  measure (the 120-day half-life the exercise page uses) drawn over them as a line;
- **history** — every session, newest first: its start time, its sets of the exercise
  (reps, weight, time and set type only), its measures and the records it set.

Never included: session ids, titles, notes, locations, heart rate, calories, the
session's other fields, other exercises of the same sessions, and any other key a set
was logged with. Days and weeks follow the owner's stored timezone. There is no period
selector; the owner's own exercise page keeps one.

On the web, the exercise page's header has a **Publish** button that opens a dialog
first: it says what the page shows, and takes the name (defaults to the exercise) and
the visibility (unlisted by default); nothing is created until it is confirmed. Once
published the header shows **Published** · the visibility · **Open page** · **Copy link**
(and the system share sheet where the browser offers one) · **Unpublish**. Published or
not, the row also has a **Share to feed** arrow button, which opens a dialog: a message,
the three data opt-ins (records and session count, the trend chart, the last 5 sessions'
sets), a **Link the public page** checkbox only when the exercise is published, the
audience, and a live preview of the exact card a follower sees and of the plain text
Mastodon gets. See [feed.md](./feed.md#feed-posts) for what the post carries.
`/dashboards` lists the published exercises under **Exercises** too (rename,
visibility, copy link, unpublish). The public page's header has **Copy link** (and the
system share sheet where the browser offers one); the owner viewing their own published
exercise sees the same read-only page as everyone else, plus a **Manage** link back to
the exercise page.

An exercise can also be posted to your [feed](./feed.md) from its page (**Share to
feed**), whether or not it is shared here: the post carries the progress (records,
trend, optionally the latest sessions) resolved whenever it is read, and links this
public page only when the exercise is published (see the `exercise` post kind in
[feed.md](./feed.md#feed-posts)).

Link previews of a public shared exercise carry its name, "&lt;name&gt; — &lt;user&gt;'s
progress on Aurboda.", a rendered image card and oEmbed, like dashboards and challenges
(see [Link previews](#link-previews-open-graph--twitter-card)); an unlisted one keeps the
static default image and has no oEmbed.

## Using it in the web app

- **Manage** your dashboards at `/dashboards` ("Dashboards" under the **Sharing**
  section in the sidebar, alongside Feed and Challenges, and the **All dashboards**
  link next to the home dashboard's title; `/shared-dashboards` still opens it). The
  home dashboard comes first, then every other one: rename it, set its visibility,
  open it, copy its link (not for a private one), or delete it. Create one from a
  preset — Blank, Copy of home or Month in data (see
  [Dashboard → Dashboards page and presets](./dashboard.md#dashboards-page-and-presets))
  — and it opens at `/u/<you>/<slug>`, private.
- **View** a shared dashboard at `/u/<username>/<slug>` and a profile at
  `/u/<username>`. For anonymous visitors these public pages render without the
  app header/sidebar (but keep the standard site footer) — a clean, standalone
  page — and fetch nothing per widget (they render from the server-resolved
  data). A logged-in viewer keeps their normal app nav on these pages, so they
  can navigate away without the browser back button.
- **Edit in place**: when you are logged in and viewing your _own_ shared
  dashboard (`/u/<you>/<slug>`), an Edit toggle appears and you get the same
  add/remove/move-widget and section controls as the home dashboard (including
  renaming sections inline); changes save to that shared dashboard. (Owners see
  live widget data here, not the read-only snapshot.)
- **Add a chart to a shared dashboard**: the chart page's "Add to dashboard"
  dialog lets you pick the target dashboard (your home dashboard or any shared
  one) and then the section.
- **Update a chart on a shared dashboard**: clicking a chart on a shared
  dashboard you own opens the chart page carrying that widget's origin; tweak it
  and use "Update Chart in _&lt;board&gt;_ / _&lt;section&gt;_" to replace it in place.

## Link previews (Open Graph / Twitter Card)

JS-less crawlers (Facebook, Slack, LinkedIn, Discord, iMessage, Mastodon) never run
the SPA, so a bare `index.html` gives them nothing to preview. To fix this, nginx
proxies the public share routes (`/u/*`) to the backend, which returns the same
`index.html` with a **server-rendered `<head>`**: Open Graph, Twitter Card, and
`description` meta plus schema.org JSON-LD for the resolved resource. Browsers still
get the full SPA and hydrate normally — only the head is enriched.

- **Dashboards**, **challenges** and **shared exercises** get a title (resource name), a
  description, and a canonical URL; profiles get a `profile`-typed card with `ProfilePage` JSON-LD.
  A dashboard's description uses the author-provided text when set (see
  [Dashboard → Descriptive text](./dashboard.md#descriptive-text)), else a generated
  fallback. A challenge's description says what it measures, its dates and where it
  stands, and how many have joined besides the host, who is a member from creation
  ("Steps challenge, 1 Oct – 31 Oct 2026 · Starts in 3 days · Be the first to join.
  Hosted by … on Aurboda — join from any instance."). Once the challenge has ended it
  stops inviting: "… · Ended 31 Oct 2026 · 3 took part. Hosted by … on Aurboda."
- Every public resource has a **dynamically rendered 1200×630 preview image** at
  `<resource-url>/opengraph-image.png`. Satori renders a branded card (title +
  DASHBOARD/CHALLENGE/EXERCISE/PROFILE eyebrow + the owner's avatar + Aurboda wordmark +
  `@owner`, except on the profile card whose title already is the name) to SVG and
  sharp rasterizes it to PNG; fonts are bundled (no system fonts in the image), and
  emoji in titles are drawn from bundled Twemoji SVGs (`@twemoji/svg`), so no system
  emoji font is needed. Renders are memoised in-process and cached
  `public, max-age=3600`.
- A **challenge card** says what the challenge is: the eyebrow names what is measured
  (`CHALLENGE · STEPS`), a line under the title gives the dates and status
  ("1 Oct – 31 Oct 2026 · Starts in 3 days", "Ends tomorrow", "Ended …", in the
  challenge's timezone), and below it the top three members' totals as bars once there
  are numbers (`+N more` beyond that), "N joined" while totals are still being fetched,
  or "Be the first to join" before anyone but the host has, both over "Join from any
  Aurboda instance". An ended challenge without totals says only "N took part" (every
  member, host included) and no join prompt. The gradient and a large faded emoji
  are themed by what is measured (steps, running, cycling, swimming, sleep, heart-rate
  zones, …; a purple trophy otherwise). A **host-set banner** replaces that themed
  background: the banner is drawn full-bleed under a darkening overlay with the same
  text over it, and no emoji motif (see [Challenges](./challenges.md#model)). The memo
  key includes the status phrase, the totals and the banner's version, so a new day, a
  data sync or a new banner re-renders the card.
- An **exercise card** shows progress on a shared exercise over the default purple
  gradient: the eyebrow names the activity type (`EXERCISE · STRENGTH TRAINING`), and
  under the title the headline record as a large value ("39.5 kg", the record of the
  trend's measure, else the first record) over its label and date ("Best e1RM · 21 Dec
  2025") and the session count ("43 sessions since Mar 2025", or "1 session, 4 Nov
  2026"), in the owner's timezone, with the trend drawn as a sparkline beside them.
  Without records the session count stands alone. The memo key includes the newest
  session's start, so a new session re-renders the card.
  Non-public / unknown resources fall back to the branded static default
  (`/og-default.png`).
- **Visibility is respected**: rich meta and rendered images are emitted only for
  **public** resources. Private and unlisted (slug-only) dashboards and unknown URLs get generic
  site meta and the static default image, so an unlisted resource's title/image never
  lands in a crawler's cache or a search index.
- Rich meta is cached `public, max-age=300`; generic fallbacks `max-age=60`.

The backend finds `index.html` via `WEB_INDEX_PATH` (set in the Docker image to the
file nginx serves). In local dev, vite serves `/u/*` directly, so this path is
unset and the server-rendered head is exercised only by its unit tests.

## Avatars

Each user has a public profile avatar, surfaced on the profile page, in shared-page
OG cards, and as the ActivityPub actor `icon` (so Mastodon and friends show it).

- **Storage**: the image lives in the user's own database (`profile_avatar`, a
  singleton row). The deployment has no object store or persistent app-container
  volume — only Postgres persists — so DB storage is the robust choice. Uploads are
  normalized to a square **256×256 WebP** (sharp), stripping metadata.
- **Upload / remove** (authenticated): `POST /profile/avatar` (multipart `avatar`
  field; PNG/JPEG/WebP/GIF) and `DELETE /profile/avatar`.
- **Public read**: `GET /u/:username/avatar.png`. If the user hasn't uploaded one,
  a **deterministic identicon** derived from the username is generated (a font-free
  SVG rasterized by sharp), so an avatar always renders. Served `max-age=3600`.
- **Web UI**: upload/remove from **Settings → Avatar**; the avatar shows on the
  public profile page and next to the author attribution on shared dashboards.

## oEmbed & sharability

- **oEmbed**: public share pages advertise a `<link rel="alternate"
type="application/json+oembed">` pointing at `GET /oembed?url=<share url>`, which
  returns a `type: "link"` document (title, author, provider, OG-image thumbnail).
  Only public resources resolve — unlisted/unknown/private URLs 404, so nothing
  private is exposed. Primarily benefits Mastodon and other oEmbed-aware consumers.
- **Copy link and Share…**: public shared-dashboard and shared-exercise pages have a
  **Copy link** icon button that copies the URL to the clipboard (a prompt with the
  URL where the clipboard is unavailable), plus a **Share…** button that opens the
  system share sheet where `navigator.share` exists (phones; not in the Android
  WebView).
- **`theme-color`** and favicons/apple-touch-icon are set so tabs and mobile share
  sheets look finished.

QR codes and per-share preview overrides are possible future additions.

## API

Owner-facing CRUD (authenticated, scoped to the caller):

| Method & path                     | Purpose                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `GET /shared-dashboards`          | List my shared dashboards                                   |
| `POST /shared-dashboards`         | Create one from a dashboard config or a preset              |
| `GET /shared-dashboards/:id`      | Fetch one (with config)                                     |
| `GET /shared-dashboards/:id/data` | Its resolved widget data (`?period=` on a period dashboard) |
| `PUT /shared-dashboards/:id`      | Update name / config / visibility                           |
| `DELETE /shared-dashboards/:id`   | Delete (its slug stops resolving)                           |
| `GET /shared-exercises`           | List my shared exercises                                    |
| `POST /shared-exercises`          | Share an exercise (409 if shared)                           |
| `GET /shared-exercises/:id`       | Fetch one                                                   |
| `PUT /shared-exercises/:id`       | Update name / visibility                                    |
| `DELETE /shared-exercises/:id`    | Stop sharing (its slug stops)                               |

`POST /shared-dashboards` takes `name`, exactly one of `config` and `preset`
(`blank`, `home` — a copy of the home dashboard — or `month_in_data`), and
optionally `visibility` (`private` by default). `PUT` takes any of `name`, `config`
and `visibility`.

`POST /shared-exercises` takes `activity_type`, `field` (a categorical list-item path
of the type, e.g. `sets.exercise`; a session-level field or any other path answers 400),
`value`, and optionally `name` and `visibility`.

Public (unauthenticated):

| Method & path                      | Purpose                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `GET /public/:username/dashboards` | List a user's **public** shared dashboards, challenges, exercises |
| `GET /public/:username/:slug`      | View one shared dashboard, challenge or exercise                  |

`GET /public/:username/:slug` resolves a slug as a dashboard (never a private one),
then a challenge, then a shared exercise; an exercise answers `type: 'exercise'` with `name`,
`activity_type`, `activity_type_name`, `value`, `profile_url`, `share_url` and `data`
(the projection above). A dashboard answers `type: 'dashboard'` with `name`, the
sanitized `config`, `profile_url`, `share_url` and `widget_data`; a period dashboard
also carries `period` (the key, e.g. `2026-10`) and `window` (`start` and exclusive
`end`, ISO) of the period it shows.

The same CRUD capability is available over MCP as `list_shared_dashboards`,
`create_shared_dashboard` (with `config` or `preset`), `update_shared_dashboard`, and `delete_shared_dashboard`
(and `get_dashboard_data` for the resolved widget data),
and for exercises `list_shared_exercises`, `get_shared_exercise`,
`create_shared_exercise`, `update_shared_exercise` and `delete_shared_exercise`. Public viewing is web-only.

## Storage

Shared dashboards live in the user's own database (the config is the user's data) in
the `shared_dashboards` table, with `is_public` and `is_private` booleans for the
visibility (`is_private` was added later, `NOT NULL DEFAULT false`). Every public
read goes through `getPublicSharedDashboardBySlug` / `listPublicSharedDashboards`,
which leave private rows out. The `slug` is unique per database; the `username` in
the URL disambiguates globally, so no central slug index is needed. Deleting a
shared dashboard immediately makes its slug return 404. Shared exercises are in
`shared_exercises` (`activity_type`, `field`, `value`, unique together). A new
dashboard's, challenge's or exercise's slug is checked free against all three tables,
since they share one namespace. Merging an item value (see
[Activity types](./activity-types.md)) moves the shares of the merged-away value to the
target, keeping their name and slug; if the target is already shared, the source's share
is dropped. `activity_type`
references `activity_type_definitions` with cascading update and delete, so renaming
a custom type carries its shares along and deleting the type removes them.

## Related

[Challenges](./challenges.md) build on this foundation (same `/u/:username/:slug`
namespace, base-URL identity, capability tokens) and add real cross-instance
federation. The [activity feed](./feed.md) reuses the same identity to publish
individual activities with a per-post, privacy-conservative metric selection.

## Forward-compatibility

Resolved widget data is keyed by each widget's stable `id`, and the public response
carries every widget's `id` and `type`. This keeps a future per-chart endpoint
(`/u/<username>/<slug>/<widgetId>`) and embedding another user's single shared chart
into your own dashboard a small addition rather than a refactor.
