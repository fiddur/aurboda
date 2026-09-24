# The post-merge tryout routine

A tryout used to run on a webhook service on Fredrik's machine: it watched for merges, pulled the
freshly built Docker image onto that box, and started a local agent with an MCP connection to the
container. It runs instead as a **Claude Code routine** — a cloud session fired by a GitHub
trigger, which boots the same image with the scripts in this folder.

This file is what to type into the routine's settings, and the instructions to paste into it.

**None of this has been through a cloud run yet.** The environment half in particular — whether
Chrome's download passes the network level, whether `dockerd` starts, whether the registry hosts
are allowed — is unverified until the first tryout actually fires. Fix what the first run shows
and correct this file in the same PR.

[← back to the tryout brief](./AGENTS.md)

## Trigger

| Field      | Value                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Source     | GitHub                                                                                                                               |
| Repository | `fiddur/aurboda`                                                                                                                     |
| Event      | `pull_request`, action **closed** (or "All PR events" if the form offers no per-action choice — the instructions re-check it anyway) |
| Filter     | Is merged = **true**                                                                                                                 |
| Filter     | Base branch **equals** `develop`                                                                                                     |
| Connectors | **GitHub only.** Never the Aurboda connector: the only one on claude.ai is `https://aurboda.net/mcp`, which is **production**        |

## Environment

- **Setup script**: the contents of [`setup-environment.sh`](./setup-environment.sh). It is
  optional — the instructions run it again at the start of every tryout, where it is a fast no-op
  — but putting it here caches the ~200 MB browser install into the environment image instead of
  paying for it on every merge. This environment's setup script is the **one exception** to the
  rule in the root `AGENTS.md` that the field stays empty, and it is an exception for the browser,
  not for the toolchain: `.claude/hooks/session-start.sh` is checked in and needs no pasting.
- **Docker is required**, and it is what makes this environment different from the reviewer's. The
  VM has `dockerd` installed but not running; `up.sh` starts it (with `sudo` when it is not root).
  Without a daemon there is no tryout at all.
- **Node.** Nothing in `tryouts/` needs the Node 25 or the `node_modules` the session-start
  hook installs. The scripts run on the stock Node; puppeteer resolves from `/opt/tryout`.
- **Network.** The rig pulls images, so it needs `registry-1.docker.io`, `auth.docker.io`,
  `production.cloudflare.docker.com` and `hub.docker.com`. `setup-environment.sh` needs
  `registry.npmjs.org`, **`storage.googleapis.com`** (where `puppeteer browsers install chrome`
  downloads from) and the Ubuntu apt mirrors. `nodejs.org` is for the session-start hook. If the
  _Trusted_ level refuses any of them, switch to a custom allowlist that adds them.

## Instructions

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

## What this does not cover

The deployment itself. The image the tryout boots is the one the server picks up, but nothing here
checks that `aurboda.net` actually took it, and nothing here touches production data — the
production MCP connector stays off this routine on purpose.
