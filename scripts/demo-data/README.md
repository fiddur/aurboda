# Demo data and welcome-page screenshots

`seed.mjs` fills a fresh Aurboda instance with an invented world: Maja and six friends, ten weeks
of steps, sleep, HRV, workouts with heart rate, places, meals and everyday logs (coffee, alcohol,
headache, painkiller, sauna, meditation) with effects baked in for the correlations page, plus
goals, a public shared dashboard, a step challenge about 60% done and a small feed.
`shots.mjs` takes the welcome-page screenshots from it, light and dark.

## Boot a fresh stack

The tryout rig ([`tryouts/AGENTS.md`](../../tryouts/AGENTS.md)) runs the `develop` image with a
throwaway PostGIS:

```sh
export TRYOUT_DIR=$(mktemp -d)
AURBODA_TAG=develop tryouts/up.sh --fresh
```

The seed signs up its own users, so it needs a stack that has never seen them.

## Seed

```sh
DEMO_COMPOSE_PROJECT=aurboda-tryout-cloud node scripts/demo-data/seed.mjs http://127.0.0.1:8080
```

Everything goes through the REST API except the social graph. Users on one instance cannot follow
each other over federation (the lookup refuses loopback hosts), so with `DEMO_COMPOSE_PROJECT` set
the seed writes follows, friends' posts, likes and comments straight into the users' databases
with `docker compose -p <project> exec postgres psql`. Leave it unset and the feed only shows
Maja's own posts. All users share the password `demo-password-2026` (`DEMO_PASSWORD` overrides it).
Data is relative to the current date, so seed on the day you shoot.

## Shoot

```sh
node scripts/demo-data/shots.mjs <out-dir>
node scripts/demo-data/shots.mjs <out-dir> --only correlations,challenge --themes dark
```

It browses the app at `http://localhost:8080` (`--base` changes it), the origin the app builds
its own links for, and needs Playwright with Chromium. Each shot is written as
`<name>-light.png` and `<name>-dark.png` at 1440×900, DPR 2, except `timeline-mobile` (iPhone 13).
The day views show the latest day before today with an evening run and no drinks.

`--web <url>` takes the pages from another origin than the API, for shooting a web build that is
not in the image yet, such as a vite dev server on the working tree:

```sh
VITE_API_URL=http://127.0.0.1:8080/api pnpm --filter aurboda-web exec vite --port 5199
node scripts/demo-data/shots.mjs <out-dir> --web http://localhost:5199
```

`--base` stays the API's origin (it signs in through `<base>/api`).

## Regenerating the welcome page images

The welcome page (`apps/web/src/pages/Home`) shows WebP crops of these shots from
`apps/web/public/screenshots/welcome/`, a light and a dark one of each. After a UI change, shoot
again and rebuild them:

```sh
node scripts/demo-data/shots.mjs /tmp/shots
python3 scripts/demo-data/welcome-assets.py /tmp/shots
```

`welcome-assets.py` (Pillow with WebP) crops each shot to a box in CSS pixels, which cuts away
the sidebar, the footer and the personal correlation presets, scales it to at most 1600 px wide
(600 px for the phone), and writes `<name>-light.webp` and `<name>-dark.webp` at quality 80. Move
a box there when a page's layout moves. If an image's size changes, update its `width` and
`height` in `pages/Home/index.tsx`; the script prints them.
