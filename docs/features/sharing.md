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

- **`public`** — listed on your public profile (`/u/<username>`) and reachable by slug.
- **`unlisted`** — not listed anywhere; reachable only by its unguessable slug. Share
  the link with whoever you want; anyone without it cannot discover it.

Visibility only governs the profile listing. Both public and unlisted shares are
served by their slug.

`visibility` is the shared **`ShareVisibility`** vocabulary (`public`/`unlisted`)
used across the API, MCP tools, and web UI — the same words hosted
[challenges](./challenges.md) use, and the base the [feed](./feed.md) extends with
a `followers` audience. It is stored as an `is_public` boolean column and mapped
to/from the vocabulary at the API boundary (backend `services/visibility.ts`), so
storage stays a boolean while the surface is consistent.

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
- **trend** — the decaying best of e1RM (else most reps in a set, else longest hold)
  over all time, with the 120-day half-life the exercise page uses;
- **per week** — e1RM (else the first measure the sessions have) per week over the
  last 365 days, the best or the total of each week as on the exercise page;
- **history** — every session, newest first: its start time, its sets of the exercise
  (reps, weight, time and set type only), its measures and the records it set.

Never included: session ids, titles, notes, locations, heart rate, calories, the
session's other fields, other exercises of the same sessions, and any other key a set
was logged with. Days and weeks follow the owner's stored timezone. There is no period
selector; the owner's own exercise page keeps one.

On the web, the exercise page's header has a **Share** button; once shared it shows
the link, the visibility and **Stop sharing**. `/shared-dashboards` lists the shared
exercises under **Exercises** too (rename, visibility, copy link, delete). The owner
viewing their own shared exercise sees the same read-only page as everyone else.

Link previews of a public shared exercise carry its name, "&lt;name&gt; — &lt;user&gt;'s
progress on Aurboda." and the static default image; there is no rendered image card and
no oEmbed for exercises yet.

## Using it in the web app

- **Manage** your shared dashboards at `/shared-dashboards` ("Dashboards" under the
  **Sharing** section in the sidebar, alongside Feed and Challenges): create a copy
  from your current home dashboard (or a blank one), rename it, set its visibility,
  copy its link, or delete it.
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

- **Dashboards** and **challenges** get a title (resource name), a description, and
  a canonical URL; profiles get a `profile`-typed card with `ProfilePage` JSON-LD.
  A dashboard's description uses the author-provided text when set (see
  [Dashboard → Descriptive text](./dashboard.md#descriptive-text)), else a generated
  fallback. A challenge's description says what it measures, its dates and where it
  stands, and how many have joined besides the host, who is a member from creation
  ("Steps challenge, 1 Oct – 31 Oct 2026 · Starts in 3 days · Be the first to join.
  Hosted by … on Aurboda — join from any instance."). Once the challenge has ended it
  stops inviting: "… · Ended 31 Oct 2026 · 3 took part. Hosted by … on Aurboda."
- Every public resource has a **dynamically rendered 1200×630 preview image** at
  `<resource-url>/opengraph-image.png`. Satori renders a branded card (title +
  DASHBOARD/CHALLENGE/PROFILE eyebrow + the owner's avatar + Aurboda wordmark +
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
  Non-public / unknown resources fall back to the branded static default
  (`/og-default.png`).
- **Visibility is respected**: rich meta and rendered images are emitted only for
  **public** resources. Unlisted (slug-only) dashboards and unknown URLs get generic
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
- **Share button**: public profile and shared-dashboard pages have a Share control
  that uses the native share sheet (`navigator.share`) where available and otherwise
  copies the link to the clipboard.
- **`theme-color`** and favicons/apple-touch-icon are set so tabs and mobile share
  sheets look finished.

QR codes and per-share preview overrides are possible future additions.

## API

Owner-facing CRUD (authenticated, scoped to the caller):

| Method & path                   | Purpose                            |
| ------------------------------- | ---------------------------------- |
| `GET /shared-dashboards`        | List my shared dashboards          |
| `POST /shared-dashboards`       | Create one from a dashboard config |
| `GET /shared-dashboards/:id`    | Fetch one (with config)            |
| `PUT /shared-dashboards/:id`    | Update name / config / visibility  |
| `DELETE /shared-dashboards/:id` | Delete (its slug stops resolving)  |
| `GET /shared-exercises`         | List my shared exercises           |
| `POST /shared-exercises`        | Share an exercise (409 if shared)  |
| `GET /shared-exercises/:id`     | Fetch one                          |
| `PUT /shared-exercises/:id`     | Update name / visibility           |
| `DELETE /shared-exercises/:id`  | Stop sharing (its slug stops)      |

`POST /shared-exercises` takes `activity_type`, `field` (the item path, e.g.
`sets.exercise`), `value`, and optionally `name` and `visibility`.

Public (unauthenticated):

| Method & path                      | Purpose                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `GET /public/:username/dashboards` | List a user's **public** shared dashboards, challenges, exercises |
| `GET /public/:username/:slug`      | View one shared dashboard, challenge or exercise                  |

`GET /public/:username/:slug` resolves a slug as a dashboard, then a challenge, then
a shared exercise; an exercise answers `type: 'exercise'` with `name`,
`activity_type`, `activity_type_name`, `value`, `profile_url`, `share_url` and `data`
(the projection above).

The same CRUD capability is available over MCP as `list_shared_dashboards`,
`create_shared_dashboard`, `update_shared_dashboard`, and `delete_shared_dashboard`,
and for exercises `list_shared_exercises`, `create_shared_exercise`,
`update_shared_exercise` and `delete_shared_exercise`. Public viewing is web-only.

## Storage

Shared dashboards live in the user's own database (the config is the user's data) in
the `shared_dashboards` table. The `slug` is unique per database; the `username` in
the URL disambiguates globally, so no central slug index is needed. Deleting a
shared dashboard immediately makes its slug return 404. Shared exercises are in
`shared_exercises` (`activity_type`, `field`, `value`, unique together), and a new
one's slug is checked free against dashboards and challenges. `activity_type`
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
