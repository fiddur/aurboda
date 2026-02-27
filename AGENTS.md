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

## Shared Schemas and Types (`packages/api-spec`)

`@aurboda/api-spec` is the single source of truth for validation schemas and type definitions. All layers import from it — never duplicate schema definitions.

### Schema location

Zod schemas live in `packages/api-spec/src/schemas/`, organized by domain (tags, metrics, activities, locations, correlations, sync, settings, trends, etc.). All schemas are re-exported from the package root.

Use `.meta({ id: 'SchemaName', description: '...' })` on schemas — the `id` drives OpenAPI model names and the `description` is used by both OpenAPI docs and MCP tool discovery.

### Naming convention

All field names use **snake_case** everywhere: schemas, REST API, MCP tools, DB columns, JSONB keys, frontend types. The only exception is Kotlin, which uses camelCase properties internally with `@SerialName("snake_case")` for serialization.

### How each layer uses api-spec

**REST API routers** (`apps/backend/src/routes/`) — import schemas for request validation:

```typescript
import { addTagBodySchema, type AddTagBody } from '@aurboda/api-spec'
// Use with validation middleware:
router.post('/', authMiddleware, validateBody(addTagBodySchema), async (req, res) => { ... })
```

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

## Work flow

- NEVER alter already pushed commits. No amend if the commit is pushed. No force push.
- Always make a PR of suggested changes.

## Code style

- Prefer code that is testable without heavy mocking.
- Prefer functional style, no classes.

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
