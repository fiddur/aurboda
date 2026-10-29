# The tryout routines

Two routines share this rig: the **post-merge tryout** (one merged PR to `develop`, below) and
the **release tryout** (a `develop → main` release PR, [further down](#the-release-tryout-routine)).

## The post-merge tryout routine

A tryout used to run on a webhook service on Fredrik's machine: it watched for merges, pulled the
freshly built Docker image onto that box, and started a local agent with an MCP connection to the
container. It runs instead as a **Claude Code routine** — a cloud session fired by a GitHub
trigger, which boots the same image with the scripts in this folder.

This file is what to type into the routine's settings, and the instructions to paste into it.

**Both halves have run in the cloud.** Fix what a run shows and correct this file in the same PR.

[← back to the tryout brief](./AGENTS.md)

### Trigger

| Field      | Value                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Source     | GitHub                                                                                                                               |
| Repository | `fiddur/aurboda`                                                                                                                     |
| Event      | `pull_request`, action **closed** (or "All PR events" if the form offers no per-action choice — the instructions re-check it anyway) |
| Filter     | Is merged = **true**                                                                                                                 |
| Filter     | Base branch **equals** `develop`                                                                                                     |
| Connectors | **GitHub only.** Never the Aurboda connector: the only one on claude.ai is `https://aurboda.net/mcp`, which is **production**        |

### Environment

- **Setup script**: the contents of [`setup-environment.sh`](./setup-environment.sh). It is
  optional — the instructions run it again at the start of every tryout, where it is a fast no-op
  — but putting it here caches the ~200 MB browser install into the environment image instead of
  paying for it on every merge. This environment's setup script is the **one exception** to the
  rule in the root `AGENTS.md` that the field stays empty, and it is an exception for the browser,
  not for the toolchain: `.claude/hooks/session-start.sh` is checked in and needs no pasting.
- **Docker is required**, and it is what makes this environment different from the reviewer's. The
  VM has `dockerd` installed but not running; `up.sh` starts it (with `sudo` when it is not root).
  Without a daemon there is no tryout at all.
- **Node.** Nothing in `tryouts/` needs the Node 26 or the `node_modules` the session-start
  hook installs. The scripts run on the stock Node; puppeteer resolves from `/opt/tryout`.
- **Network.** The rig pulls images, so it needs `registry-1.docker.io`, `auth.docker.io`,
  `production.cloudflare.docker.com` and `hub.docker.com`. `setup-environment.sh` needs
  `registry.npmjs.org`, **`storage.googleapis.com`** (where `puppeteer browsers install chrome`
  downloads from) and the Ubuntu apt mirrors. `nodejs.org` is for the session-start hook. If the
  _Trusted_ level refuses any of them, switch to a custom allowlist that adds them.

### Instructions

Paste this into the routine's instructions field.

```
You are running a post-merge tryout of aurboda. A pull request has just merged to `develop`; your
job is to prove by execution that the behaviour it promised actually happens in a running copy of
the image CI built from that merge, and to file an issue for anything surprising.

There is no `gh` in this environment and no GraphQL. GitHub is the GitHub MCP tools, the
`mcp__github__*` set; their schemas load through ToolSearch when only their names are listed.
Never install `gh`. Never commit, never push, never open a pull request.

There is no MCP server pointed at the rig, and you must not attach one: the only Aurboda connector
on claude.ai is https://aurboda.net/mcp, which is PRODUCTION. Everything goes over REST with the
bearer token the rig writes.

1. Find the pull request number from the event that started this session.
2. `pull_request_read` with method `get`. If it is not merged, or its base is not `develop`, stop
   and do nothing.
3. Read the title, the body and the diff (`get_diff`, or `get_files` when the diff is large). If
   the change touches only markdown and documentation, `.github/`, `tryouts/` itself, or only
   `apps/android`, stop without filing anything and without commenting — say in one line that
   there is nothing to run here. (Those paths also build no image:
   `.github/workflows/docker.yml` only fires on apps/backend, apps/web, packages, pnpm-lock.yaml,
   Dockerfile, nginx.conf and entrypoint.sh.)
4. Check out the merged tree, for reading the diff and the recipes at the merged version:
   git fetch origin develop && git checkout --detach <merge_commit_sha>
   SHORT_SHA is the first 7 characters of that merge sha.
5. `docker ps`. If there is no daemon, `up.sh` starts one; the repository's tryouts/AGENTS.md says
   how, and a failure there is a stop, not something to work around.
6. `tryouts/setup-environment.sh` (a fast no-op if the environment already has the browser), then
   AURBODA_TAG=$SHORT_SHA tryouts/up.sh --fresh --wait-image
   The image is pushed by CI after the merge, so --wait-image polls for up to 30 minutes. If the
   image never appears, or the stack will not boot after two attempts, comment on the pull request
   with the tail of `docker compose -p aurboda-tryout-cloud logs` and stop. Do not spend the
   session fighting the rig.
7. Read `tryouts/AGENTS.md` and follow it. Consult `tryouts/recipes.md` for the area the pull
   request touches before writing any script — the routes, selectors, fixtures, oracles and traps
   are already in there.

Verification holds only if all three hold: you can name the specific behaviour the PR body
promised; you executed an API call or a browser interaction that exercises that behaviour; you can
quote the response or describe the screenshot showing it happened. "200 OK" and "the page
rendered" are neither.

File findings as issues exactly as `tryouts/AGENTS.md` describes — one issue per distinct finding,
label `tryout-finding`, and search the open `tryout-finding` issues (and the PR's own review
follow-up issue, if it has one) first so a known one is not filed twice. If nothing is surprising,
file nothing.

Finish by posting ONE comment on the merged pull request with `add_issue_comment`:
- what you verified, with the evidence quoted,
- what you could not drive and why (a provider credential, Android, a public-https fixture host,
  anything out of reach),
- links to any issues you filed.
That comment is the only artifact of this session a human will ever see, so write it for somebody
who was not here.

Then `tryouts/down.sh --purge`, and stop. Never commit, push, or open a pull request.
```

### What this does not cover

The deployment itself. The image the tryout boots is the `develop` build; `aurboda.net` only picks
up `:latest` when the release merges (see the release tryout routine below), and nothing here
touches production data — the production MCP connector stays off this routine on purpose.

## The release tryout routine

A release is a `develop → main` pull request (`scripts/release-pr.sh`, see `docs/docker.md`
"Cutting a release"). Merging it is what production takes, so the release is tried out **before**
the merge, as a whole, on the image CI already built for the PR's head (the develop tip is
`fiddur/aurboda:<sha7>`), and in two legs: a fresh database, and an upgrade of the previous
release's database. The routine posts a gate review; a human merges, on an instruction that
names the PR.

The same environment and scripts as above. A second routine rather than a branch in the first
one's instructions, so the two triggers stay simple.

### Trigger

| Field      | Value                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Source     | GitHub                                                                                                             |
| Repository | `fiddur/aurboda`                                                                                                   |
| Event      | `pull_request`, action **labeled** (or "All PR events" if the form offers no per-action choice — the instructions re-check it) |
| Filter     | Base branch **equals** `main`                                                                                      |
| Filter     | Label **equals** `release-tryout` (where the form has it; otherwise the instructions check)                       |
| Connectors | **GitHub only.** Never the Aurboda connector (`https://aurboda.net/mcp` is production)                             |

The routine exists: https://claude.ai/code/routines/trig_01MiwiS3ui9VnNaHhaesjsvw (environment
"Aurboda", repository source, the instructions below, no connectors). It was created over the
API, which attaches the GitHub event source for `pull_request` on `fiddur/aurboda` but accepts no
filters, so it is **disabled** until these are set in the routine's settings on claude.ai: the
base-branch and label filters from the table, and the GitHub connector the post-merge routine
uses (copy its connector setup; nothing else — the API had auto-attached every connector on the
account, the production Aurboda one included, and they were all removed). Then enable it.

