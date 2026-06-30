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

## API

Owner-facing CRUD (authenticated, scoped to the caller):

| Method & path                 | Purpose                          |
| ----------------------------- | -------------------------------- |
| `GET /shared-dashboards`      | List my shared dashboards        |
| `POST /shared-dashboards`     | Create one from a dashboard config |
| `GET /shared-dashboards/:id`  | Fetch one (with config)          |
| `PUT /shared-dashboards/:id`  | Update name / config / visibility |
| `DELETE /shared-dashboards/:id` | Delete (its slug stops resolving) |

Public (unauthenticated):

| Method & path                          | Purpose                                   |
| -------------------------------------- | ----------------------------------------- |
| `GET /public/:username/dashboards`     | List a user's **public** shared dashboards |
| `GET /public/:username/:slug`          | View one shared dashboard + resolved data |

The same CRUD capability is available over MCP as `list_shared_dashboard`,
`create_shared_dashboard`, `update_shared_dashboard`, and `delete_shared_dashboard`.
Public viewing is web-only.

## Storage

Shared dashboards live in the user's own database (the config is the user's data) in
the `shared_dashboards` table. The `slug` is unique per database; the `username` in
the URL disambiguates globally, so no central slug index is needed. Deleting a
shared dashboard immediately makes its slug return 404.

## Forward-compatibility

Resolved widget data is keyed by each widget's stable `id`, and the public response
carries every widget's `id` and `type`. This keeps a future per-chart endpoint
(`/u/<username>/<slug>/<widgetId>`) and embedding another user's single shared chart
into your own dashboard a small addition rather than a refactor.
