# Sentry error reporting

The backend can report uncaught errors to [Sentry](https://sentry.io) when an admin
configures a DSN in Admin Settings.

## What is captured

- Uncaught errors thrown from any Express route handler reach
  `Sentry.setupExpressErrorHandler` before the centralized error handler responds.
- Default PII collection is enabled (`sendDefaultPii: true`) so Sentry can attach
  request IP and user context.

When no DSN is configured, the Sentry SDK is not initialized and the express error
handler is a no-op — no data leaves the server.

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
