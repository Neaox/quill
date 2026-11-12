# ADR-065: Code and schema reference index

**Status:** Accepted
**Date:** 2026-11-12
**Related:** ADR-002 (Markdown is canonical), ADR-004 (one definition per directive), ADR-010 (search), ADR-011 (security baseline), ADR-012 (permissions), ADR-014 (content store), ADR-023 (public publishing and server rendering), ADR-031 (render caching), ADR-032 (live blocks), ADR-033 (compatibility), ADR-035 (addresses), ADR-039 (Markdown extensions), ADR-044 (anchors and aliases), ADR-055 (ownership), ADR-056 (outbox), ADR-059 (properties), ADR-060 (component blocks), ADR-061 (read-only external Git sources), ADR-062 (check and preview in the repository), ADR-063 (live updates); the prototype's ADR-0150 and `docs/design/quill-docs.md`, `docs/design/developer-docs.md`, `docs/research/code-index-spike.md`; `docs/ideas/code-and-schema-index.md` (the detailed design).

## Context

Quill documents explain behaviour, purpose and expectations. The precise truth about names, signatures, types and relationships lives in source, and the truth about stored data lives in a database. Today a writer copies a signature into a page, a reader opens the repository to check it, and a schema column's meaning lives in somebody's head. Nothing notices when the code moves under a page.

The PMS is the first real corpus and the acceptance test. It is a Node 26 / TypeScript monorepo with 59 packages, 6 apps, 493 Markdown files, 164 ADRs, 181 SQL migrations and about 277 tables across five Postgres stores. It already has:

