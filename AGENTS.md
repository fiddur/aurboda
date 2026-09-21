## Repository structure

See README.md for general setup. Specific docs in docs/ directory.

- Backend API and MCP: apps/backend (typescript)
- Frontend Web: apps/web (typescript)
- Android App: apps/android (kotlin)
- Shared typing and OpenAPI spec: packages/api-spec (typescript and generated yaml/kotlin)
- Database: PostgreSQL

## API and MCP Parity

The REST API and MCP tools should have the same capabilities:

- Every MCP tool should have a corresponding REST API endpoint
- REST API follows RESTful conventions (GET for queries, POST for mutations, etc.)
- Shared business logic lives in `apps/backend/src/services/` and is used by both API and MCP
- Type definitions and schemas live in `packages/api-spec/`

When adding new features, implement both the MCP tool and REST API endpoint.

## Native (Android) and Web Parity

The Android app should offer the same functionality as the web app. To avoid
maintaining (and testing) two implementations of the same UI, the app is a
**hybrid**: it embeds web pages in a WebView for read/config-heavy screens and
implements screens natively only when device APIs require it (Health Connect
sync, BLE/live heart rate, background sync, notifications). See
`docs/android-app.md`.

Rules:

- **Prefer embedding the web page** (via `EmbeddedWebScreen`, `/<path>?embed=1`)
  over reimplementing it natively. Build a native screen only when it needs
  device APIs or must work offline / logged out (e.g. the login and server-URL
  screens).
- **Keep native and web counterparts in sync.** When you change a web page that
  has a native equivalent (e.g. settings), or vice versa, update both in the
  same change — same fields, same behavior, backed by the same `@aurboda/api-spec`
  schemas and `apps/backend/src/services/`. If you can't update both at once,
  file a GitHub issue tracking the gap rather than letting them silently diverge.
- A native screen that duplicates web functionality is a candidate to **replace
  with an embedded web view** unless it has a device-API reason to stay native.

## Shared Schemas and Types (`packages/api-spec`)

`@aurboda/api-spec` is the single source of truth for validation schemas and type definitions. All layers import from it — never duplicate schema definitions.

### Schema location

Zod schemas live in `packages/api-spec/src/schemas/`, organized by domain (tags, metrics, activities, locations, correlations, sync, settings, trends, etc.). All schemas are re-exported from the package root.

Use `.meta({ id: 'SchemaName', description: '...' })` on schemas — the `id` drives OpenAPI model names and the `description` is used by both OpenAPI docs and MCP tool discovery.

### Naming convention

All field names use **snake_case** everywhere: schemas, REST API, MCP tools, DB columns, JSONB keys, frontend types. The only exception is Kotlin, which uses camelCase properties internally with `@SerialName("snake_case")` for serialization.

### How each layer uses api-spec

**REST API routers** (`apps/backend/src/routes/`) — use `typedRouter()` with fully typed route definitions:

```typescript
import { type AddTagBody, addTagBodySchema, type TagResponse } from '@aurboda/api-spec'
import { typedRouter } from '../typed-router.ts'

const router = typedRouter()

// All 4 generic params: <PathParams, ResponseBody, RequestBody, QueryParams>
router.post<Record<string, never>, TagResponse, AddTagBody>(
  '/',
  authMiddleware,
  validateBody(addTagBodySchema),
  async (req, res) => {
    // req.body is typed as AddTagBody, res.json() expects TagResponse
  },
)

// Route with path params:
router.get<{ id: string }, TagResponse>('/:id', authMiddleware, async (req, res) => { ... })

// Route with query params (GET — no request body):
router.get<Record<string, never>, TagsResponse, unknown, TagsQuery>(
  '/',
  authMiddleware,
  validateQuery(tagsQuerySchema),
  async (req, res) => { ... },
)

return router as unknown as Router
```

**Routing conventions:**

- Always use `typedRouter()` (never plain `Router()`)
- Handlers are inline in the route definition (not separate `const handleX` functions)
- `PathParams`: `Record<string, never>` for no params, `{ id: string }` for `/:id`. Never `Record<string, string>`.
- `ResponseBody`: Must be an api-spec response type. Never `unknown`, `any`, or inline `{ success: boolean; data: unknown }`.
- `RequestBody`: api-spec body type for POST/PUT/PATCH. `unknown` for GET/DELETE (no body).
- `QueryParams`: api-spec query type when the route accepts query params.
- No `as Type` casts on `req.body` — set the `ReqBody` generic instead.
- No `// GET /path - description` comments above routes — the method and path are already visible in the code.
- DB types with `Date` must be serialized to ISO strings before responding (use a serializer function at the boundary).

