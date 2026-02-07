## Repository structure

See README.md for general setup.  Specific docs in docs/ directory.

* Backend API and MCP: apps/backend (typescript)
* Frontend Web: apps/web (typescript)
* Android App: apps/android (kotlin)
* Shared typing and OpenAPI spec: packages/api-spec (typescript and generated yaml/kotlin)
* Database: PostgreSQL


## API and MCP Parity

The REST API and MCP tools should have the same capabilities:

* Every MCP tool should have a corresponding REST API endpoint
* REST API follows RESTful conventions (GET for queries, POST for mutations, etc.)
* Shared business logic lives in `apps/backend/src/services/` and is used by both API and MCP
* Type definitions and schemas live in `packages/api-spec/`

When adding new features, implement both the MCP tool and REST API endpoint.


## Work flow

* NEVER alter already pushed commits.  No amend if the commit is pushed.  No force push.
* Always make a PR of suggested changes.


## Code style

* Prefer code that is testable without heavy mocking.
* Prefer functional style, no classes.


## Testing

* Make unit test first (when reasonable), prompting a more testable code with clear dependency injection.
* Backend should be well covered with tests.
* All database functions in `apps/backend/src/db.ts` must have integration tests in `db.integration.test.ts`.
* Integration tests use testcontainers to run against a real PostgreSQL instance.


For typescript:

* `pnpm fix` to make code prettier and handle linting rules
* `pnpm check` to check typescript etc


Deployment:

* aurboda-backend is automatically deployed to https://aurboda.net/api on merge to `develop`.
* aurboda-web is automatically deployed to https://aurboda.net/ on merge to `develop`.
