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

Each shared dashboard has a url-safe random **slug** and a visibility:

- **Public** — listed on your public profile (`/u/<username>`) and reachable by slug.
- **Unlisted** — not listed anywhere; reachable only by its unguessable slug. Share
  the link with whoever you want; anyone without it cannot discover it.

Visibility only governs the profile listing. Both public and unlisted shares are
served by their slug.

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

## Using it in the web app

- **Manage** your shared dashboards at `/shared-dashboards` (the "Share" item in
  the sidebar): create a copy from your current home dashboard (or a blank one),
  rename it, toggle public/unlisted, copy its link, or delete it.
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
  fallback.
- Every public resource has a **dynamically rendered 1200×630 preview image** at
  `<resource-url>/opengraph-image.png`. Satori renders a branded card (title +
  DASHBOARD/CHALLENGE/PROFILE eyebrow + the owner's avatar + Aurboda wordmark) to
  SVG and sharp rasterizes it to PNG; fonts are bundled (no system fonts in the
  image). Renders are memoised in-process and cached `public, max-age=3600`.
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

Public (unauthenticated):

| Method & path                      | Purpose                                    |
| ---------------------------------- | ------------------------------------------ |
| `GET /public/:username/dashboards` | List a user's **public** shared dashboards |
| `GET /public/:username/:slug`      | View one shared dashboard + resolved data  |

The same CRUD capability is available over MCP as `list_shared_dashboards`,
`create_shared_dashboard`, `update_shared_dashboard`, and `delete_shared_dashboard`.
Public viewing is web-only.

## Storage

Shared dashboards live in the user's own database (the config is the user's data) in
the `shared_dashboards` table. The `slug` is unique per database; the `username` in
the URL disambiguates globally, so no central slug index is needed. Deleting a
shared dashboard immediately makes its slug return 404.

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