**MCP tools** (`apps/backend/src/mcp/`) — use `.shape` to extract the flat field record that `server.tool()` expects:

```typescript
import { addTagBodySchema } from '@aurboda/api-spec'
server.tool('add_tag', 'Description', { ...addTagBodySchema.shape }, async (params) => { ... })
// To add extra fields: { id: z.string().uuid(), ...updateBodySchema.shape }
// To override a field: { ...bodySchema.shape, field: z.string().optional() }
```

Keep simple 1-field tools (delete by id) inline — import overhead exceeds duplication savings.

**Web frontend** (`apps/web/src/`) — import types only (no runtime schemas):

```typescript
import type { Tag, TagsQuery, TagsResponse } from '@aurboda/api-spec'
```

The frontend extends API types where Date objects are needed (API uses ISO strings):

```typescript
export interface Tag extends Omit<ApiTag, 'start_time' | 'end_time'> {
  start_time: Date
  end_time?: Date
}
```

**Android app** (`apps/android/`) — uses generated Kotlin models from OpenAPI:

```kotlin
// Generated at packages/api-spec/generated/kotlin/src/main/kotlin/net/aurboda/api/models/
@Serializable
data class Tag(
    @SerialName(value = "start_time") val startTime: OffsetDateTime,
    @SerialName(value = "tag") val tag: String,
)
```

**DB layer** (`apps/backend/src/db/`) — imports types for type safety, not schemas:

```typescript
import type { ActivityType, MetricType, DataSource } from '@aurboda/api-spec'
```

Row mappers in `db/row-mappers.ts` use type guards with api-spec constants (e.g. `activityTypes`).

**Services** (`apps/backend/src/services/`) — import types for function signatures. Services contain the shared business logic used by both REST API and MCP.

### Adding a new feature

1. Define the Zod schema in `packages/api-spec/src/schemas/` with `.meta({ id, description })`.
2. Export it from `schemas/index.ts`.
3. Build: `pnpm --filter @aurboda/api-spec build`
4. Import in the REST API router (for validation) and MCP tool (via `.shape`).
5. Regenerate: `cd packages/api-spec && pnpm generate` (updates OpenAPI YAML/JSON, TypeScript types, and Kotlin models).
6. Use the generated Kotlin models in the Android app.

## Git workflow

- Base branch is `develop`. `main` holds released state.
- **Never push directly to `develop`.** Always a PR.
- **Never alter already-pushed commits.** No amend after push, no force push.
- **Never rebase. Always merge.**
- Merge the latest `origin/develop` into the branch before pushing a PR update.
- Branch naming: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<slug>`.
- Commit and PR titles use conventional-commit style: `feat(feed): ...`.

## Working an issue: merge on approval

This project works **merge on approval**: once an issue is ironed out and assigned,
take it end to end, up to the merge. A webhook service reviews every PR that carries the
`needs-review` label, so getting one reviewed, approved and ready needs nobody's
attention.

**The merge itself needs the go-ahead, and "merge on approval" is it.** Said once it
stands for the whole run — the PR in hand and every later one in the same session.
Do not ask again per PR; that is the confirmation step those words remove. Without
them, take the PR to `✅ Approved` with every thread resolved and CI green, then stop
and say it is ready. The rule is spelled out here in full because a cloud session has
no `~/.claude` to find it in: this file is the whole rulebook wherever the session runs.

1. Sync: `git checkout develop && git fetch origin develop && git reset --hard
origin/develop`. Reset rather than pull — squash merges make local `develop`
   diverge. Where `develop` cannot be checked out (another worktree holds it) or
   is not there at all (a fresh cloud clone), skip the local branch: `git fetch