`scripts/release-pr.sh` puts the `release-tryout` label on when it opens the PR and again on
every refresh, so a moved head is re-tried. The label protocol mirrors the review routine's but
with its own ownership marker, so the two runs can never strip each other's: `release-tryout` →
`release-trying` while the run owns the PR → neither when done. A PR with `release-tryout` still
on after forty minutes means the routine never fired; `release-trying` for longer than two hours
means it died mid-run.

### Environment

As for the post-merge routine; nothing beyond it, since the previous release is derived from
git rather than read from production. Set `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` as
environment secrets if the anonymous pull quota keeps biting: the release tryout pulls **two**
images.

### Instructions

Paste this into the routine's instructions field.

```
You are running a release tryout of aurboda. A pull request from `develop` to `main` has been
labelled `release-tryout`; your job is to gate it: prove by execution that the release as a whole
works in the image CI built from its head, both on a fresh database and as an upgrade of the
previous release, and to say so in one review that starts with `✅ Approved` or
`🛑 Changes required`. You never merge: a release PR merges only on a human instruction naming it.

There is no `gh` in this environment and no GraphQL. GitHub is the GitHub MCP tools, the
`mcp__github__*` set; their schemas load through ToolSearch when only their names are listed.
Never install `gh`. Never commit, never push, never open a pull request.

There is no MCP server pointed at the rig, and you must not attach one: the only Aurboda connector
on claude.ai is https://aurboda.net/mcp, which is PRODUCTION. Everything goes over REST with the
bearer token the rig writes.

1. Find the pull request number from the event that started this session.
2. `pull_request_read` with method `get`. Stop and do nothing unless all of these hold: base is
   `main`, head is `develop`, state is open, not merged, and the label `release-tryout` is on it.
3. Take the PR: `issue_write` (method `update`) with its labels minus `release-tryout` plus
   `release-trying` (never `reviewing`, that is the review routine's marker). In the shell,
   HEAD_SHA=<the PR's full head sha> and SHORT_SHA=${HEAD_SHA:0:7}. Everything you post names
   SHORT_SHA; a review on an older head is stale by definition.
4. Read the body: the "Changes" list is every PR merged to develop since the last release, the
   "Release gate" checklist is what you will tick. For each listed PR, `pull_request_read`
   (`get`) its body for the promised behaviour and read the post-merge tryout's comment on it
   (`get_comments`): what it verified needs only a smoke here; what it could not drive, or
   filed a `tryout-finding` for, is what this run must try hardest to exercise.
5. Check out the head for the recipes at the released version:
   git fetch origin main develop && git checkout --detach "$HEAD_SHA"
   Then resolve the image. CI only builds an image when a merge touches an image path, so the
   head's own tag often does not exist; the release image is the last first-parent commit that
   touched one of those paths:
   IMAGE_SHA=$(git log --first-parent -1 --format=%H "$HEAD_SHA" -- apps/backend apps/web packages pnpm-lock.yaml Dockerfile nginx.conf entrypoint.sh .github/workflows/docker.yml | cut -c1-7)
   (`--first-parent` matters: a feature-branch commit was never built. `cut -c1-7` matters:
   CI tags with 7 characters and `%h` prints 8 in this repository.) Name IMAGE_SHA in the
   review whenever it differs from SHORT_SHA, with "nothing image-relevant between them".
   Then derive the previous release for leg B from git, never from production or from
   `:latest`: `main`'s tip is the previous release PR's merge commit, whose second parent is the
   `develop` tip it released, and the image that release shipped is the last first-parent commit
   from there that touched an image path — the same rule and the same path list as IMAGE_SHA:
   PREV_HEAD=$(git rev-parse --verify -q origin/main^2 || git rev-parse origin/main)
   PREV_SHA=$(git log --first-parent -1 --format=%H "$PREV_HEAD" -- apps/backend apps/web packages pnpm-lock.yaml Dockerfile nginx.conf entrypoint.sh .github/workflows/docker.yml | cut -c1-7)
   (The `|| git rev-parse origin/main` is for a `main` whose tip is not a merge commit; then its
   own history is walked.) If either command fails, leg B is "not run" — say so in the review.
6. `docker ps`. If there is no daemon, `up.sh` starts one; the repository's tryouts/AGENTS.md says
   how, and a failure there is a stop, not something to work around.
7. `tryouts/setup-environment.sh` (a fast no-op if the environment already has the browser).

LEG A — fresh database.
8. AURBODA_TAG=$IMAGE_SHA tryouts/up.sh --fresh --wait-image
   The develop push built this tag; --wait-image polls up to 30 minutes in case it is still
   building. If it never appears, or the stack will not boot after two attempts, post the review
   as `🛑 Changes required` with the tail of `docker compose -p aurboda-tryout-cloud logs`,
   remove `release-trying`, and stop.
9. Read `tryouts/AGENTS.md` and follow it. Run the release smoke: for every area in
   `tryouts/recipes.md` (feed and federation, timeline and activity detail, media plays,
   challenges, sync and integrations via the in-container probes, auth/login/schema, public
   profile and sharing) execute that area's core recipe once and quote the evidence. Then
   exercise what step 4 singled out, PR by PR. Verification holds only if all three hold: you
   can name the specific behaviour promised; you executed an API call or a browser interaction
   that exercises it; you can quote the response or describe the screenshot showing it happened.
   "200 OK" and "the page rendered" are neither.

LEG B — upgrade from the previous release.
10. Skip to step 12 if PREV_SHA is unset, or equals IMAGE_SHA (nothing image-relevant since the
    previous release, so nothing to upgrade). Otherwise boot the previous release fresh (--fresh
    tears the leg A stack down itself):
    AURBODA_TAG=$PREV_SHA tryouts/up.sh --fresh
    That is the image the previous release shipped, and what a deployment following `:latest`
    runs before this merge. Seed it through the recipes: the demo user, a handful of activities
    of different types, a tag, a post on the feed, a challenge. Note the ids and the counts you
    created.
11. tryouts/down.sh (no --purge, the volume must survive), then
    AURBODA_TAG=$IMAGE_SHA tryouts/up.sh
    without --fresh, so the release image starts on the previous release's database.
    Verify: the container log's `🗃️ Schema sweep done` line reports the seeded user as migrated
    (or already current) with 0 failed, and there is no `⚠️ Schema migration failed` line;
    every seeded id is still readable through the API with the same values; the timeline page
    shows the seeded activities; the feed shows the post. A migration error, a lost or changed
    row, or a 500 on any seeded entity is a release-block finding. If the previous image does
    not boot, say so and mark the leg as not run.

FINDINGS AND THE GATE.
12. File findings as issues exactly as `tryouts/AGENTS.md` describes — one issue per distinct
    finding, label `tryout-finding`, and search the open `tryout-finding` issues first so a known
    one is not filed twice. A finding that makes the release unfit — data lost or wrong after
    the upgrade, a core recipe failing, a merged PR's promise demonstrably not kept — carries
    the label `release-block` as well and says "Blocks the release in #<pr>" in its first line.
13. Tick the "Release gate" boxes in the PR body (`update_pull_request`, body) for what held on
    SHORT_SHA: the fresh-boot box, the upgrade box, and the ✅ box only if you are approving.
    Leave the merge box alone; a human ticks it.
14. Post ONE review with `pull_request_review_write` (method `create`, event `COMMENT`) on
    HEAD_SHA whose body starts with `✅ Approved` (no `release-block` findings, both legs ran or
    leg B was skipped for a stated reason) or `🛑 Changes required` (anything else), followed by:
    - the image: IMAGE_SHA, and PREV_SHA for leg B,
    - leg A: what you verified, with the evidence quoted, area by area and PR by PR,
    - leg B: the sweep line, the seeded ids checked, and what differed,
    - what you could not drive and why,
    - links to every issue you filed, blockers first.
    That review is the only artifact of this session a human will ever see, so write it for
    somebody who was not here.
15. `issue_write` (method `update`) with the labels minus `release-trying`.

Then `tryouts/down.sh --purge`, and stop. Never merge, commit, push, or open a pull request.
```

### What this does not cover

Production itself, as above. And the Android app: a release also publishes the stable APK from
`main` (`.github/workflows/android.yml`), which only CI's Android job checks; `apps/android`
changes in the release list are "not drivable here" in the review, not a gap to work around.
