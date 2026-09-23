# Tryouts

A **tryout** happens after a pull request merges to `develop`: boot the image CI just built from
that merge commit, exercise the behaviour the PR promised, and file an issue for anything
surprising. It is not a second test suite and not a second review — CI gates the tests and a
routine reads the diff. This folder is the **rig** and the **method** for checking one merged PR
against a copy that is really running.

The rule the whole thing serves is that **a claim is only verified if it was executed**, pointed
at the running app rather than at the suite.

[← back to the repository brief](../AGENTS.md)

## The rig

Everything runs **the image, not the source**. CI tags every merge to `develop` as
`fiddur/aurboda:<7-char sha>` (and moves `:develop`), the tryout pulls that exact tag, and a
throwaway `postgis/postgis:16-3.4-alpine` sits behind it. Exercising what deploys is the point:
the image is the only place where nginx, the entrypoint and the built web bundle exist together.
Building the image here is out of scope — if the tag is not on Docker Hub, the tryout waits or
stops.

| Script                 | What it does                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup-environment.sh` | Installs fonts, puppeteer and its matched Chrome under `$TRYOUT_HOME` (default `/opt/tryout`) and records the binary in `chrome-path`. Idempotent — a fast no-op once done. Needs root or `sudo`. |
| `up.sh`                | Starts the Docker daemon if it is down, pulls `fiddur/aurboda:$AURBODA_TAG`, brings the stack up, waits for `/api/version`, signs the demo user in.                                               |
| `down.sh [--purge]`    | `docker compose down`. `--purge` also drops the database volume and deletes `$TRYOUT_DIR`.                                                                                                        |
| `login.mjs`            | Signs the demo user in again and rewrites `token.txt`. Run it when an `/api/*` call starts answering 401.                                                                                         |
| `lib/browser.mjs`      | `launchBrowser`, `signedInPage`, `readState` and `bearer` for puppeteer scripts.                                                                                                                  |

`up.sh` takes two flags:

- `--fresh` — `docker compose down -v` first, so the stack comes up on an empty database with
  new secrets. **A tryout should almost always use it**: leftovers from a previous PR's fixtures
  are how a tryout convinces itself of something that is not true.
- `--wait-image` — poll `docker manifest inspect` for the tag every 20 s for up to 30 minutes,
  because the merge usually lands before CI has pushed the image.

Knobs, all by environment: `AURBODA_TAG` (**required** — the merge commit's short sha, or
`develop`), `TRYOUT_DIR` (default `/tmp/tryout`), `TRYOUT_PORT` (default `8080`), `TRYOUT_HOME`
(default `/opt/tryout`), `TRYOUT_CHROME` (a browser to use instead of the installed one),
`DEMO_USER` (default `qsreddit_demo` — the recipes assume that name).

```sh
AURBODA_TAG=1a2b3c4 tryouts/up.sh --fresh --wait-image
```

**Node.** Every script here runs on the VM's stock Node (≥ 20) with no dependencies — `fetch`,
`node:crypto`, `node:fs` and nothing else — and puppeteer resolves out of `$TRYOUT_HOME`. That
is deliberate: `.claude/hooks/session-start.sh` installs Node 25 but then **fails** on
`pnpm install`, because `@flow-js/garmin-connect` is a `github:` dependency the session's proxy
answers 403 for (see [Running in the cloud](../AGENTS.md#running-in-the-cloud)). A tryout never
needs `node_modules`, so that failure does not block it.

**Docker.** The VM has `dockerd` installed but usually not running; `up.sh` starts it. `docker
ps` is the check. The rig itself reaches `registry-1.docker.io`, `auth.docker.io` and
`production.cloudflare.docker.com`; without those there is no image and no tryout.

### What lands in `$TRYOUT_DIR`

| Path                 | What it is                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `state.json`         | `{ baseUrl, port, tag, buildSha, username, password, token, isAdmin, pgPassword, sessionSecret }` |
| `token.txt`          | The bare bearer token, for `curl`                                                                 |
| `version.json`       | What `/api/version` answered on boot — `build_sha` should be the merge commit                     |
| `run/`, `run/shots/` | Yours: scripts, fixtures, screenshots                                                             |

`state.baseUrl` is `http://127.0.0.1:<port>` — an IPv4 literal, so nothing depends on how
`localhost` resolves. The app's **own** origin, which actor ids and own-post URIs are built from,
is `http://localhost:<port>` (`WEB_HOST`). Browse the app at `http://localhost:<port>` whenever
the page's idea of its own origin matters, and `curl` whichever you like.

**Write your own scripts in `$TRYOUT_DIR/run`, never in the repository.** The one exception is an
in-container probe, which has to live under `/app/apps/backend/src/` for its imports to resolve —
that is inside the container, not the checkout. Either way a tryout leaves `git status` exactly as
it found it.

`pgPassword`, `sessionSecret` and the demo user's `password` are generated per boot and live only
in `state.json` (mode 600). Do not paste any of them into an issue, a PR comment or a script.

## Auth

Bearer token, everywhere.

```sh
BASE=http://127.0.0.1:${TRYOUT_PORT:-8080}
curl -s -H "Authorization: Bearer $(cat "$TRYOUT_DIR/token.txt")" "$BASE/api/user/settings" | jq .
```

The demo user is the instance's **first** user, and `POST /api/signup` makes the first user an
admin (`auth-routes.ts`), so `/api/admin/*` is reachable. `isAdmin` in `state.json` says so
rather than you assuming it.

When a journey is supposed to start **unprivileged** — a second participant in a challenge, a
follower, a peer to federate with — make another user through the app's own API rather than
reusing the demo admin. One curl is enough, and the answer carries the token:

```sh
curl -s -X POST "$BASE/api/signup" -H 'content-type: application/json' \
  -d '{"username":"pr1234_rival","password":"…"}' | jq .
```

Usernames must match `^[a-z][a-z0-9_]{2,30}$` and avoid the reserved list in `auth-routes.ts`.

A 401 out of nowhere means the token expired or the database was replaced: `node tryouts/login.mjs`.

**There is no MCP server against this stack, and that is on purpose.** A routine's connectors are
claude.ai connectors, and the only Aurboda one there is `https://aurboda.net/mcp` — **production**.
It must never be attached to this routine. Everything goes over REST with the bearer token; the
repository's own [API and MCP Parity](../AGENTS.md#api-and-mcp-parity) rule means every MCP tool
has a REST twin, so nothing is out of reach. Where `recipes.md` names an MCP tool, read it as "the
REST endpoint behind it" and find the route in `apps/backend/src/routes/`.

## Databases

Each user gets their own Postgres database, `aurboda_<username>`; the instance-wide one is
`aurboda` (admins, signup mode, pg-boss queues and schedules). Reach them through the compose
project — **address it by project name, not by file**, so the commands work from any directory
and need none of the environment the file interpolates:

```sh
docker compose -p aurboda-tryout-cloud exec -T postgres \
  psql -U aurboda_service -d aurboda_qsreddit_demo -Atc "select count(*) from feed_posts"
```

`-f tryouts/docker-compose.yml` is only for `up`/`down`/`pull`, which the scripts do. Everything
else — `exec`, `logs`, `cp`, `ps`, `restart` — takes `-p aurboda-tryout-cloud`.

`aurboda_service` is a superuser over the local socket, so no password is needed inside the
container. Seeding fixtures with SQL is far faster than hundreds of API calls, and for several of
the recipes below it is the only way to reach a code path at all.

**A new table or column may be absent until something touches it.** Schema changes are applied
per user database, lazily on first access and by a sweep at boot; `\d` right after boot can show
the old shape. Hit one API endpoint first, then look. See the schema entries in `recipes.md`.

## How to verify

1. Read what the PR claims. The title and body are the promise; the diff is what was done. Where
   they disagree, the diff wins and the gap is itself a finding.
2. Boot the rig with `--fresh`, then seed whatever state the behaviour needs. A fresh database has
   one user and no data, so nearly every check starts with seeding — through the API where there
   is an endpoint, through `psql` where there is not.
3. Back-end or data change: `curl` with the bearer token, assert with `jq`.
4. UI change: write a puppeteer script in `$TRYOUT_DIR/run`, exercise the feature, screenshot to
   `run/shots/`, print a JSON summary — and then **Read the screenshots back**. The vision pass
   catches overlap, clipping and dark-mode breakage no text assertion will.
5. [`recipes.md`](./recipes.md) has the accumulated selectors, API shapes, fixtures, oracles and
   traps, grouped by area. Read the section for the area the PR touches **before** writing the
   script; most of what costs an hour is already in there.

**Verification holds only if all three of these do:**

1. You can name the specific behaviour the PR body promised.
2. You executed an API call or a browser interaction that exercises **that** behaviour.
3. You can quote the response or describe the screenshot that shows it happened.

"200 OK" and "the page rendered" are neither. If you cannot get all three, try another approach
before declaring anything.

## What replaces the old mechanics

The recipes were learned against a compose stack called `aurboda-tryout` on one machine, driven
by a webhook service with an MCP connection and a shell that could reach the host. The rig is the
same shape, so almost everything carries over; the mechanics translate like this.

| Then                                                     | Now                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker exec aurboda-tryout-aurboda-1 …`                 | `docker compose -p aurboda-tryout-cloud exec aurboda …`                                                                                                                                                                                                                                                                                                                                                                                |
| `docker exec aurboda-tryout-postgres-1 psql …`           | `docker compose -p aurboda-tryout-cloud exec -T postgres psql …`                                                                                                                                                                                                                                                                                                                                                                       |
| `docker cp x.ts aurboda-tryout-aurboda-1:/app/…`         | `docker compose -p aurboda-tryout-cloud cp x.ts aurboda:/app/apps/backend/src/_probe.ts`                                                                                                                                                                                                                                                                                                                                               |
| `docker logs aurboda-tryout-aurboda-1`                   | `docker compose -p aurboda-tryout-cloud logs aurboda`                                                                                                                                                                                                                                                                                                                                                                                  |
| `docker restart aurboda-tryout-aurboda-1`                | `docker compose -p aurboda-tryout-cloud restart aurboda`                                                                                                                                                                                                                                                                                                                                                                               |
| `localhost:8080`                                         | `127.0.0.1:$TRYOUT_PORT` (still `8080` by default, and still `localhost:8080` **inside** the container's own idea of itself — `WEB_HOST` says so)                                                                                                                                                                                                                                                                                      |
| `mcp__aurboda__<tool>`                                   | Its REST twin. `apps/backend/src/mcp/` names the service each tool calls; `apps/backend/src/routes/` has the route that calls the same one                                                                                                                                                                                                                                                                                             |
| A sink at the compose gateway `172.28.0.1:<port>`        | A node listener on the host at `<port>`, addressed from the container as `http://host.docker.internal:<port>/…` (the compose file maps it). It resolves to the **default bridge** gateway (`172.17.0.1`), not this project's network gateway, so bind the listener to `0.0.0.0`. This project's gateway, if you need it by number: `docker network inspect aurboda-tryout-cloud_default --format '{{(index .IPAM.Config 0).Gateway}}'` |
| A second peer container on a TEST-NET-3 docker network   | The same, against this project's network: `docker network create` plus `docker network connect <net> aurboda-tryout-cloud-aurboda-1` **(untested here)**                                                                                                                                                                                                                                                                               |
| `gh gist create` for a public https AS2 fixture          | No `gh` in the cloud. The GitHub MCP tools have no gist surface either, so a public-https fixture host has to come from somewhere else **(unsolved — say so rather than pretending the fixture worked)**                                                                                                                                                                                                                               |
| `dangerouslyDisableSandbox` for localhost curls          | Nothing. There is no Bash sandbox in a cloud session; localhost just works                                                                                                                                                                                                                                                                                                                                                             |
| `puppeteer-core` symlinked in from a path on one machine | `import { launchBrowser } from './tryouts/lib/browser.mjs'`                                                                                                                                                                                                                                                                                                                                                                            |
| Reading web sources from another clone of the repo       | The checkout is right here: `apps/web/src/…` at the merge commit                                                                                                                                                                                                                                                                                                                                                                       |

Two things that were true of the old rig and are **not** true here: it ran the app **without
nginx on :8080** in some eras and with nginx in others — this one always has nginx, so
`proxy_set_header Host $host` and its port-stripping apply (that is the whole of the inbound-401
story in `recipes.md`). And it set no `API_BASE_URL`, so self-referential hrefs came out on
`http://localhost:3000`; this compose sets `API_BASE_URL=http://localhost:$TRYOUT_PORT/api`,
matching production.

## Filing what you find

One issue per distinct finding, labelled `tryout-finding`. **Search the open `tryout-finding`
issues first** — and the PR's own review follow-up issue, if it has one — so a known finding is
not filed twice.

```
Title: <short summary>

Followup from #<pr>.

## Problem
<what you observed, with the evidence quoted — response body, log line, or a described screenshot>

## Suggestion
<what should change>

## Repro
<the commands or steps, against a rig booted with AURBODA_TAG=<sha> tryouts/up.sh --fresh>
```

In the cloud there is no `gh`: the GitHub MCP tools are the whole interface (`issue_write` with
method `create`; their schemas load through `ToolSearch`). **Never install `gh`.**

If everything works as promised, file nothing. A tryout that finds nothing is a good tryout.

## What this rig cannot do

Say so plainly when you hit one of these. "Not drivable here" is a result; silently skipping is
not.

- **Real provider accounts.** Garmin, Strava, Oura, RescueTime, Gravl, Last.fm and Google
  Calendar all need credentials the rig does not have. The way in is an in-container probe that
  calls the real sync code with a fake HTTP adapter — `recipes.md` → _Sync and integrations_.
- **Android.** There is no Android SDK in the cloud, and CI's Android job is the check on
  `apps/android`. Pure-JVM Kotlin (the widget model, the notifier predicate) can still be
  compiled and run against live API JSON if a JDK and the Kotlin compiler jars are present; in
  this environment they are not, unless installed. Mark those entries as not run.
- **A public-https fixture host.** Several federation recipes need an AS2 document Fedify will
  dereference, which rules out `localhost` and private ranges (its loader refuses them, TEST-NET-3
  included). The old rig used gists. There is no gist tool here.
- **Anything needing a host outside the environment's network allowlist.** The rig itself needs
  `hub.docker.com`, `registry-1.docker.io`, `auth.docker.io` and
  `production.cloudflare.docker.com`; `storage.googleapis.com` and the apt mirrors are for
  `setup-environment.sh`.
- **More than one browser at a time.** Close each one as soon as its check is done.

## Keeping the recipes alive

[`recipes.md`](./recipes.md) is the reason a tryout costs an hour instead of a day, and it only
stays that way if it grows. A tryout cannot push to `develop`, so when a run learns a technique
worth keeping — a selector, an oracle, a fixture, a trap that cost time — open an issue titled
`tryout recipe: <the technique>` labelled `documentation`, with the recipe written out the way it
would read in the file. Somebody folds it in with the next change.
