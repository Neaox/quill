# @quill/application

Use cases, and the ports infrastructure implements. Depends on `@quill/domain` and nothing else: no database, no Markdown parser, no Git, no HTTP.

## Ports

Everything this layer needs from the outside is an interface here, and each one is named for what it does rather than for what implements it: `ContentStore` speaks documents, revisions, and diffs (ADR-014); `DocumentFormat` is the Markdown pipeline — parse, template, strip, render — with the syntax highlighter already bound in (ADR-030); the repository ports in `ports/persistence.ts` cover everything the platform keeps in Postgres; and `Clock` and `IdGenerator` exist so nothing here reads a wall clock or invents an identifier of its own.

## Use cases

`Authorizer` is the one place the platform decides what a request may do. It loads the scopes governing a document — the document, its ancestors, its collection, its workspace, the units above it, the instance — with the grants attached to them, expands the request into the principals it holds, and hands both to the domain resolver (ADR-012). Instance admins bypass it. One instance serves one request, so a route that authorises, reads, and then builds an envelope pays for the walk once.

The rest are the M2 content path:

| Use case | What it does |
| --- | --- |
| `createDocument` | A document and its first draft, blank or scaffolded from a template (ADR-029) |
| `publishDocument` | The only write to the content store: serialise, strip, check, publish, index, emit (ADR-015) |
| `restoreRevision` | An older revision published again as a new one; history is never rewritten |
| `readPublished` | The published Markdown of a document at a revision |
| `renderDocument` | The static body, cached by content hash and render version (ADR-031) |
| `getEnvelope` | The live half: permissions, lock, last publish, review, health signals |
| `getHistory` / `getDiff` | The revisions index and the compare view, both paged and both bounded |
| `getWorkspaceTree` | Navigation, with visibility resolved for the whole workspace in one pass |

Publishing warns and never blocks: an unfilled placeholder, a required section with nothing in it, or a front-matter field that does not match the schema is reported to the author and published anyway.

## Test support

`@quill/application/test-support` has a fake for every port — an in-memory `UnitOfWork`, a `ContentStore` that keeps a snapshot per revision, and a `DocumentFormat` with the same contract as the real Markdown pipeline and none of its machinery. The server's unit tests use the same fakes, so a use case behaves identically wherever it is driven from.
