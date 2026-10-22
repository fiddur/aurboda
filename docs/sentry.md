# Sentry error reporting

The backend can report uncaught errors to [Sentry](https://sentry.io) when an admin
configures a DSN in Admin Settings.

## What is captured

- Uncaught errors thrown from any Express route handler reach
  `Sentry.setupExpressErrorHandler` before the centralized error handler responds.
- **Failures outside a request**, via process-level guards in `api.ts`: unhandled
  promise rejections and uncaught exceptions from background work (`void thing()`
  calls, queue workers, webhook managers), startup failures from `main()`, and
  post-listen task failures.

  An **uncaught exception** or a **startup failure** is followed by
  `process.exit(1)`; `entrypoint.sh` watches the backend PID, so the container
  restarts. Startup failures only reach Sentry if they happen _after_
  `initSentry`, which runs behind `initializeCentralDb` because the DSN is stored
  in that database -- so an unreachable Postgres or a failed migration is
  container-log-only. An **unhandled rejection** is reported but not fatal -- one transient
  error inside a background sync should not drop every in-flight request and open
  timeline stream. That does mean a subsystem can stay dead behind an
  `/api/version` that still answers 200, so those reports are worth acting on.

- Default PII collection is enabled (`sendDefaultPii: true`) so Sentry can attach
  request IP and user context.

Sentry's own `OnUncaughtException` and `OnUnhandledRejection` integrations are
disabled in `initSentry`, because those guards already capture and flush. Left
enabled they would report each crash twice: registering a listener stops those
integrations exiting, but not capturing.

When no DSN is configured, the Sentry SDK is not initialized, the express error
handler is a no-op, and `captureException` in the guards does nothing — no data
leaves the server. The uncaught-exception and startup guards still log and still
exit, so restart-on-failure for those does not depend on Sentry being
configured. Unhandled rejections are logged but non-fatal either way -- note
that is a change for a DSN-less deploy, which previously had no
`unhandledRejection` listener at all and so crashed on Node's default `throw`.

### Scope: errors only, no tracing/auto-instrumentation

`Sentry.init` runs inside `main()` after all module imports. `@sentry/node` v8+
auto-instrumentation (OpenTelemetry HTTP/express/db tracing, automatic
breadcrumbs) needs init _before_ those modules are imported to patch them, so
that side of the SDK is effectively inert here. Errors arrive only through the
paths listed above -- the express error handler and the process-level guards --
never from auto-instrumentation.

This is intentional given the admin-configured (DB-stored) DSN — we cannot
initialize before module imports without an env-var bootstrap. To enable
tracing later, run the backend with `node --import ./instrument.ts` and read
the DSN from an env var in that file.

## Admin setup

1. Create a project in Sentry (Node + Express).
2. Open the web app at `/admin/settings` (admin account required).
3. Paste the DSN under **Error Reporting → Sentry DSN** and save.
4. Restart (or redeploy) the backend. The DSN is read once at startup; changes
   take effect on the next restart.

To stop reporting, clear the DSN and restart the backend.

## How sync works

- DSN is stored as `sentry_dsn` in the central `server_settings` table.
- `initSentry` runs after the central DB connects in `apps/backend/src/api.ts`.
- The express error handler is registered after all routers and before the
  application's own error middleware, per Sentry's setup recommendations.

## Verifying

Throw an error from any authenticated endpoint and confirm it appears in the
Sentry project's Issues view. The id is also surfaced on `res.sentry` in the
error path for cross-referencing.