origin develop` and branch from `origin/develop`.
2. Branch off `develop`.
3. Plan, then implement, tests first where reasonable — see
   [Plan first, then an Opus implementer](#plan-first-then-an-opus-implementer).
4. `pnpm fix && pnpm check` and the tests all green locally: backend
   (`pnpm --filter aurboda-backend test`, which includes the testcontainers
   integration suites and so needs a Docker daemon), web
   (`pnpm --filter aurboda-web test`), and Android (`pnpm test:android`) when the
   change touches `apps/android` or `packages/api-spec` and an Android SDK is
   available.
5. Open a **Draft** PR against `develop`, body containing `Closes #<issue>`.
6. Watch CI — all of it, not one named check. Red → fix and push. Green → mark the
   PR ready for review, **then put the `needs-review` label on it**. The label is what
   asks for the review; ready alone asks for nothing. On Fredrik's machine that is
   `gh pr ready <n> && gh pr edit <n> --add-label needs-review`; in the cloud it is
   `update_pull_request` with `draft: false`, then `issue_write` (method `update`)
   carrying the label — the GitHub MCP tools, see
   [Running in the cloud](#running-in-the-cloud).
7. Wait for the review. It arrives by itself, as a `COMMENTED` review, a few
   minutes after the label goes on.
   - **On Fredrik's machine** the review service writes
     `/home/fiddur/src/codereview/events.log`, one `<ISO time> <pr url> <event>` per
     line. Wait for `<pr url> updated`; `review started` means it has only begun.
     Poll the file by line offset — note `wc -l` before adding the label, then sleep
     and read only what is new — because a backgrounded `tail -F … | grep` prints
     its match and then never exits. Do not poll GitHub on a timer there.
   - **Anywhere that file does not exist** (the cloud), GitHub is the only signal:
     see [Running in the cloud](#running-in-the-cloud).

   Either way bound the wait with a deadline, and when it runs out say the review
   service may be wedged rather than ending silently.

8. Read the review body **and every inline comment**. Fix genuine
   correctness/security findings; for trivial or subjective nits, resolve the
   thread with a brief rationale. Resolve every inline thread: the GraphQL
   `resolveReviewThread` mutation on Fredrik's machine, the `resolve_review_thread`
   tool in the cloud, with the thread id `pull_request_read` (`get_review_comments`)
   lists.
9. A push does not start a fresh review round by itself: **add `needs-review` again**
   after every push that should be re-read — the label is the request, and putting it
   on once more is how a re-review is asked for. Then repeat from step 7.
10. **Merge, without asking again**, once "merge on approval" is standing and all
    four gates hold:
    - the latest review body starts with `✅ Approved` — the service puts a space
      after the ✅, so match the mark and not the spelling — **and** it is on the
      current head commit (a `✅ Approved` left on an older commit is stale),
    - every inline review thread is resolved,
    - **every** check is green — not a named one. `CI Gate` is the rollup of the
      Node and Android jobs, but naming only it would let any other check through.
      Check the whole rollup: `gh pr view <n> --json statusCheckRollup` on Fredrik's
      machine, `pull_request_read` with `get_check_runs` in the cloud — every run
      `completed` and `success`.
    - `mergeStateStatus` is `CLEAN` (`mergeable_state` is `clean` on the
      `pull_request_read` `get` answer).
      Then `gh pr merge <n> --merge`, or `merge_pull_request` with
      `merge_method: merge` and the head sha as `expectedHeadSha`. Never `--admin`.
      Avoid `--auto` — a push clears it and the PR sits `BLOCKED`.
11. If `BEHIND`: `git fetch origin develop && git merge origin/develop
--no-edit`, re-run `pnpm check`, push, and re-confirm the gate from step 7.
12. After merge: `git checkout develop && git fetch origin develop && git reset
--hard origin/develop`, delete the merged branch, and pick up the next
    assigned issue.

The gate is not optional. "Merge on approval" removes the human confirmation
step, not the review — never merge an unapproved PR, and never merge with open
threads or red CI. It removes that step for the run rather than for one PR: having
been told once, asking again on the next PR is the same failure as never asking.

**What the platform enforces lives in repository settings, not here.** GitHub will
not let an author approve their own pull request, and every commit and review here
is authored by the same account, so a required-approval rule would deadlock rather
than protect: the `✅ Approved` gate is discipline, and this document is the only
thing enforcing it. The review service's verdicts are `COMMENTED`, not `APPROVED`.
A green rollup means the tests passed and the branch is mergeable; it does not mean
anything reviewed the change. Check the ruleset rather than trust a description of
it:

```sh
gh api repos/:owner/:repo/rules/branches/develop --jq '.[] | "\(.type): \(.parameters // {} | tojson)"'
```

That is a check for Fredrik's machine: the GitHub MCP tools have no rules endpoint, so
in the cloud a merge the ruleset refuses is the signal that something changed.

## Plan first, then an Opus implementer

The session model plans; an Opus subagent writes the code. Planning is where the
strongest model earns its cost, and an implementer that starts from a finished plan
has nothing to spend context on but the change. Trivial edits — a line or two, a doc
tweak — skip the round trip.

1. **Plan in the main session.** Read the code, settle the design, and resolve every
   open question with Fredrik — or in the issue, which is where a cloud session finds
   the answers — before any implementation starts. The implementer cannot ask.
2. **Write the plan to a file outside the repo** (the session scratchpad, else a
   `mktemp -d`), `PLAN.md`, one file per independent part. A fresh agent has none of
   the conversation, so the file is its whole brief: the goal, the decisions already
   made and why, the files and functions to touch by name, the steps in order, the
   tests to write, the checks to run, and what is out of scope. For a feature that
   crosses layers, the plan names the api-spec schema, the service, the REST route,
   the MCP tool and the web (and native) surfaces — see
   [Adding a new feature](#adding-a-new-feature).
3. **Delegate.** Use the `implementer` agent where the session lists one. Where it
   does not — the cloud, which has no `~/.claude/agents` — start a general-purpose
   agent with the Agent tool's `model: "opus"` and put the implementer's rules in the
   prompt: read the plan in full first; follow its decisions and, where it is silent,
   this file; stay inside its scope; where the plan is wrong, do what is unaffected
   and say exactly what blocked the rest rather than redesigning it; run `pnpm fix &&
pnpm check` and the affected package's tests; do not stage, commit, push or open a
   PR; report the steps done and not done, every file changed, the exact commands run
   with failing output verbatim, and anything decided that the plan did not specify.
   Never a fork: it inherits the session model, which defeats the point. Beyond those
   rules the prompt is three things: the absolute plan path, the repo path, the
   branch.
4. **Parallelise only independent parts**, one implementer per plan file, only where
   they touch disjoint files, and two or three at a time at most.
5. **Review before committing.** Read the report and the whole diff (`git diff`, and
   `git status` for new files), and run the checks yourself where the report is
   unclear. Send fixes back to the same agent so it keeps its context, or make small
   ones directly. Then commit and carry on from step 4 of _Working an issue_.

## Running in the cloud

A session started from claude.ai/code runs in a fresh VM with a fresh clone.
`CLAUDE_CODE_REMOTE=true` says so. Nothing of Fredrik's machine exists there — no
`~/.claude`, no memory, no review log — so everything above applies as written and
this section is the difference.

- **Node 25, and check it before believing a check or test run.** The image ships
  Node 20–22 and puts `/opt/node22/bin` first, and the tool shell is a non-login
  `bash -c` whose `PATH` was fixed when the session launched, so nothing an
  environment setup script exports, and no `/etc/profile.d` file, ever reaches it.
  What does reach it is `CLAUDE_ENV_FILE`, which every tool shell sources:
  `.claude/hooks/session-start.sh` runs at every session start, installs Node 25
  into `/opt/node25` if it is not there (from `nodejs.org`, checksum verified) with
  the pinned pnpm, and writes the `PATH` line to that file. Run `node --version`
  first anyway. Anything but `v25` means the hook did not run — a clone from before
  it merged, or a failure in its output — so run it by hand,
  `CLAUDE_CODE_REMOTE=true .claude/hooks/session-start.sh`, and prefix every command
  with `export PATH="/opt/node25/bin:$PATH"` for the rest of the session.
- **The hook is checked in, so there is nothing to paste** into the environment's
  settings, whose setup script stays empty. It reads the major from `.nvmrc` and the
  pnpm version from `packageManager`, so moving either moves the hook with it. It runs
  from the clone as it is at session start, which is `develop`: a change to it reaches
  sessions once merged, never from its own PR. Outside the cloud it exits at once.
- **The hook also runs `pnpm install --frozen-lockfile` and builds
  `@aurboda/api-spec`**, because the clone has no `node_modules` and the backend and
  web import the package's `dist`. Those and the Node download are the only things
  there that need the network: `registry.npmjs.org`, `nodejs.org` and
  `codeload.github.com`, all on the _Trusted_ network level's default list. **One
  dependency is not served there anyway:** `@flow-js/garmin-connect` is a `github:`
  dependency of the backend, which pnpm fetches as a tarball from
  `codeload.github.com`, and the session's GitHub proxy answers 403 for repositories
  not attached to the session (`fiddur/garmin-connect` is not aurboda). The hook
  says so and exits 1. That is the environment's policy, not something to route
  around — do not swap the dependency for a git clone, hand-build the tarball, or
  install only the packages that happen to resolve: say so and stop, rather than
  splitting the work into what can be done without it. A 403 from
  `registry.npmjs.org` is the same kind of stop.
- **Backend integration tests need a Docker daemon** (`testcontainers` starts
  `postgis/postgis`), and the VM has `dockerd` installed but not running. The hook
  starts it in the background when it can; `docker ps` tells. Without it every
  `*.integration.test.ts` fails at container start, whatever the code does. To run
  only the unit suites, pass `--exclude '**/*.integration.test.ts'` to `vitest run`,
  and say which suites were skipped.
- **No Android SDK.** `pnpm test:android` and `pnpm build:android` cannot run in the
  cloud; CI's Android job is the check for `apps/android`. `packages/api-spec`
  installs and builds on its own (`pnpm --filter @aurboda/api-spec install`, as CI's
  Android job does), so the spec can still be regenerated; the app itself only
  builds in CI.
- **There is no `gh` there, and no GraphQL. GitHub is the GitHub MCP tools**, the
  `mcp__github__*` set, whose schemas load through `ToolSearch` when only their names
  are listed. The whole workflow is six of them: `create_pull_request` (draft, against
  `develop`), `update_pull_request` (`draft: false` to mark it ready), `issue_write`
  (method `update`, the PR's number as `issue_number`, `labels` carrying
  `needs-review` — it sets the whole list, so name every label the PR should keep),
  `pull_request_read` (`get_check_runs`, `get_reviews`, `get_review_comments`, and
  `get` for `head.sha` and `mergeable_state`), `resolve_review_thread` and
  `merge_pull_request`. `subscribe_pr_activity` on the PR right after opening it, so
  reviews and check suites arrive as events rather than only by polling. Git itself
  goes through a proxy, and a push is accepted for the session's own branch only,
  which is all this workflow needs. Projects v2 has no tool there, so **the board
  cannot be read**: work the issue the session was started on.
- **Waiting for CI and for the review is a bounded poll of GitHub** between events, a
  minute or two between reads and a deadline on the loop. CI: `pull_request_read` with
  `get_check_runs`, every run `completed` and `success`. The review: `get_reviews`, and
  it has landed when the newest review's `commit_id` is the head sha that `get`
  reports — its body's first line opens with ✅ when the gate's first part holds. A
  review on an older commit is stale, whatever it says. Forty minutes without one
  after the label went on means the review service is down; say so.
- **Threads still have to be resolved.** `get_review_comments` lists them with their
  ids; `resolve_review_thread` closes one. If the proxy refuses either, answer every
  thread in a reply, and report that the threads need resolving by hand — that is a
  stop, not a reason to look for another way past the gate.

## Code style

- Prefer code that is testable without heavy mocking.
- Prefer functional style, no classes.
- Store data in normalized form: reference entities by ID, not by duplicating names or other mutable fields. Resolve names at query time (e.g. in the API response layer) so data stays consistent when referenced entities are renamed.

## Testing

- Make unit test first (when reasonable), prompting a more testable code with clear dependency injection.
- Backend should be well covered with tests.
- All database functions in `apps/backend/src/db.ts` must have integration tests in `db.integration.test.ts`.
- Integration tests use testcontainers to run against a real PostgreSQL instance.

For typescript:

- `pnpm fix` to make code prettier and handle linting rules
- `pnpm check` to check typescript etc
- Nothing is merged to `develop` without passing CI checks. If you see errors after merging from `origin/develop`, dependencies need to be reinstalled and packages rebuilt — do NOT assume they are pre-existing.

## Documentation

- Keep documentation in `docs/` up to date when changing related code.
- When adding or modifying a data source, update `docs/data-sources.md` and the relevant per-source doc (e.g., `docs/oura.md`).
- When changing APIs, sync behavior, admin/user setup, or data models, update the corresponding docs to reflect the new behavior.
- Documentation should stay well structured: the overview page (`docs/data-sources.md`) links to per-topic docs, each covering what data is synced, admin setup, user setup, and how sync works.

## Deployment

- aurboda-backend is automatically deployed to https://aurboda.net/api on merge to `develop`.
- aurboda-web is automatically deployed to https://aurboda.net/ on merge to `develop`.