- a **local code index** (`scripts/code-index/`, `pnpm code:index`) that extracts 9,103 symbols over the whole non-UI repository in 17 seconds cold and 1.2 seconds warm, with a blob-SHA cache, a public-surface walk, search, and a static page;
- a **developer-docs design** (`docs/design/developer-docs.md`) with the guide layer, the docblock convention and the local index;
- a **docs plan** (`docs/design/quill-docs.md`, the prototype's ADR-0150) in which Quill serves the repository's Markdown from an internal instance and a public/customer instance, with `docs/quill.yaml` and `pnpm docs:check`;
- a **local code index spike** (`docs/research/code-index-spike.md`) proving the TypeScript 7 native compiler API, the cache and the measurements.

What is missing is the hosted, permissioned, two-way layer: every package indexed, the schema indexed at all, a module map and flows a new developer can follow, references from guides to symbols and tables, and answers when either side changes.

The first implementation is a local index; `docs/design/developer-docs.md` records the owner's ruling of 2026-10-25 that it stays local **for now**, to keep running costs low. This ADR extends that ruling rather than discarding it: `pnpm code:index` remains the inner loop, and the hosted layer reuses its extractor and artifact.

## Decision

### 1. A derived reference index, not documents

Code symbols and database entities live in Postgres, with raw artifacts in the blob store. They are never content-store documents, never revisions and never editable in Quill. They are derived from a source, carry the revision they were derived from, and can be rebuilt.

A **reference source** is a repository or a database, scoped to a workspace. A **snapshot** is one index of a source at one revision. An **entity** is a symbol, a table, a column or a future spec operation. An **edge** is a relationship: contains, extends, implements, uses, maps-to, references, indexed-by, documented-by.

The index is versioned in the shape rule 17 requires: a persisted format carries a version and every reader dispatches on it. An older reader refuses an unsupported artifact with a supported range, rather than guessing.

### 2. One entity model, with explicit fidelity

Symbols, tables, columns and future API operations share one model, one search, one permission check, one page template and one reference mechanism. The kind is a discriminant.

Not every extractor knows the same amount, so every source declares **fidelity**:

- `semantic`: resolved types, inheritance and references from a compiler or language server;
- `declared`: declarations and doc comments resolved by the tool's own rules;
- `syntactic`: declarations and doc comments from a grammar, without cross-file resolution;
- `exact`: schema objects read from the database's catalogs;
- `authored`: a schema declared in an ORM, a DDL folder or hand-written types.

A page says what it knows. "Types are not resolved for this source" is honest; a graph that pretends to be complete is not. Coverage and drift calculations name the fidelity they rely on.

### 3. The artifact is the generic language boundary

Quill does not bundle every compiler. The primary lane is a **Code Index Artifact** produced by `quill index` in CI, using the project's own toolchain. Native adapters cover the first languages. Standard formats (SCIP, rustdoc JSON, Dokka, Doxygen XML, TypeDoc, griffe) are importers. A tree-sitter adapter is the honest syntactic fallback. A language is therefore a build step or an adapter, never a hard-coded page.

The first lane is already proven by the PMS: the TypeScript 7 native compiler API (`typescript/unstable/sync`), the blob-SHA cache and the identifier scan. It needs no `ts-morph`, no SCIP and no second compiler for TypeScript. The remaining work is members, `@see`/`{@link}`, TSX projects and the hosted artifact.

### 4. Metadata only: structure is documentation, rows are data

The index reads declarations, signatures, doc comments, locations and relationships. It does not read function bodies, local variables, string literals, secrets or runtime values.

For a database it reads **metadata only**: catalogs, tables, views, columns, types, defaults, keys, constraints, indexes, comments, triggers and relationships. It never reads a row, a sample value or a query result.

**Table structure is not sensitive; the data in it is.** Table and column names, types, keys, constraints, indexes and comments are documentation, visible to workspace members. Guest details, payment details, message bodies, ticket contents, call recordings and every row value are data, and are never read. The adapter enforces this with a catalog allowlist and a record-shape check, so there is no redaction policy to forget and no row to leak.

Source excerpts are a separate, pinned request through M5's source-reference path, with its own permission check. They are not part of the index.

### 5. Stable monikers, snapshots and aliases

Documents store a **moniker**, the stable external identity of an entity, never a database UUID. A moniker is opaque to the model and is never parsed to make an access decision.

A rename produces an **alias**, not a new identity. The alias has a confidence and a confirmation state; a reference resolves through it, and an old address redirects through it. A deletion leaves a tombstone and a state, not a silent 404. This is ADR-035's and ADR-044's rule applied to code and schema. Ambiguous renames are reviewed; no document is rewritten without a person choosing.

### 6. References are Markdown directives that render as slots

A reference is a directive, because a directive degrades to its content (ADR-002, ADR-039):

- `:code[PaymentService.capture]{ref="…"}` is an inline reference;
- `:schema[payments.intents.status]{ref="…"}` is an inline schema reference;
- `::signature{ref="…" snapshot="…"}` is a signature card;
- `::source{ref="…" lines="42-71" snapshot="…"}` is a source excerpt, through M5;
- `::table-card{...}` and `::erd{...}` are schema blocks.

The display text is the first thing a reader sees. A `covers` claim is front matter, not body markup, and appears as "Documented entities" in the properties panel. A claim is separate from a mention: coverage counts both; only a claim is "documented".

The cached body stays a pure function of the source. The renderer emits a **slot** with the readable fallback; page assembly resolves all references on the page in one batch and fills the current metadata. A new snapshot does not invalidate every document body, only the assembled page (ADR-031, ADR-032).

### 7. The map and the flows

A reference tree answers "what is this?"; it does not answer "where do I start?" or "how does a booking become a stay?". So the feature has three layers:

- **The map** names the domain modules, their purpose, owner, paths, tables, guides and dependencies. It is a reviewed, declarative manifest (`map/v1`), never inferred from folders alone. A generated proposal is previewed, never presented as fact.
- **The flows** are ordinary Markdown documents with `flow:` front matter and an ordered list inside a `:::flow` container. Each step names an entity; every reference is validated, and a broken step is an ordinary broken reference. The list form degrades to a numbered list outside Quill.
- **The reference** is the generated layer underneath: module pages, symbol pages, table pages, members, signatures, schema, relationships and provenance.

A module may span several packages and a package may serve several modules. The module page is canonical; the package pages are the generated reference beneath it. A symbol is promoted to its own page only when a guide claims it, when it is explicitly promoted, or when it is too large to sit in the module page. There is no page per function and no thin page in the sitemap.

### 8. The surfaces

- **Reference home:** sources, freshness, coverage, recently changed; the map is the default when a source has one.
- **Explorer:** modules → packages → members, and schemas → tables → columns, with filters for kind, visibility, deprecation, language, package, source, documentation and drift.
- **Symbol page:** the guide first when one exists, then a one-paragraph summary, signature, parameters, returns, throws, members, used-by/uses, documented-in, related schema and a permission-checked source excerpt.
- **Table page:** a data dictionary and a map: columns, types, nullability, defaults, keys, indexes, constraints, relationships, code models, guides and migration provenance. No query console.
- **Search and palette:** documents first for an ordinary query; `@` scopes to code and schema; exact names rank first; the existing query parser, chips and refinement are reused with `kind:`, `lang:`, `package:`, `table:`, `schema:`, `deprecated:` and `documented:`.
- **Editor:** insert from `/code` and `/schema`, a toolbar action or `[[`; choose inline, signature, source excerpt, table card or diagram; the node view has Open, Copy link, Copy signature, Change display, Refresh and Remove.
- **Reading:** inline chips, hover/focus cards, server-rendered block fallbacks, backlinks under "Documented in" and "Mentioned in", and a writer-only "Linked code" panel.
- **Public site:** only for a public source, through the existing public principal and the same templates, theme, sitemap and canonical rules. The PMS's reference is internal-only; Scalar stays its public API reference.
- **Export and print:** the static reference and its provenance are included; no interactive control is required.

### 9. Freshness, coverage and maintenance

A document reference records the signature hash, doc-comment hash and snapshot it saw when the document was last published. When a later snapshot changes, the reference enters one state: `current`, `description-changed`, `signature-changed`, `renamed`, `deprecated`, `missing` or `acknowledged`.

- The alert is about the reference, not the whole page.
- **Acknowledge** records the reviewed hash and returns when the hash changes again; it is not a dismiss.
- The coverage inbox lists undocumented public API, mentioned-only symbols, stale guides, broken and missing references, tables without a description, unowned tables and drift.
- A publish warns with the exact references and their diffs; it blocks only where a workspace policy says so.
- Coverage, staleness and drift are projections of the reference state, not hand-maintained lists.
- A failed index never blocks reading or publishing: the last good snapshot serves and the administrators are told.

### 10. Permissions and exposure

The index is a workspace-scoped resource. A reader with `view` on the workspace may read the code and schema metadata; source configuration follows ADR-061's administration model. A public surface is an explicit, reviewed filter through the existing public principal: only exported/public entities, chosen packages and reviewed pages. No private name, link or guide is leaked by a count.

The PMS's code and schema reference is internal. The public and customer instances keep ADR-0150's audience boundary and Scalar reference. A public OSS reference is a separate source and surface, not the PMS schema.

### 11. Performance and accessibility are acceptance criteria

Budgets:

| Operation | Budget |
| --- | --- |
| CI index, 100k symbols | under 5 minutes on 4 cores, cold |
| Incremental index, 100 changed files | under 30 seconds |
| Server ingest, 100k symbols | under 90 seconds |
| Symbol page, cached | p95 under 200 ms |
| Reference search | p95 under 300 ms on 1M entities |
| Page assembly with 40 references | one batched query |
| Reading route bundle | unchanged; reference route lazy |

The PMS baseline is the first regression test: 9,103 symbols in 17 seconds cold, 1.2 seconds warm, 8.5 MB JSON, 99.97% agreement with the compiler's own find-references.

Every page template is semantic HTML, keyboard-complete, axe-clean, mobile-readable, light/dark and print-ready, with a list fallback for every diagram. A reference card is supplementary: everything in it is on the entity page.

### 12. Reuse what the PMS has

The first implementation does not start from a blank page:

- lift `scripts/code-index/{extract,cache,git,search,page,schema,types}.ts` and their tests into a portable package;
- extend extraction to every package, then the TSX apps; add members, `@see`/`{@link}` and `@concept`;
- add the schema extractor over the 197 tenant tables and the control plane;
- host the artifact in the internal Quill instance behind the zero-trust proxy;
- keep `pnpm code:index` as the inner loop.

### Amendment (12 November 2026): schema annotations, namespaces and functions

The first schema pass is a migration reader, not a live catalog, and the question it exposed is where a table's or column's explanation lives. The answer keeps the database and the documentation each owning what they are good at.

**The short annotation is in SQL, with `COMMENT ON`.**

```sql
COMMENT ON SCHEMA payments IS 'Money movement: intents, captures, refunds and folios.';
COMMENT ON TABLE payments.intents IS 'One row per payment attempt.';
COMMENT ON COLUMN payments.intents.status
  IS 'Lifecycle: created, authorised, captured. A declined authorisation leaves it created.';
COMMENT ON FUNCTION lockstay_tenant()
  IS 'The tenant id set by withTenant() for the current transaction. Every row-level policy reads it.';
```

This is the idiomatic source, not a Quill invention. It travels with a dump, is visible in `psql`, is reviewed in the same migration as the schema change, and works with every PostgreSQL tool. The index reads it and shows its provenance. A table or column with no comment says so; it never invents one.

**The long explanation is a guide.** A normal Markdown document claims the entity in `covers:` and can carry purpose, invariants, examples, transitions, retention, owner and failure modes. The schema page shows "Read the guide" with the owner and revision, and the guide shows the entities it covers. This is the same claim/mention split as code.

**An optional sidecar carries structured facts the database cannot express.** For a managed database where comments cannot be written, or for metadata such as owner, tags, enum values, sensitivity, examples and see-also, a reviewed `docs/quill.schema.yaml` (`schema/v1`) maps monikers to facts:

```yaml
version: 1
entities:
  payments.intents:
    owner: payments
    tags: [money]
    guide: docs/design/bookings-list.md
  payments.intents.status:
    enum: [created, authorised, captured]
```

The sidecar is data, versioned with the repository and validated against a schema. It never duplicates the prose summary when a database comment exists: the DB comment is the summary, the sidecar supplies the structured facts, and the guide supplies the long form. Every page names which source each fact came from (`database comment`, `schema annotation`, `guide`), so a reader can tell a DBA's note from a writer's explanation. For a source with no comments at all, the sidecar may supply the summary and is labelled as such.

**Functions are first-class schema entities.** `CREATE FUNCTION`/`CREATE OR REPLACE FUNCTION` and `COMMENT ON FUNCTION` are read into the same snapshot as tables and columns. A function page carries its signature, return type, language, volatility, `SECURITY DEFINER`, comment, source line and guide. `lockstay_tenant()` is the worked example: it reads the `lockstay.tenant_id` setting that `withTenant` sets for the transaction, and every row-level policy compares against it. The page links the function, the `withTenant` code and the tenancy guide, so a reader can see the whole mechanism rather than a cryptic name.

**Foreign keys are edges, in both directions.** A column's FK links to the target table's page; the target table lists what references it, with the source columns. A reference to a table outside the source is shown as unresolved with the schema-qualified name, never as a dead link. The schema tree groups by namespace and exposes tables, columns and functions, so the structure is navigable before the reader knows a name.

**Schema builders have display transforms.** The compiler type of `z.object({...})` is a builder, not the data it describes. A display transform reads the declaration and offers two views:

- **Inferred type** — the data as TypeScript: `type AccountOpening = { open: boolean; changedAt: string | null; ... }`.
- **Source** — the declaration as written: `export type AccountOpening = z.output<typeof ACCOUNT_OPENING>;` or `const ACCOUNT_OPENING = z.object({...})`.

The transform prefers a named output alias. `AccountOpening` and `ACCOUNT_OPENING` link to each other; the schema constant says "Named type: AccountOpening" and the alias says "Defined from: ACCOUNT_OPENING". If no alias exists, the inferred view names the type after the constant and says it is inferred from the schema. The shape is derived from the schema's own syntax, not from a compiler type, so it carries that provenance and may be less precise than a compiler-resolved type for exotic builders. Zod is the first adapter; Valibot, TypeBox and ArkType register through the same `SchemaDisplay` contract, so the renderer never checks a library name.

**The schema surface is grouped by namespace.** A schema has its own commentary, owner, tables, views, functions and coverage. The tree is `namespace → table → column` and `namespace → function`; tables with many columns open on demand. Copy actions, anchors, a search that includes comments, and both-direction FK links are part of the page, not later polish.

## Alternatives considered

- **A separate API-reference site.** It would be a second renderer, a second search, a second permission model and a second place to fix a link. Rejected: the guides and the reference belong in one place.
- **Generate Markdown pages per symbol.** It produces thousands of thin pages, sprawl in the tree and SEO noise. Rejected: module pages by default, promotion by exception.
- **Store full source or an AST.** It would leak code into the platform and create a second source of truth. Rejected: declarations, doc comments and locations only.
- **Run every compiler on the server.** It makes the server a language platform, and CI already has the toolchain. Rejected: artifact first, native adapters for the first languages.
- **Treat table names as sensitive.** The user has ruled the opposite: structure is documentation, rows are data. Rejected as a default; a source may still hide a schema from the public surface.
- **Infer the map from folders.** It is wrong for a monorepo where module names do not match paths. Rejected: a reviewed manifest, previewed before saving.
- **AI-generated prose.** It is non-deterministic and not the product. Rejected: doc comments come from code, guides from people, scaffolds from templates.
- **Make the index a publication gate by default.** It would block docs on an index failure or a changed signature. Rejected: warn by default, block only by policy.

## Consequences

- the PMS's local index becomes the reference implementation and the first hosted source; the local command remains.
- Quill gains a new workspace-scoped capability, a new search index and ranking profile, a new set of Markdown directives, and a map and flow surface.
- The render cache stays pure: references are slots, resolved at assembly.
- The document link index gains code and schema kinds; backlinks and coverage reuse the publish event.
- The index is derived data in Postgres and the blob store; nothing above the content-store port learns about Git.
- The first release of the feature is internal; public OSS reference is a later, separate source and surface.
- A new language or database is an adapter or an artifact, not a page rewrite.

## Delivery

The feature is milestone **M6a — Code and schema reference**, after M6 (Maintain), because backlinks and quality signals are the same machinery. It must not delay Release 1.

1. **R15 spike:** lift the existing local index, extend it to all packages, add the schema extractor, write `docs/quill.reference.yaml` and the three PMS flows, host in the internal instance, run the twelve questions.
2. **Phase 1:** the map, module pages, symbol and table pages, search, references, backlinks, staleness, the internal reference surface and the data dictionary.
3. **Phase 2:** SCIP/rustdoc/Dokka/Doxygen, MySQL/SQLite/SQL Server, ORM metadata, drift, ERD, public version selector, CI coverage gates.
4. **Phase 3:** cross-repository identity, OpenAPI/GraphQL/Protobuf, pull-request impact comments, call graphs where a compiler provides them.

**Exit for the prototype:** at least ten of the twelve PMS questions pass for a novice and a senior; a senior reaches the symbol behind a business rule in under thirty seconds; support triage takes under two minutes; every module has an owner and an overview; every flow resolves; the index is fresh within five minutes; no thin generated page is in the sitemap.

The detailed design, the module map, the flows and the twelve questions are in [`docs/ideas/code-and-schema-index.md`](../../ideas/code-and-schema-index.md).
