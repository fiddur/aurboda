# Server administration

The first user to sign up becomes an admin. Admins manage server-wide settings (signup mode,
integration credentials, Sentry) from the web app's Admin Settings page. Those settings, the admin
list and the records below live in the central database (`CENTRAL_DB`, default `aurboda`), not in
any user's own database.

## User accounts

Every account has a row in the central `user_accounts` table, written at signup (password or
passkey) with the signup time. Accounts that existed before the table did get a row at the next
server start with no signup date and `pre_existing` set, since their signup date is unknown.

## Usage counters

So an admin can see who uses the server and how, the backend counts, per user and per UTC day:

| Kind     | What is counted                                                                                               | Channel                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `read`   | Successful authenticated REST `GET`/`HEAD` requests, and MCP calls of read-only tools                         | `web`, `android`, `api` (REST) or `mcp`                                |
| `write`  | Successful authenticated REST `POST`/`PUT`/`PATCH`/`DELETE` requests, and MCP calls of tools that change data | as for `read`                                                          |
| `ingest` | Each write of raw records or GPS points, with how many were stored                                            | The data source (`garmin`, `oura`, `health_connect`, `owntracks`, ...) |

Each row in the central `user_usage_daily` table holds a count, the number of items (records or
points for `ingest`) and the time of the last event. Nothing else is stored: no paths, no request
content, no IP addresses. The REST channel comes from the `X-Aurboda-Client` header the web app and
Android app send, falling back to the `User-Agent`; anything else is `api`. MCP tools count as
writes when their name starts with a mutating verb (`add_`, `update_`, `delete_`, `sync_`, ... — see
`MUTATING_MCP_TOOL_PREFIXES` in `apps/backend/src/services/usage-channel.ts`).

Counts are aggregated in memory and written about once a minute and at shutdown, so a crash can lose
up to a minute of counts. Rows older than 400 days are deleted by the daily prune job (03:17 server
time, alongside the audit-log prune).
