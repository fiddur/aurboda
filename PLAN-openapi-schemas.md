# OpenAPI Implementation Plan for Aurboda (Issue #71)

## Summary

Add OpenAPI specifications with request/response schemas that generate:
- **TypeScript types** for backend and web frontend
- **Kotlin data classes** for Android app

## Recommended Approach: Zod as Source of Truth

### Why Zod-first?

1. **Backend already uses Zod 4.3.5** - Existing schemas in `services/settings.ts` and `mcp.ts`
2. **Single source of truth** - Validation and documentation stay in sync
3. **Functional style** - Fits project guidelines (no classes)

### Tooling

| Purpose | Tool |
|---------|------|
| Zod → OpenAPI | `@asteasolutions/zod-to-openapi` |
| OpenAPI → TypeScript | `@hey-api/openapi-ts` |
| OpenAPI → Kotlin | `openapi-generator-cli` with `kotlinx_serialization` |

## Package Structure

```
nephelai/
  packages/
    api-spec/                       # NEW PACKAGE
      package.json
      src/
        schemas/
          common.ts                 # MetricType, ActivityType, DataSource
          metrics.ts                # Metric query/response
          daily-summary.ts          # Daily summary
          period-summary.ts         # Period summary
          tags.ts                   # Tags
          activities.ts             # Activities
          locations.ts              # Locations
          settings.ts               # User settings (move from backend)
          sync.ts                   # Sync status
        openapi.ts                  # OpenAPI document generator
        index.ts                    # Re-exports
      generated/
        openapi.yaml                # Generated spec
        typescript/                 # Generated TS types
        kotlin/                     # Generated Kotlin data classes
```

## Implementation Phases

### Phase 1: Package Setup
- Create `packages/api-spec` with dependencies
- Update `pnpm-workspace.yaml` to include `packages/*`
- Configure OpenAPI Generator for Kotlin

### Phase 2: Schema Extraction
- Extract `validMetrics`, `MetricType`, `ActivityType` from `apps/backend/src/schema.ts`
- Move Zod schemas from `apps/backend/src/services/settings.ts`
- Convert response interfaces from `apps/backend/src/services/queries.ts` to Zod

### Phase 3: OpenAPI Generation
- Write `openapi.ts` to register schemas and API paths
- Generate `openapi.yaml`
- Validate spec

### Phase 4: TypeScript Client
- Generate TypeScript types with `@hey-api/openapi-ts`
- Update `apps/web/src/state/api.ts` to use generated types
- Remove duplicated interfaces

### Phase 5: Kotlin Models
- Generate Kotlin data classes with `kotlinx_serialization`
- Update Android app to use generated types
- Replace manual data classes in `HealthDataModels.kt`

### Phase 6: Backend Integration
- Use shared schemas for request validation in `api.ts`
- Use shared schemas in `mcp.ts` for tool parameters

### Phase 7: CI/CD
- Add `pnpm generate:api` to CI pipeline

## Key Files to Modify

| File | Changes |
|------|---------|
| `pnpm-workspace.yaml` | Add `packages/*` |
| `apps/backend/src/schema.ts` | Extract types to shared package |
| `apps/backend/src/services/settings.ts` | Move Zod schemas to shared |
| `apps/backend/src/services/queries.ts` | Convert interfaces to Zod |
| `apps/web/src/state/api.ts` | Replace interfaces with imports |
| `apps/android/.../HealthDataModels.kt` | Replace with generated |

## Dependencies to Add

### `packages/api-spec/package.json`

```json
{
  "dependencies": {
    "zod": "^4.3.5"
  },
  "devDependencies": {
    "@asteasolutions/zod-to-openapi": "^7.0.0",
    "@hey-api/openapi-ts": "^0.50.0",
    "@openapitools/openapi-generator-cli": "^2.13.0",
    "tsx": "^4.19.2",
    "yaml": "^2.4.0"
  }
}
```

## Build Scripts

```json
{
  "scripts": {
    "generate:openapi": "tsx src/openapi.ts",
    "generate:ts": "openapi-ts -i ./generated/openapi.yaml -o ./generated/typescript",
    "generate:kotlin": "openapi-generator-cli generate -i ./generated/openapi.yaml -g kotlin -o ./generated/kotlin --config openapi-generator-config.yaml",
    "generate": "pnpm generate:openapi && pnpm generate:ts && pnpm generate:kotlin"
  }
}
```

## Questions for Clarification

1. **Zod 4.x compatibility**: `@asteasolutions/zod-to-openapi` v7 primarily supports Zod 3.x. Should we:
   - a) Use Zod 3.x in the shared package (different version from backend)
   - b) Wait/contribute Zod 4 support
   - c) Use alternative like `zod-openapi` which may have Zod 4 support

2. **API versioning**: Should we add version prefix (e.g., `/v1/metrics`) for future compatibility?

3. **Response wrapper**: Current responses use `{ success: boolean, data: T }`. Should we:
   - a) Keep this pattern in OpenAPI spec
   - b) Simplify to just return `T` directly (more RESTful)

4. **Date handling**: Web currently converts ISO strings to `Date` objects manually. Should generated client:
   - a) Return strings (current behavior, simplest)
   - b) Auto-convert to Date objects
   - c) Use a date library like date-fns

## Sources

- [OpenAPI Generator Kotlin docs](https://github.com/OpenAPITools/openapi-generator/blob/master/docs/generators/kotlin.md)
- [@asteasolutions/zod-to-openapi](https://github.com/asteasolutions/zod-to-openapi)
- [@hey-api/openapi-ts](https://heyapi.dev/)
- [Fabrikt](https://github.com/fabrikt-io/fabrikt) - Alternative Kotlin generator
