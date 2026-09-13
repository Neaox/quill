# @quill/api-client

The web app's only route to the server. `src/schema.gen.d.ts` is generated from the server's OpenAPI description and is never edited by hand:

```bash
pnpm --filter @quill/server export-openapi   # writes packages/api-client/openapi.gen.json
pnpm --filter @quill/api-client generate      # writes src/schema.gen.d.ts
```

`createApiClient()` returns an `openapi-fetch` client typed by those paths, so a route change that is not additive fails to type-check in every feature that uses it before it can reach a screen (ADR-033).

This package pins its own TypeScript 6 as a dev dependency because `openapi-typescript` builds its output through the compiler API, which the native TypeScript 7 the rest of the repository uses does not expose. Remove that pin when the generator supports TypeScript 7.
