## Repository structure

See README.md for general setup.  Specific docs in docs/ directory.  Each a

* Backend API and MCP: apps/backend (typescript)
* Frontend Web: apps/web (typescript)
* Android App: apps/android (kotlin)
* Shared typing and OpenAPI spec: packages/api-spec (typescript and generated yaml/kotlin)
* Database: PostgreSQL


## Work flow

* NEVER alter already pushed commits.  No amend if the commit is pushed.  No force push.
* Always make a PR of suggested changes.


## Code style

* Prefer code that is testable without heavy mocking.
* Prefer functional style, no classes.


## Testing

* Make unit test first (when reasonable), prompting a more testable code with clear dependency injection.


For typescript:

* `pnpm fix` to make code prettier and handle linting rules
* `pnpm check` to check typescript etc


Deployment:

* aurboda-backend is automatically deployed to https://aurboda.net/api on merge to `develop`.
* aurboda-web is automatically deployed to https://aurboda.net/ on merge to `develop`.
