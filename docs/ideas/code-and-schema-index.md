# Code and schema index

- **Status:** promoted: ADR-065, milestone M6a
- **Recorded:** 2026-11-12
- **Prototype:** **The PMS prototype**, a private property-management platform, is the first real corpus and the acceptance test. Its existing `pnpm code:index` is the seed, and its modules, 197 tenant tables, flows and onboarding problem are the reason this is worth building.
- **Decision:** [ADR-065](../architecture/decisions/0065-code-and-schema-reference-index.md). This document is the detailed design behind it.
- **Trigger:** a team asks to navigate its code or database from Quill, or to publish an API reference beside its guides. The groundwork lands with read-only external sources (ADR-061), `quill check` and `quill preview` (ADR-062), live updates (ADR-063), component blocks (ADR-060) and source references (M5).
- **Builds on:** ADR-002 (Markdown is canonical), ADR-004 (one definition per directive), ADR-010 (search), ADR-011 (security), ADR-012 (permissions), ADR-014 (content store), ADR-023 (public site), ADR-031 (render caching), ADR-032 (live blocks), ADR-033 (compatibility), ADR-035 (addresses), ADR-039 (Markdown extensions), ADR-044 (anchors and aliases), ADR-055 (ownership), ADR-056 (outbox), ADR-059 (properties), ADR-060 (component blocks), ADR-061 (read-only external Git sources), ADR-062 (check and preview in the repository), ADR-063 (live updates).

## 1. The problem

A software team's knowledge is split across three places that do not know about each other:

- **Prose** explains *why* a thing exists, what it promises, and what to do when it fails. That lives in Quill.
- **Code** is the precise truth about names, types, signatures, contracts, and what calls what. That lives in a repository.
- **The database** is the truth about the shape of stored data, its relationships and constraints. That lives in a migration folder, an ORM schema, or a database nobody documents.

The cost is familiar. A new developer searches the repository for a name, opens five files, finds a class that no longer matches the guide, then runs a schema query to discover the column the guide calls something else. An experienced developer knows the answer but cannot point to it in one place. An open-source maintainer hand-writes an API reference that is stale the day after a release, or uses a separate static site where the reference and the guides do not cross-link. A database column's meaning exists only in the head of the person who added it.

The documentation does not need to duplicate the code. It needs to **point at it, explain it, and notice when the explanation stops being true**. Today Quill can render a code block and link to a file, but it cannot answer:

- What is this symbol, where is it defined, and what does it relate to?
- Which guides explain this class, this function, this table, this column?
- What changed in the code since this guide was published?
- Which public API is undocumented? Which documentation is now wrong?
- Which code model writes to this table?

**The PMS is that problem at full size.** It is a Node 26 / TypeScript monorepo with **59 packages**, **6 apps**, **493 Markdown pages**, **164 ADRs**, **181 SQL migrations** and roughly **277 tables across five Postgres stores**. It already has a local code-index prototype (`pnpm code:index`, 9,103 symbols, 17 seconds cold, 1.2 seconds warm) and a design for Quill as its docs viewer (`docs/design/quill-docs.md`, ADR-0150). What it does not have is the hosted, permissioned, two-way layer that turns those parts into something a new developer can learn from and a senior can trust: the index is local and only two packages deep, the database has no index at all, and the docs do not know which symbols or tables they describe. The PMS is the prototype because if the feature can make its core loop and its schema legible to a novice and precise for a senior, it can do the same for any software platform.

## 2. The idea

Connect a repository and, optionally, a database. Quill builds a **reference index**: a searchable, versioned graph of code symbols and database entities, generated from the source of truth rather than maintained by hand. The index gets first-class pages, a place in search and the command palette, and a place in the editor.

Documents can reference any entity in the index. A reference is a small directive in Markdown that degrades to readable text everywhere else. It creates a **two-way relationship**:

- the document points at the entity, with provenance (which snapshot, which signature, which commit);
- the entity page points back at every document that explains or mentions it, permission-filtered;
- the index records whether the reference is current, changed, renamed, missing, or deprecated.

The index also records the relationships the code and schema already have: implements, extends, uses, has-member, foreign key, index, and **model-to-table** mapping from an ORM. Those make the graph navigable without turning Quill into an IDE.

What is generated is the **reference**: names, kinds, signatures, parameter tables, doc comments, relationships, schema, and a clean page to read them on. What stays human is the **guide**: purpose, behaviour, expectations, trade-offs, examples, runbooks, and decisions. Quill links the two rather than pretending one can replace the other.

```text
repository / CI ──index──▶  reference index  ◀──introspect── database
                                  │
              ┌───────────────────┼────────────────────┐
        generated pages       search + palette      document references
              │                   │                    │
         public site         docs and reference    backlinks + coverage
```

The feature is first-class, not a separate product bolted on: the same editor, reading components, search, permissions, themes, revisions, public site and export. It is an **optional capability per workspace**, because a workspace that documents a non-software process has no code to index.

### The PMS needs a map, not just a tree

A reference index of symbols and tables is necessary but not sufficient for a platform like the PMS. It answers "what is this?" and "what is it connected to?"; it does not answer "where do I start?" or "how does a booking become a stay?". So the feature has three layers:

- **The map** names the domain modules, what each is for, who owns it, and how the modules depend on each other. The PMS's map is the first thing a new developer opens.
- **The flows** are the narratives that cross modules: a booking, a cancellation and refund, a check-in and check-out, a rate update, a night audit. Each step points at the exact symbol, table or guide it happens in.
- **The reference** is the complete, searchable, generated layer underneath: every module, type, function, table and column, with signatures, relationships and source provenance.

The map is curated, the flows are written, and the reference is generated. A novice follows the map and the flows; a senior jumps into the reference and the graph. Neither is a separate product, and none of the three is a dead end into the others.

The PMS already has the seeds of all three, which is why it is the prototype rather than a hypothetical:

- **The reference:** `scripts/code-index/` (design `docs/design/developer-docs.md`, spike `docs/research/code-index-spike.md`) indexes TypeScript with the compiler's own API, caches by blob SHA, and writes a searchable local HTML page. `pnpm code:index` builds it in 17 seconds cold and 1.2 seconds warm over the whole non-UI repository (9,103 symbols). It covers two packages today, not all of them, and not the database.
- **The docs:** `docs/design/quill-docs.md` and the prototype's ADR-0150 already decide that Quill serves the repository's docs from an internal instance and a public/customer instance at the prototype's developer domain, with `docs/quill.yaml` as the source manifest and `pnpm docs:check` enforcing the audience boundary.
- **The map:** `docs/product.md`, `docs/design/modules.md` and `packages/control-plane/src/modules.ts` already name the modules, the core, and the access model. The map manifest is the missing link between those names and the code and tables.

This idea is the hosted, cross-linked layer that connects them; it does not replace the local index or the docs plan.

### What it is not

- Not an editor, an IDE, or a code search engine over full file contents.
- Not a replacement for TypeDoc, rustdoc, Dokka, Doxygen, SchemaSpy or dbdocs. It imports their output where that is the best available extractor, and adds what they do not have: prose, permissions, cross-links, freshness and one search.
- Not AI-generated prose. Doc comments come from the code; guides come from people. The index supplies structure, not opinion.
- Not a database client. It reads metadata, never rows.
- Not a reason to store source code in Quill. It stores declarations, doc comments, locations and relationships.
- Not a page per function. That is how API references become unusable; see section 8.4.

## 3. Who it serves

| Persona | What they can do that they cannot do today |
| --- | --- |
| **New developer** | Orient in an unfamiliar service from one page: what it does, its entry points, the tables it touches, and the guide to read first. |
| **Working developer** | Find an exact symbol, signature and source location in two keystrokes without leaving the docs. |
| **Backend or data engineer** | Browse the schema, see foreign keys, understand a column, and find the code model that owns it. |
| **Technical writer** | Reference a type, a function or a table once; keep the prose, and be told when the code moves under it. |
| **Tech lead or API owner** | See public API coverage, assign documentation work, and stop a release with an undocumented breaking change if the team chooses. |
| **Documentation reviewer** | See the code and schema a page depends on, and whether those dependencies changed, before publishing. |
| **Open-source maintainer** | Publish a polished, searchable API reference for each release, cross-linked to the guides, from the same repository and CI. |
| **External developer** | Read the public reference with no account, copy a signature, follow a guide, and pick the right version. |
| **Instance or workspace administrator** | Connect a repository or a read-only database safely, preview exactly what will be indexed, and audit exposure. |
| **Integrator** | Produce the index in CI with the project's own toolchain and upload it, without giving Quill the toolchain or the source. |
| **Support engineer** | Search a table or column name and reach the service, the guide and the owner. |
| **Data analyst** | Read a maintained data dictionary and export it, without asking an engineer to write one. |

Two people are deliberately absent: the reader who just wants the guide (they get the guide, with a "Reference" link if they want it), and the person who wants a database UI (not this product).

## 4. User stories

The stories are the specification. Each one names the person, the moment, the flow, and what acceptance means. The phase column says when the story can be true, not when it is scheduled; section 13 proposes the order.

### 4.1 Story map

| # | Persona | Story | Phase |
| --- | --- | --- | --- |
| CD-01 | New developer | I want to understand a service well enough to make my first safe change. | 1 |
| CD-02 | Any developer | I want to find a symbol by an exact name, a half-remembered name, or a plain-English phrase. | 1 |
| CD-03 | Experienced developer | I want the exact signature, source location and type relationships, with the detail folded away until I ask. | 1 |
| CD-04 | Writer | I want to reference a symbol in a guide without copying its signature by hand. | 1 |
| CD-05 | Writer | I want to embed a signature or an exact source excerpt, pinned to a revision. | 1 |
| CD-06 | Writer | I want to say "this page is the explanation for this symbol", so readers and coverage know. | 1 |
| CD-07 | Writer or reviewer | I want to be told when a referenced signature changed since the page was published. | 1 |
| CD-08 | Writer | I want references to survive a rename or a move, or to be told clearly that they did not. | 1 |
| CD-09 | Reader | I want to follow a reference, understand it in place, and come back to the guide. | 1 |
| CD-10 | Tech lead | I want to see which public API is undocumented and create the guides that are missing. | 1 |
| CD-11 | Backend engineer | I want to browse tables and columns, their keys and relationships, and copy the DDL. | 1 |
| CD-12 | Backend engineer | I want to see which code model maps to a table, and whether the mapping has drifted. | 2 |
| CD-13 | Data analyst | I want a data dictionary with descriptions, owners and an export. | 2 |
| CD-14 | Tech lead | I want a drift report when the code, migrations and database disagree. | 2 |
| CD-15 | Open-source maintainer | I want to publish a public API reference for a release, with versions and guides. | 2 |
| CD-16 | External developer | I want to search, read, copy and navigate the public reference with no account. | 2 |
| CD-17 | Administrator | I want to connect a repository and a read-only database, previewing exactly what is exposed. | 1 |
| CD-18 | Integrator | I want to produce the index in CI and upload it, with no source access for Quill. | 2 |
| CD-19 | Reader | I want to export, print and read offline, with the reference included. | 2 |
| CD-20 | Keyboard or mobile reader | I want the same explorer, pages and search without a mouse or a wide screen. | 1 |
| CD-21 | Documentation reviewer | I want to see a page's code and schema dependencies before I approve it. | 2 |
| CD-22 | Maintainer | I want to acknowledge a change I have reviewed so the alert stops, without rewriting the page. | 2 |
| CD-23 | New lead | I want a map of the codebase's undocumented areas, owners and most-referenced symbols. | 2 |
| CD-24 | Any developer | I want the reference to include a type used only in a signature, even if no page links it yet. | 1 |
| CD-25 | Maintainer | I want the code host to tell me which guides a pull request affects. | 3 |
| LK-01 | New developer | I want to understand how a change reaches Airbnb and Booking.com, and what I touch. | 1 |
| LK-02 | New developer | I want a first-week path through the PMS, not a two-thousand-page reference. | 1 |
| LK-03 | Senior developer | I want to change pricing without breaking seasons, taxes, the stored quote or channel sync. | 1 |
| LK-04 | Senior developer | I want to see every module, table and flow that depends on a table before I migrate it. | 2 |
| LK-05 | Support engineer | I want to go from a stuck booking to its trace, flow, module, table and owner. | 1 |
| LK-06 | New developer | I want to know which tables a module owns, which store they live in, and which are read-only. | 1 |
| LK-07 | Data analyst | I want to understand a booking's status, money and clash history, and the code that enforces them. | 2 |
| LK-08 | Writer | I want to document a PMS flow as ordered steps that link to code and tables. | 1 |
| LK-09 | Tech lead | I want to see which PMS modules have no overview, stale guides or unowned tables. | 1 |
| LK-10 | On-call engineer | I want to go from a production error to the module, trace, runbook, table and owner. | 1 |

### 4.2 Story cards

The cards follow the shape of `docs/product/use-cases.md`, so these can graduate into that file when the idea is promoted.

#### CD-01 — Orient in an unfamiliar service

- **Persona:** new developer, first week.
- **Situation:** asked to add an idempotency key to a payment endpoint. They know the product, not this service.
- **Job:** understand the service's shape, its entry points, the tables it touches, and the one guide to read before changing anything.
- **Phase:** 1. **Surfaces:** Reference home, package page, symbol page, reading view.

**Flow**

1. The workspace's Reference home shows the sources it reads, how fresh each is, and the packages with the least documentation.
2. They open the `payments` package. The page opens with the team's overview guide, because a document claims the package (CD-06), followed by the package's public types and functions.
3. They open `PaymentService`. The summary comes from the code's doc comment; the "Read first" block links to the team's retry guide; the member list shows `capture`, `refund` and the `PaymentGateway` interface it implements.
4. They follow "Writes to" and land on `payments.intents` and `payments.refunds`, with the columns and the model that writes them.
5. They follow "Source" to the exact lines at the indexed commit, and "Used by" to the two other services that call it.

**Acceptance**

- Given a package in the index, when it is opened, then its documented overview is shown before generated detail, and a package with no overview says so with a "Write the overview" action.
- Given a public symbol with a doc comment, when its page is read, then the summary, signature, parameters, return type and source location are present without opening the repository.
- Given a table referenced by a code model, when either page is read, then the relationship is shown in both directions.
- Given a reader without access to a private symbol, when they open a package, then that symbol is absent from the list, the counts and search, not shown as a locked row.
- Given any generated page, when it is read, then it says which source, commit and time it was generated from.

**Edge cases:** a monorepo with two packages of the same name (the source and path disambiguate); a package with 400 members (grouped, paginated, searchable within the package); a symbol whose doc comment is empty (an honest "No description in the code" and a CTA, never a blank section); a stale source (a banner with the age and a "Sync now" action for a manager).

#### CD-02 — Find a symbol fast

- **Persona:** any developer, in a hurry.
- **Situation:** a stack trace names `PaymentGateway.capture`, or they remember "the thing that retries payments".
- **Job:** reach the right symbol in one search, without knowing which package it lives in.
- **Phase:** 1. **Surfaces:** command palette, search page, Reference explorer.

**Flow**

1. `Ctrl/Cmd + K`, then `capture`, `PaymentGateway.capture`, `payments capture`, or `@capture` to scope to code and schema.
2. Results are grouped: exact symbol name first, then prefix matches, then matches in the qualified name or doc comment, then documents. Each symbol result shows its kind, package, one-line summary and a signature fragment.
3. Arrow keys move; Enter opens the symbol at its canonical location; `Ctrl/Cmd + Enter` opens the source; Escape returns focus to where they were.
4. Typing a misspelling (`paymnet gatway`) still finds it through trigram matching, with the matched text marked.

**Acceptance**

- Given an exact qualified name, when searched, then it is the first result, regardless of recency or package.
- Given a partial name in snake_case, camelCase or kebab-case, when searched, then the same symbol is found.
- Given a query with no symbol match, when documents match, then the document results are still shown and the empty code group is not rendered.
- Given no result at all, when the query is settled, then the page suggests removing filters, broadening the words, or searching all workspaces, and never offers a dead link.
- Given a keyboard-only user, when the palette is open, then every result and action is reachable, announced and visibly focused.
- Given a user without access to a workspace, when they search, then neither its symbols nor their names appear.

**Edge cases:** two symbols with the same short name in different packages (both shown with their package); a deprecated symbol (marked "Deprecated", still findable, ranked below a live one when scores tie); a symbol only in an unindexed branch (not found, and the search page says which snapshot it searched).

#### CD-03 — Read a signature and understand a type

- **Persona:** experienced developer.
- **Situation:** they need the exact contract, not a tutorial.
- **Job:** see the signature, generics, inheritance, members, deprecation and source in one place, with the novice explanation out of the way.
- **Phase:** 1. **Surfaces:** symbol page.

**Flow**

1. The page leads with the qualified name, kind, visibility and provenance. The summary is one paragraph.
2. The signature is a syntax-highlighted code block with a copy button. For a function, a parameter table follows: name, type, required, default, description from the doc comment.
3. "Advanced" reveals type parameters, decorators, implemented interfaces, inherited members and the full source path. It is a disclosure, not a separate mode.
4. Members are listed with anchors. Inherited and private members are folded by default and can be shown.
5. Examples in the doc comment are rendered as code blocks with copy; `@deprecated`, `@throws` and `@see` become the platform's callouts and links, not raw tags.

**Acceptance**

- Given a generic type, when the page is read, then its type parameters and constraints are shown in the signature and explained in a table.
- Given a deprecated symbol, when the page is read, then a deprecation notice says what to use instead and since when, and the notice is not conveyed by colour alone.
- Given a class with 200 members, when the page is read, then the first screen is still the summary and signature, the member list is paginated or virtualised, and the page's initial payload is bounded.
- Given a reader who does not care about implementation detail, when they never open "Advanced", then they never see it.
- Given a signature the highlighter does not know, when it is rendered, then it is shown as plain code, never as broken markup.

#### CD-04 — Reference a symbol in a guide

- **Persona:** writer.
- **Situation:** explaining retry behaviour and wanting to point at `PaymentService.capture` without pasting a signature that will drift.
- **Job:** insert a reference that reads well, links correctly, and survives editing and export.
- **Phase:** 1. **Surfaces:** editor, reading view, export.

**Flow**

1. Type `/code`, or use the "Insert reference" action, and search the same index as the palette.
2. Choose how it appears: an inline reference, a signature card, a source excerpt, or a table card. The default for an inline reference is the symbol's short name; the default for a block is a pinned signature.
3. The editor writes the directive with the display text and the entity's stable reference. The preview shows exactly what the reader will see.
4. The chip is a normal inline node: it moves, copies, cuts and undoes like text. The block is a normal block with a menu.
5. In Markdown, the directive degrades to the display text and, for a block, a readable line naming the entity and its location.

**Acceptance**

- Given a symbol reference, when the document is serialised and reopened, then the directive, its display text, its options and any unknown attributes are byte-identical.
- Given a document read outside Quill, when the directive is unknown, then the reader sees the symbol's name (and, for a block, a readable source line), not a blank or a `:::` line.
- Given a reference to a symbol the reader cannot see, when the document is read internally, then the chip is not linked and says the symbol is unavailable, without leaking its signature.
- Given a published page, when its cached body is served, then the reference is a slot with a readable fallback; the current metadata is filled at page assembly, and the body's cache key does not change when the index advances (ADR-031, ADR-032).
- Given an author who pastes a symbol name instead of using the picker, when the editor recognises an unambiguous match, then it offers to turn it into a reference; it never rewrites the author's text silently.

#### CD-05 — Embed a signature or an exact source excerpt

- **Persona:** writer, usually in an ADR, a security note or a migration guide.
- **Situation:** the reader must see the exact contract that was agreed at a revision, and the quote must not drift.
- **Job:** embed a signature or a line range pinned to a commit, with copy and a link to the source.
- **Phase:** 1. **Surfaces:** editor, reading view, export, public site.

**Flow**

1. `/code` → choose a symbol → "Signature card", or choose "Source excerpt" and a line range.
2. The block writes the entity reference, the snapshot's commit, and the range. The editor shows the signature or the lines, with the language, a copy button and "View at this commit".
3. A floating variant ("Follow the current version") is offered with a visible warning that the quote can change; it is never the default in an ADR or a security document.
4. On publish, the rendered block is stored in the body as a static fallback with its provenance, so export, print and a reader without JavaScript see the quote and the commit.
5. If the pinned revision is no longer in the source's history, the block says so and links to the nearest available commit; it never renders an empty code block.

**Acceptance**

- Given a pinned excerpt, when the index advances, then the excerpt does not change and continues to name its commit.
- Given a floating excerpt, when the index advances, then the block updates at page assembly, shows "as of <commit>" and can be converted to pinned in one action.
- Given an exported page, when it is opened without Quill, then the excerpt, its language, its commit and a link to the source are present.
- Given a source excerpt in a private repository, when a reader lacks source access, then the policy decides whether the excerpt is shown as documentation or withheld; the page never shows a broken block.

**Note:** this extends M5's source references rather than inventing a second snippet mechanism; the index supplies the entity and the default range, and the existing provider fetches the bytes at the commit.

#### CD-06 — Make a page the explanation for a symbol

- **Persona:** writer or tech lead.
- **Situation:** the team has a guide called "Payment retries" that is the real explanation of `PaymentService.capture`.
- **Job:** claim the symbol so readers reach the guide first and coverage counts it.
- **Phase:** 1. **Surfaces:** document properties, symbol page, coverage.

**Flow**

1. In the document's properties, "Documented entities" opens the same picker. The writer chooses `PaymentService` and `payments.intents` and saves.
2. The values are written to front matter as `covers:`, so they round-trip through Git and export, and are visible in the properties panel, not in the body.
3. The symbol page shows "Read first: Payment retries" at the top, before the signature, with the doc's owner and last-updated time.
4. The guide shows a quiet "Covers: PaymentService" line in its byline, linking back.
5. If two pages claim the same symbol, the symbol page lists both, marks the older claim, and offers a manager the choice of which is primary. It never hides one.

**Acceptance**

- Given a page that covers a symbol, when the symbol page is read, then the page is linked as the primary explanation and the claim is visible on both sides.
- Given two primary claims, when the symbol page is read, then both are shown and the conflict is reported in the coverage list, not silently resolved.
- Given a page with `covers` front matter, when it is exported or synced, then the field survives and an older reader ignores it without error.
- Given a reader who can read the symbol but not the guide, when the symbol page is read, then the guide is not named.
- Given a page that covers a table, when either page is read, then the relationship is shown in both directions.

#### CD-07 — Keep references honest

- **Persona:** writer, reviewer, or the person on release duty.
- **Situation:** the signature of a documented function changed three weeks ago; the guide still says it takes a string.
- **Job:** see that the guide may be wrong, decide whether it is, and clear the warning without editing prose that is still correct.
- **Phase:** 1. **Surfaces:** document header, reading view, review, coverage inbox, notifications.

**Flow**

1. A publish stamps every reference with the signature and doc-comment hashes it saw.
2. A later index snapshot changes a signature. The outbox consumer marks each document that references it as "signature changed since publish", with the old and new signature available as a diff.
3. The document shows a quiet badge in the header and beside the affected reference: "Signature changed". The reading page is not blocked. A public page shows nothing about the internal review state.
4. The author opens the change, reads the diff, and chooses "Update the reference" (refresh the rendering and the stamp) or "Still accurate" (acknowledge this hash, with an optional note).
5. The coverage inbox lists the affected pages by source and package, with bulk actions. Acknowledged changes stop alerting until the next signature change.
6. At publish, if a reference is stale or missing, the publish dialog warns with the exact references. It does not block by default; a workspace policy can make it block for chosen packages.

**Acceptance**

- Given a changed signature, when the document is opened, then the badge names the entity and links to the diff; the body still renders.
- Given "Still accurate", when the same signature changes again, then the alert returns.
- Given a doc-comment-only change (no signature change), when the doc is opened, then it is reported as "Description changed" at a lower severity, because the prose may quote the old description.
- Given no change, when a snapshot is rebuilt identically, then no document is marked stale.
- Given a reader of the public site, when a reference is stale internally, then the public page shows the current rendered signature (if floating) or the pinned one, and never an internal warning.

**What cannot be checked:** whether the prose still describes the behaviour correctly. Quill reports the change and gives the author the diff; it never claims the page is accurate.

#### CD-08 — Survive a rename or a move

- **Persona:** writer, after a refactor.
- **Situation:** `PaymentService` became `PaymentProcessor`, or moved from `payments` to `billing`.
- **Job:** have references keep working, and know when they cannot.
- **Phase:** 1. **Surfaces:** document reference, coverage inbox, editor.

**Flow**

1. The indexer compares snapshots. A rename is detected from the language server or compiler index where available, from Git's rename detection, and from signature similarity. Each rename is recorded as an alias from the old moniker to the new one, with a confidence.
2. A reference that resolved to the old moniker resolves through the alias. The rendered name updates to the new one, and the page shows "Formerly `PaymentService`" in the reference's details.
3. A low-confidence rename is queued for review: the writer sees the old and new signatures side by side and confirms or rejects. Confirming updates the aliases for every reference to that entity.
4. A reference whose entity was deleted, not renamed, becomes "Missing". It keeps its display text, stops linking, and appears in the coverage inbox with "Find a replacement". Nothing silently turns into a 404.
5. Anchors follow the same rule: an old symbol URL redirects to the new one, or answers a clear "This symbol was renamed" with the new address, never a generic 404.

**Acceptance**

- Given a confirmed rename, when a reader follows an old symbol link, then it lands on the new symbol and says it was renamed.
- Given an ambiguous rename, when the writer opens the reference, then they are asked, and no text is rewritten until they choose.
- Given a deletion, when the document is read, then the reference is plain text with a "Missing" state; the page still renders.
- Given a rename across a package, when the symbol's canonical address changes, then the old address is kept as an alias for the retention period.

#### CD-09 — Follow a reference and come back

- **Persona:** reader.
- **Situation:** reading a guide, sees `PaymentService.capture` and wants the exact contract, then wants to continue.
- **Job:** understand the reference in place, or open it without losing the guide.
- **Phase:** 1. **Surfaces:** reading view, symbol page, browser back.

**Flow**

1. The chip shows the kind icon and the name. Focus or hover shows a card with the summary, signature fragment and "Used in 3 guides".
2. Clicking opens the symbol at its canonical location. The guide stays in the reader's back stack; the symbol page has a "Back to Payment retries" trail when it was reached from a guide.
3. The symbol page's "Documented in" section lists the guide and any other pages, with a one-line excerpt and the section anchor.
4. On a phone, tap opens the page; there is no hover-only information. The card is reachable by focus and has a visible close/back behaviour.

**Acceptance**

- Given a reference, when it is focused, then the card is reachable by keyboard and its content is also on the symbol page.
- Given a reference to a symbol with no doc comment, when the card opens, then it says "No description in the code" and still offers the signature and source.
- Given a reference in a shared link or public page, when it is clicked, then it stays inside what that reader may see, or is plain text if the target is not available.
- Given a reader who returns, when they use Back, then they land at the exact paragraph, not the top of the guide.

#### CD-10 — Document a public API surface

- **Persona:** tech lead or API owner.
- **Situation:** a library is about to be released and half its exported types have no guide.
- **Job:** see the gap, create the right pages, assign owners, and decide whether the release gate should care.
- **Phase:** 1 for the report and stubs; 2 for gates and ownership integration.
- **Surfaces:** coverage dashboard, template picker, document properties, CI.

**Flow**

1. The coverage page filters to exported symbols in chosen packages. It shows "documented" (a page claims it), "mentioned" (a page references it), and "neither", with counts by package.
2. The lead selects a cluster of related symbols and creates a **guide** from a template: the template receives the symbol's name, signature, parameter table and doc summary as starting content, plus a `covers` claim for the cluster. It is a scaffold, not prose.
3. The default recommendation is one guide per cohesive area, not one page per symbol. The UI says how many symbols the new page would cover and warns when a page covers too broad a set.
4. The lead assigns an owner and a review date using the existing ownership and lifecycle properties.
5. Optionally, CI runs `quill check --docs-coverage` (a later addition) with a threshold for the public surface, so a release fails when a new public symbol has no guide. The gate is opt-in per workspace and per package.

**Acceptance**

- Given a coverage report, when it is opened, then the numbers are derivable from the same references the pages show, not a second hand-maintained list.
- Given "create a guide", when it is confirmed, then the page exists, claims the chosen symbols, and is clearly a draft with placeholders; nothing is published automatically.
- Given a symbol that is mentioned but not claimed, when coverage is read, then it is counted separately from "documented", so a passing mention cannot game the gate.
- Given a public symbol excluded from the public surface, when coverage is read, then it is not counted in the public percentage.
- Given a release gate, when a new exported symbol is added without a guide, then the failure names the symbol and the package, and links to the scaffold action.

#### CD-11 — Browse a database schema

- **Persona:** backend or data engineer.
- **Situation:** a support ticket mentions `intents.status`; the engineer needs its type, allowed values, indexes and relationships.
- **Job:** reach the column and understand it without opening a database client.
- **Phase:** 1. **Surfaces:** schema explorer, table page, column anchor, search.

**Flow**

1. Reference → Schemas → `payments`. Tables and views are listed with their comments and a row count only if the source allows it (never by default).
2. The table page shows columns in order: name, type, nullability, default, key, description. Primary, unique and foreign keys are marked in words as well as icons.
3. Relationships are a list and a diagram: "Many `intents` → one `customers`". The diagram is optional and has an accessible list fallback.
4. A column anchor is linkable and searchable; the column page or the table anchor shows which code models and guides reference it.
5. "Copy DDL" copies the table definition; "Download data dictionary" exports CSV or Markdown for the current scope.

**Acceptance**

- Given a table, when it is opened, then every column has its type, nullability and default, and the description comes from the database comment or the linked guide, with its source named.
- Given a foreign key, when either table is opened, then the relationship is shown in both directions with its cardinality.
- Given a database the reader cannot introspect, when they browse, then they see only the indexed snapshot they are permitted to see, never a live connection.
- Given a column with no description, when it is read, then it says "No description" and offers "Add one" to someone who can edit the owning guide.
- Given a narrow screen, when a table is read, then it scrolls horizontally inside its region and the page itself does not.

#### CD-12 — Connect a code model to a table

- **Persona:** backend engineer.
- **Situation:** the ORM says `PaymentIntent` maps to `payments.intents`, but nobody knows if that is still true.
- **Job:** see the mapping, its source, and whether the code and the database agree.
- **Phase:** 2. **Surfaces:** symbol page, table page, drift report.

**Flow**

1. When the code index includes ORM metadata (Drizzle, Prisma, SQLAlchemy, Django, Hibernate, EF Core), the indexer emits a `maps-to` edge from the model to the table, with the evidence (`@Entity`, `__tablename__`, a Prisma model, a Drizzle table definition).
2. The symbol page shows "Table: payments.intents" and the reverse appears on the table page as "Modeled by: PaymentIntent".
3. A manual mapping can be added for a codebase whose ORM the indexer does not read; it is stored as a relationship with an owner and a note, not as code.
4. Drift checks compare the model's declared fields with the table's columns. A missing column, a type mismatch or a nullable mismatch is reported with the model, the table and the evidence.
5. The drift report never blocks a publish by default; it is a signal in the coverage inbox and can be made a CI gate.

**Acceptance**

- Given an ORM mapping, when either side is opened, then the other side is linked and the evidence names the file and line that declares it.
- Given a manual mapping, when the table is renamed, then the mapping is reported as broken rather than silently redirected.
- Given a type the adapter cannot compare (a custom type, an enum), when drift is computed, then it is reported as "unchecked", not as a mismatch.
- Given no mapping, when the table is opened, then no code model is guessed from a similar name. Guesses are not evidence.

#### CD-13 — Read and export a data dictionary

- **Persona:** data analyst or backend engineer.
- **Situation:** an audit or a new team needs the meaning of every column in a schema.
- **Job:** read a maintained dictionary with owners, descriptions and sensitive-data markings, and export it.
- **Phase:** 2. **Surfaces:** schema home, table pages, export.

**Flow**

1. The schema home shows coverage: tables with a description, columns with a description, tables with an owning guide.
2. Descriptions come from database comments first, then a linked guide's column section, then the code model's doc comment. The source is always named so a reader knows how much to trust it.
3. A table or schema exports to Markdown, CSV or JSON with the same fields, a snapshot time and a source name. Nothing is exported that the reader cannot see.
4. Owners come from the linked guide or the source's configured owner; they are never inferred from a commit author.

**Acceptance**

- Given a column with no description anywhere, when the dictionary is exported, then it is marked "undescribed" rather than omitted.
- Given a description in both a database comment and a guide, when the page is read, then the guide's prose is shown as the primary explanation and the database comment as the source's own note, or the conflict is made explicit; one is never silently overwritten.
- Given an export, when it is opened outside Quill, then it carries its snapshot and source, so a reader knows it is a point-in-time copy.

#### CD-14 — Publish an open-source API reference

- **Persona:** maintainer.
- **Situation:** a library releases v2.4; the README is good, the API reference is a separate static site that lags, and the guides do not link into it.
- **Job:** publish the reference for the release, with the guides, search, versions and no manual copying.
- **Phase:** 2. **Surfaces:** workspace settings, public site, release process.

**Flow**

1. The repository is connected as a source (ADR-061) or indexed by CI (CD-18). Tags are indexed as snapshots; the default public version is chosen (for example `latest`, `v2.4`, `v2`).
2. The public surface is a filter: exported symbols only, chosen packages, optional path hiding, and a review of the generated pages before publishing.
3. The public site gains a Reference section with package pages, promoted symbol pages, schema pages if the project has one, search scoped to the site, and a version selector.
4. Guides link into the reference with `:code[...]`; reference pages link back to guides. A guide can be marked as the primary explanation for a symbol (CD-06).
5. On a release, a new snapshot is indexed from the tag. The version selector offers the new version; old versions remain addressable. The sitemap lists documented pages and the chosen versions, not every symbol anchor.

**Acceptance**

- Given a public source, when a page is published, then it never contains a symbol outside the chosen public surface, a private guide, a private repository URL or an internal comment.
- Given a release tag, when it is indexed, then the public version selector can open it, and the default version's links are canonical.
- Given a generated page with no doc comment and no guide, when it would be thin, then it is not added to the sitemap and carries `noindex`, while still being reachable from its package page.
- Given a version that is no longer supported, when a reader opens it, then the page says so and offers the supported version.
- Given a reader with no account, when they open the reference, then it is server-rendered, complete in the first response, and searchable without JavaScript for the initial result set.

#### CD-15 — Connect sources safely

- **Persona:** instance or workspace administrator.
- **Situation:** the team wants its private repository and its staging database indexed, and security wants to know exactly what leaves them.
- **Job:** connect, preview, limit and audit without giving Quill more than it needs.
- **Phase:** 1. **Surfaces:** settings, source preview, audit.

**Flow**

1. Add a code source: repository, branch, credential (GitHub App installation or deploy token), and the paths to index. The same hardening as ADR-061 applies: partial clone, sparse checkout, no lazy fetch, SSRF policy, no shell.
2. Add a schema source: a read-only connection string or an uploaded DDL/ORM artifact. The connection is tested with a schema-only query; the form says which catalogs will be read and that no rows will be.
3. "Preview" runs the indexer in a disposable directory and shows counts by language and package, the paths that will be skipped, the tables and columns found, the doc-comment coverage, and every problem. It writes nothing.
4. The admin chooses visibility: workspace members, or a public surface with an explicit allowlist and a review of every promoted page.
5. Every change is audited; a failed sync or index never affects reading published docs.

**Acceptance**

- Given a preview, when it finishes, then it shows exactly which paths and schemas would be exposed, and saving is the only action that persists anything.
- Given a read-only database role, when the indexer runs, then it issues only catalog queries and fails closed on anything that would read a row.
- Given a credential, when it is stored, then it is a product secret (ADR-034), never in logs, settings files, URLs or error bodies.
- Given a source with a file outside its indexed paths, when the index runs, then the file's contents and symbols are absent from the index and the search results.
- Given an index failure, when readers open documents, then the last good snapshot continues to serve and the source page says the index is stale.

#### CD-16 — Produce the index in CI

- **Persona:** integrator or platform engineer.
- **Situation:** the repository needs compilers, generated code and private package registries that Quill's server should not have.
- **Job:** run the indexer in the project's own CI and upload a validated artifact.
- **Phase:** 2. **Surfaces:** CLI, CI, API.

**Flow**

1. `pnpm add -D @quill/cli` (ADR-062's tool) and run `quill index --format code-index --out .quill/index.jsonl.gz`. The command uses the project's installed compiler or language tool, so the result matches what the project builds.
2. For a schema, `quill index schema --from prisma` or `--from drizzle` reads the checked-in schema; or the server introspects a read-only database.
3. The artifact is uploaded with a scoped token. The server validates the format version, size, counts and signature, then ingests it idempotently. Re-running the same commit is a no-op.
4. A failure prints the file, line and reason and exits non-zero, so the build fails before a broken index is published.
5. The upload can be a release step or part of `quill check`, depending on the team's policy; the index never writes to the repository.

**Acceptance**

- Given the same commit and indexer version, when the artifact is uploaded twice, then the second upload produces the same snapshot and no duplicate entities.
- Given a malformed artifact, when it is uploaded, then it is rejected with a message naming the first invalid record, and the previous snapshot stays current.
- Given a private repository, when CI uploads, then Quill receives only the artifact, not the repository or its credentials.
- Given a new artifact format version, when an older server reads it, then the server refuses with a supported-version message rather than guessing (ADR-033).
- Given a large monorepo, when the artifact exceeds the limit, then the CLI shards by package or source and uploads each shard, and the server assembles one snapshot.

### 4.3 The PMS: the first prototype

The PMS is a two-way synchronisation platform between vacation-rental distribution platforms (Airbnb, Booking.com, Vrbo, Google Vacation Rentals) and a property management system. It is **level-triggered**: it compares what each site *should* hold with what it last accepted, and sends only the difference. That loop, the bookings that arrive from the sites, and the schema underneath them are the domain a new developer has to learn.

The prototype is organised around the three questions a new person actually asks: **what is this for?** (the map and the module overviews), **what does it do?** (the guide, the symbol page and the flow), and **how does it connect?** (the flows, the dependency graph and the schema relationships). The same three questions are what a senior developer asks before a change, which is why one design serves both.

It succeeds if a new developer can answer **"how does a change reach every site, and what do I touch?"** and a senior developer can answer **"what are the invariants here, who owns it, and what breaks if I change it?"** Both from the same pages, without a meeting.

#### 4.3.1 The scale, measured

| Fact | The PMS today |
| --- | --- |
| Codebase | Node 26, TypeScript, pnpm monorepo: **59 packages**, **6 apps**, **181 SQL migrations** |
| Docs | **493 Markdown files** (21 MB): **164 ADRs**, 115 design docs, 47 stories, research, legal, security, handovers |
| Data | **197 tables** in the tenant database, 22 in the support store, 25 in telemetry, 3 in diagnostics, about 30 in the control plane: roughly **277 tables across five Postgres stores** |
| Product modules | **7 in the registry** (`core`, `privacy`, `support`, `hotels`, `voice`, `finance`, `crm`); operations, managed services and sites are product add-ons not all in the registry yet |
| Existing code index | `pnpm code:index` over the whole non-UI repository: **9,103 symbols**, 17 s cold, 1.2 s warm, 8.5 MB JSON, 8.1 MB HTML; two scoped packages give 568 symbols and 457 exports, **30% of exports without a description** |
| Existing docs plan | `docs/design/quill-docs.md` and the prototype's ADR-0150 decide Quill serves the docs; `docs/quill.yaml` is the source manifest; `pnpm docs:check` enforces the audience boundary |

The index is a **local prototype** today. `docs/design/developer-docs.md` is explicit: it runs on an engineer's machine, into a git-ignored cache, with a static search page. It is two packages deep (`packages/domain`, `packages/calendar`), TypeScript only, with no class members, no `@see`/`{@link}` graph, no database, and no Quill. That is the starting point, not the finished feature.

#### 4.3.2 What exists, and what this idea adds

| Seed in the PMS | What this idea adds |
| --- | --- |
| `scripts/code-index/` — compiler API extraction, blob-SHA cache, public surface, search, page, failure kept beside the last index | A portable indexer over every package and app; members and links; a versioned artifact; hosting, permissions and search in Quill |
| `docs/design/developer-docs.md` — the guide layer, the docblock convention, the rules, DV-8 and DV-9 | Two-way references from guides to symbols; coverage and staleness; a hosted reference; the schema half |
| `docs/design/quill-docs.md` and ADR-0150 — Quill as the viewer, two instances, audience by directory, `docs:check` | A Reference area on the **internal** instance; a map and flows; code and schema pages; backlinks from the docs |
| `docs/product.md`, `docs/design/modules.md`, `packages/control-plane/src/modules.ts` — the module catalogue and access model | A reviewed map manifest that binds modules to paths, tables, guides and flows; module pages and coverage |
| `packages/persistence/src/migrations/` and `src/schema/schema.ts` — 181 forward-only SQL migrations and hand-written Kysely types | A schema index over migrations, the live catalog or both; table/column pages, keys, relationships, ownership and drift |
| `docs/design/booking-trace.md`, `docs/design/timeline.md`, `docs/design/observability.md` — traces and timelines | Flows as first-class documents, with every step linked to the symbol and table that implements it |
| `pnpm docs:check` — links, audience, leak patterns, manifest coverage | The same discipline for reference links: a broken symbol or table reference fails the check |

`docs/design/developer-docs.md` says its build steps 1, 2 and 5 are built (the README check, the local index, and the page), while the docblock convention (step 3) and the guide layer (step 4) are not. The reference can start before step 3 because the index already reads descriptions and tags; the coverage report makes the missing descriptions visible, which is the evidence step 3 needs. The design's open question "where the search lives later — the static site, Quill, or both" is answered by the internal Quill instance, while `pnpm code:index` stays as the inner loop for an engineer's machine.

The design also records the owner's ruling of 2026-10-25 that the index runs **locally only, for now**, to keep running costs low. Hosting it in the internal Quill instance is the new decision this idea proposes; the local command and the artifact remain, and the hosted layer adds no compiler run per request because the artifact is built once per snapshot.

#### 4.3.3 The real modules

The top level is the registry, not an invented grouping: `core`, `privacy`, `support`, `hotels`, `voice`, `finance`, `crm`. The core is large enough to need sub-maps, so the map has two levels.

**Top-level modules**

| Module | What it is | Representative tables | Guides |
| --- | --- | --- | --- |
| **Core** | Properties, calendars, prices, bookings, guests, channels, owners; the account, people, roles and keys; the task model and activity | The core sub-domains below | `docs/overview/`, `docs/guide/architecture.md`, `docs/product.md` |
| **CRM** (owner acquisition) | Parties, enquiries, deals, pipelines, fields and views | `crm_party`, `crm_inquiry`, `crm_deal`, `crm_deal_fact`, `crm_field`, `crm_pipeline` | `docs/design/crm.md`, `docs/design/owner-acquisition.md` |
| **Finance** | The ledger, books, periods, bank matching, payouts and owner statements | `finance.journal`, `finance.posting`, `finance.ledger_account`, `finance.period`, `finance.bank_line`, `payout`, `payout_line` | `docs/design/finance.md`, `docs/design/finance-schema.md`, `docs/design/ledger-view.md` |
| **Support desk** | A customer's own request queue, with links to its bookings, properties and people | `desk.ticket`, `desk.message`, `desk.ticket_link`, `desk.clock`, `desk.workflow` | `docs/design/support.md`, `docs/design/support-screens.md`, `docs/design/tickets.md` |
| **Hotels** | A shape-bound module: room types, rooms left, rate plans and the hotel grid; no areas or seats of its own | The core's property, inventory and booking tables | `docs/design/inventory-shapes.md`, ADR 0007, ADR 0130 |
| **Voice** | Calls, queues, routing and the provider connection | `voice_call`, `voice_call_event`, `voice_call_sheet`, `voice_queue_item_event` | `docs/design/calls.md`, `docs/design/calls-platform.md` |
| **Privacy** | The data-subject request, access pack, erasure plan, retention and evidence | `privacy_request`, `privacy_request_event`, `privacy_access_pack`, `privacy_erasure_plan` | `docs/design/privacy.md`, ADR 0126, ADR 0146 |

**Core sub-domains**

| Sub-domain | What it is | Representative packages and tables | Guides |
| --- | --- | --- | --- |
| **Properties and inventory** | The one true property record: its shape, spaces, units, layout, amenities and photos | `packages/domain/src/{property,content,inventory}`, `property`, `unit`, `space`, `structure`, `amenity_answer`, `photo` | `docs/design/property-information.md`, `docs/design/inventory-shapes.md`, `docs/design/files-and-images.md` |
| **Calendar and availability** | What is open, held, blocked or sold, and how it rolls over | `packages/calendar`, `calendar_hold`, `block`, `occupancy`, `out_of_service`, `channel_blackout`, `closure_minute` | `docs/guide/concepts/slices-and-fingerprints.md`, ADR 0007, ADR 0044, ADR 0105 |
| **Rates and pricing** | Rate plans, seasons, rules, taxes, fees and the stored quote | `packages/pricing`, `pricing_configuration`, `pricing_rule`, `booking_tax_line`, `booking_money_reported` | `docs/design/pricing.md`, `docs/design/finance-rules.md`, ADR 0016, ADR 0032, ADR 0160 |
| **Bookings and guests** | The booking lifecycle, the guest party, amendments, cancellations and clashes | `packages/domain/src/booking`, `apps/api/src/features/bookings`, `apps/worker/src/reservations`, `booking`, `booking_clash`, `booking_revision`, `booking_party`, `channel_reservation`, `unplaced_reservation` | `docs/design/bookings-list.md`, `docs/design/clashes.md`, `docs/design/booking-trace.md`, `docs/design/hand-bookings.md` |
| **Channels and peers** | Every platform the PMS talks to, the connection, the listing mapping, the health and the credential | `packages/peers`, `packages/channels`, `packages/transport`, `channel_account`, `channel_listing`, `channel_health`, `platform_binding`, `peer_credential`, `found_listing`, `listing_match`, `ical_connection` | `docs/design/connecting.md`, `docs/design/platform-connections.md`, `docs/guide/concepts/peers-and-adapters.md`, ADR 0035, ADR 0036, ADR 0040, ADR 0043 |
| **Owners and ownership** | The owner record over time, the property relationship and the money owed | `packages/domain/src/ownership`, `owner`, `owner_person`, `ownership`, `payout`, `payout_line` | `docs/design/owners.md`, ADR 0067, ADR 0109 |
| **Account, people and access** | The account, its people, memberships, roles, entitlements, seats, keys and settings | `packages/control-plane`, `tenant`, `api_key`, `policy`, `setting_rule`; the control plane's `person`, `membership`, `account_module`, `module_seat` | `docs/design/auth.md`, `docs/design/modules.md`, ADR 0065, ADR 0100 |
| **Tasks, operations and workflows** | Housekeeping, maintenance, keys, service orders, calls and guided procedures | `packages/tasks`, `packages/workflows`, `packages/lifecycle`, `task`, `task_event`, `task_note`, `workflow*`, `voice_call` | `docs/design/tasks.md`, `docs/design/workflows.md`, `docs/design/managed-services.md`, `docs/design/calls.md` |
| **Activity, audit and events** | Every change, every request, the timeline, search and the change stream | `packages/events`, `packages/audit`, `packages/search`, `event`, `event_subject`, `audit_request`, `change_record`, `search_entry`, `job`, `notice` | `docs/design/timeline.md`, `docs/design/change-stream.md`, `docs/design/observability.md`, ADR 0163 |
| **Platform and reliability** | The reconciler, slices, fingerprints, drift, the transport and the job runner | `packages/sync-core`, `packages/engine`, `packages/transport`, `sync_slice`, `sync_dirty`, `drift_event`, `channel_health`, `reconciliation_walk`, `detection_run` | `docs/guide/concepts/the-loop.md`, `docs/design/resilience.md`, `docs/design/observability.md`, ADR 0002, ADR 0004 |

The product's other add-ons (operations, managed services, sites and portals) are named in `docs/product.md` but are not all in `MODULE_IDS` yet. The map shows them only when the registry names them; it does not invent a module the product has not decided.

#### 4.3.4 The real schema

The PMS's schema is the ideal test of the "generic database" claim because it is not an ORM schema:

- **Five stores, not one database.** The tenant database, the control plane, telemetry, diagnostics and the support store each have their own connection and migrations. Nothing joins across them.
- **Plain SQL, forward-only.** 181 migrations in `packages/persistence/src/migrations`, applied in filename order, with expand/contract and a timestamp rule (ADR 0144, ADR 0148). The database enforces what application code can forget: row-level security on every table, and a GiST exclusion constraint that makes two confirmed stays on the same nights physically impossible (`0001-foundation.sql`).
- **Kysely types are hand-written.** `packages/persistence/src/schema/schema.ts` is the TypeScript shape, kept honest by tests against a real database. There is no Prisma or Drizzle to introspect.
- **The schema is rich in meaning.** Comments, checks, constraints, partial indexes and triggers carry decisions; the migration history carries why a table changed. That is exactly what a data dictionary should show and what a pure ORM reader would miss.

**Structure is documentation; rows are data.**

- Table and column names, types, nullability, defaults, keys, constraints, indexes, comments, triggers and foreign keys are **documentation**. They are visible to workspace members, and they are the thing the map is for. They are not sensitive by themselves.
- Guest names, contact details, passport or ID data, payment details, message bodies, ticket contents, call recordings and every row value are **data**. The index never reads them. A live schema source queries catalogs only; an artifact carries DDL and metadata only.
- The boundary is enforced by the adapter, not by a convention: the catalog allowlist has no `SELECT` from a table, and an artifact importer rejects a row-shaped record. No value leaves the database, so there is no redaction problem to get wrong.
- Internal and public are separate. The **internal** Quill instance may show the whole schema to staff. The **public/customer** instance never receives it; ADR-0150 already decides that the internet-facing instance reads only public and customer paths.

**Representative table groups**

| Group | Tables |
| --- | --- |
| Tenancy and account | `tenant`, `property`, `unit`, `space`, `structure`, `property_group`, `property_group_member`, `api_key`, `setting_rule`, `policy` |
| Calendar and inventory | `calendar_hold`, `block`, `block_type`, `occupancy`, `out_of_service`, `channel_blackout`, `closure_minute`, `channel_window` |
| Pricing and money | `pricing_configuration`, `pricing_rule`, `booking_tax_line`, `booking_money_reported`, `payment`, `deposit`, `payout`, `payout_line` |
| Bookings and channels | `booking`, `booking_clash`, `booking_revision`, `booking_party`, `channel_reservation`, `unplaced_reservation`, `channel_account`, `channel_listing`, `channel_health`, `platform_binding` |
| Records and work | `task`, `task_event`, `task_note`, `workflow*`, `crm_*`, `desk.*`, `privacy_*`, `finance.*` |
| Platform | `event`, `event_subject`, `audit_request`, `change_record`, `search_entry`, `job`, `notice`, `sync_slice`, `sync_dirty`, `drift_event`, `reconciliation_walk` |

The first schema index should cover **all 197 tenant tables and the control plane**, with the support, telemetry, diagnostics and finance schemas next. It reads the migrations for history and the live catalog for the deployed truth, then reports drift between them.

#### 4.3.4a Annotating the schema, idiomatically

The short explanation belongs in SQL, the long explanation in a guide, and structured facts in a reviewed sidecar. That is the clean split; none of the three pretends to be another.

**Short annotation: `COMMENT ON`.** PostgreSQL's own comments are the source of truth for a table, column, schema, view or function:

```sql
COMMENT ON SCHEMA payments IS 'Money movement: intents, captures, refunds and folios.';
COMMENT ON TABLE payments.intents IS 'One row per payment attempt.';
COMMENT ON COLUMN payments.intents.status
  IS 'Lifecycle: created, authorised, captured. A declined authorisation leaves it created.';
COMMENT ON FUNCTION lockstay_tenant()
  IS 'The tenant id set by withTenant() for the current transaction. Every row-level policy reads it.';
```

Why this and not a custom format: it travels with a dump, appears in `psql \d+`, is reviewed in the same migration as the schema change, and needs no Quill-specific tooling. The page shows the comment and names its source. A table with no comment says "No comment on the table", never an invented one.

**Long explanation: a guide.** A normal Markdown page claims the entity in `covers:`:

```yaml
covers:
  - postgres:lockstay.payments.intents
  - postgres:lockstay.public.lockstay_tenant
```

The schema page shows "Read the guide" with the owner and revision; the guide shows the entities it covers. This is the same claim/mention split as code. The guide carries purpose, invariants, examples, retention, failure modes and links to the migration and the code.

**Structured facts: an optional sidecar.** A reviewed `docs/quill.schema.yaml` (`schema/v1`) carries what a SQL comment cannot: owner, tags, enum values, sensitivity, examples, see-also, and the owning guide. It is data, validated, versioned with the repository. It does not duplicate a summary that the database already has; when there is no comment (a managed database, a read-only role), it may supply the summary and is labelled `schema annotation` rather than `database comment`.

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

Precedence is by fact, not by page: the database comment is the short description; the sidecar is the structured metadata; the guide is the long form. Every fact says which source it came from, so a reader can tell a DBA's note from a writer's explanation. Nothing is silently merged.

**Functions are entities.** `CREATE FUNCTION`/`CREATE OR REPLACE FUNCTION` and `COMMENT ON FUNCTION` enter the same snapshot as tables. A function page carries its signature, return type, language, volatility, `SECURITY DEFINER`, comment, source line and guide.

`lockstay_tenant()` is the worked example:

- It reads the `lockstay.tenant_id` setting that `withTenant` sets for the current transaction.
- Every row-level policy compares `tenant_id` against it.
- The function page links the function, `packages/persistence/src/db.ts`, the migration that defines it, and `docs/guide/concepts/tenancy/data-isolation.md`.
- A reader sees the mechanism, not just the name. A new developer can answer "why does every table compare against this function?" from one page.

**Foreign keys are edges, both ways.** A column's FK links to the target table's page; the target table lists what references it, with the source columns. A target outside the indexed source is shown as unresolved with its schema-qualified name, never as a dead link.

**Grouping and the tree.** The schema surface is grouped by namespace: namespace → tables/views → columns, and namespace → functions. A schema has its own comment, owner, coverage and guide. The sidebar is a native `<details>` tree: schemas open by default, tables open on demand, columns are links. It is keyboard-operable without a custom tree widget, and it filters with the same search as the content.

**The PMS migrations have zero `COMMENT ON` statements today.** That is not a failure of the parser; it is the first content task. The highest-value set is the five schemas (`payments`, `catalogue`, `finance`, `desk`, `public`), the twenty tables a new developer meets first, and the functions that look cryptic: `lockstay_tenant()`, the RLS helpers, and the pricing/availability helpers. The report shows the coverage (`0 of 206 tables, 0 of N columns`) so the gap is visible rather than implied.

**QOL, not later polish:**

- Copy a table, column or function name from its card.
- Copy `schema.table` and `schema.table.column` links.
- Both-direction FK navigation and a visible "Referenced by".
- Schema-level commentary, function commentary and column commentary in one tree.
- `All / Code / Schema` modes, local-helper toggle, comment-inclusive search.
- `:target` highlight when a tree link lands on a card or column.
- Function signatures with language, volatility and `SECURITY DEFINER` badges.
- Comment coverage in the header and schema section.
- Light/dark, responsive, print, visible focus and a skip link.

#### 4.3.5 The map manifest

`docs/quill.yaml` already maps the repository's Markdown to Quill collections. The reference map is a sibling, `docs/quill.reference.yaml`, reviewed in the same pull request as the code it names. It is data, never code; a path or table that no longer exists is reported, never silently ignored.

```yaml
# docs/quill.reference.yaml
version: 1
name: PMS
modules:
  - id: bookings
    title: Bookings and guests
    parent: core
    summary: The booking lifecycle, from a channel's reservation to a stay, an amendment and a clash.
    paths:
      - packages/domain/src/booking/**
      - apps/api/src/features/bookings/**
      - apps/worker/src/reservations/**
      - packages/persistence/src/repositories/bookings/**
    tables:
      - booking
      - booking_clash
      - booking_revision
      - booking_party
      - channel_reservation
      - unplaced_reservation
      - occupancy
    guides:
      - docs/design/bookings-list.md
      - docs/design/clashes.md
      - docs/design/booking-trace.md
    flows:
      - booking-arrives
      - change-reaches-every-site
    dependsOn:
      - availability
      - pricing
      - channels
      - finance
  - id: availability
    title: Calendar and availability
    parent: core
    # ...
  - id: finance
    title: Finance
    summary: The ledger, books, periods, bank matching, payouts and owner statements.
    paths:
      - packages/ledger/**
      - packages/finance/**
      - packages/finance-rules/**
      - packages/finance-matching/**
      - apps/api/src/features/finance/**
    tables:
      - finance.journal
      - finance.posting
      - finance.ledger_account
      - finance.period
      - payout
      - payout_line
    guides:
      - docs/design/finance.md
      - docs/design/finance-schema.md
    flows:
      - owner-statement
  - id: support
    title: Support desk
    parent: root
    tables:
      - desk.ticket
      - desk.message
      - desk.ticket_link
      - desk.clock
      - desk.workflow
    guides:
      - docs/design/support.md
      - docs/design/tickets.md
    flows:
      - request-becomes-a-ticket
```

- **`parent: core`** puts a sub-domain under the core module; a top-level module has `parent: root`. The map has two levels, not a flat list of seventeen.
- **Paths and tables are membership rules, not permissions.** A module with no paths or tables is reported as misconfigured. A moved file or a renamed table appears in the preview as a membership change.
- **Owner** is a team or a person, never a commit author, and never a grant.
- **Guides and flows are normal documents**; the manifest only points at them.
- **`dependsOn`** is curated only where the code graph is not enough. Generated dependencies are shown beside it; a contradiction is a finding.
- **Unknown keys are preserved** and reported, so a later version can give them meaning (ADR-005's rule for front matter, applied to a map).
- The map preview shows what changes before saving, exactly as a source preview does.

#### 4.3.6 The real flows

The prototype's first three flows are the ones a new person must understand, and the ones a support engineer needs at 2 a.m. The references are the real symbols and tables; the prose is the part a person writes.

**Flow 1 — a change reaches every site**

```markdown
---
title: A change reaches every site
flow: change-reaches-every-site
covers:
  - pms:sync-core
  - pms:transport
  - pms:channels
---

A change is made once, marked as dirty in the same transaction, and sent only where it differs.

:::flow[A change reaches every site]
1. **Write the change and mark what it touches.** :code[sync_dirty_mark]{ref="pms:persistence#sync_dirty"}
   The API writes the change and a trigger marks the affected slices in the same transaction.
   Nothing is sent from the request.
2. **Compare desired with applied.** :code[decide]{ref="pms:sync-core#decide"}
   The engine finds the slices due and compares fingerprints. Equal means nothing is sent;
   different means the slice is work.
3. **Choose the slice and the request.** :code[reconcileSlice]{ref="pms:engine#reconcileSlice"}
   A full replace unless a delta is cheaper; an unknown answer changes no record.
4. **Send through the one transport.** :code[httpExecutor]{ref="pms:transport#httpExecutor"}
   An adapter describes the request; the transport paces, retries, records and redacts it.
5. **Record what the site accepted.** :code[applied_hash]{ref="pms:persistence#sync_slice"}
   The slice records the applied fingerprint and the time.
6. **Verify, and record drift.** :code[drift_event]{ref="pms:persistence#drift_event"}
   Where the site can be read back, the PMS compares and records the difference. Drift is repaired
   and never deleted.
7. **Show the evidence.** :code[timeline]{ref="pms:persistence#event"}
   When we sent, when the site confirmed, when we will check next - four facts, never one
   "last updated".
:::
```

**Flow 2 — a booking arrives and closes the nights everywhere**

```markdown
---
title: A booking arrives
flow: booking-arrives
covers:
  - pms:bookings
  - pms:channels
---

A booking is a fact received from a site. A missed fact is an overbooking, so it is saved before the answer.

:::flow[A booking arrives]
1. **Receive the delivery and save it before the 200.** :code[airbnbGateway]{ref="pms:worker#airbnb-gateway"}
   The gateway checks the sender, writes the delivery to disk, flushes, and only then answers.
2. **Apply the delivery in the worker.** :code[applyAirbnbFacts]{ref="pms:worker#airbnb-facts"}
   A delivery that cannot be used yet is set aside or held back, never marked done.
3. **Write the booking and let the database refuse an overlap.** :code[ledgerFold]{ref="pms:worker#reservations-ledger"}
   The database refuses a second confirmed stay on the same nights; the ledger records the refusal
   as a clash in the same transaction.
4. **Mark the occupancy and the slices.** :code[occupancy]{ref="pms:persistence#occupancy"}
   Every night taken is an occupancy row, and the same trigger marks the slices for every other site.
5. **Close the nights everywhere else.** :code[decide]{ref="pms:sync-core#decide"}
   The engine closes the nights on the other channels. The booking flow and the change flow meet
   here; they are the same reconciler.
6. **Acknowledge and trace.** :code[acknowledged]{ref="pms:persistence#event"}
   The site is told we have the booking. The trace shows every step, with the request and response.
:::
```

**Flow 3 — a property goes live**

```markdown
---
title: A property goes live
flow: property-goes-live
covers:
  - pms:properties
  - pms:channels
---

From a draft property to the first send on a channel, with every step reviewable.

:::flow[A property goes live]
1. **Create the property and choose its shape.** :code[PropertyPhase]{ref="pms:domain#property-phase"}
   A property is edited directly until it first goes live; its phase is set by a recorded act
   (ADR 0155, ADR 0156).
2. **Describe its spaces and units.** :code[Structure]{ref="pms:domain#content-layout"}
   The inventory shape decides whether it is a whole home, a room or part of one.
3. **Add the content and the photos.** :code[Description]{ref="pms:persistence#description"}
   The description, amenities and photos are the property's own record, not a copy of a channel's.
4. **Connect the channel and map the listing.** :code[channel_account]{ref="pms:persistence#channel-account"}
   A channel account is connected by its own proof and matched by choosing; a listing belongs to one
   account.
5. **Preview the first send.** :code[first_send_preview]{ref="pms:persistence#first-send-preview"}
   What will go, to which listing, and what is missing.
6. **Go live and verify.** :code[goLive]{ref="pms:persistence#property"}
   The first send is real, and the same reconciliation loop verifies it.
:::
```

**Stretch flows:** a guest request becomes a ticket (`desk.*`), a night's money becomes an owner statement (`finance.*`, `payout`), and a call becomes a task (`voice_call`, `task`). They prove the add-on modules connect to the core rather than living beside it.

#### 4.3.7 Guided paths

The map answers "what exists"; a path answers "what should I read first?". Paths are normal documents, grouped on the Reference home by the role the reader chooses. They are not permissions and they do not hide the reference.

| Path | Reader | Sequence |
| --- | --- | --- |
| **Your first week** | new developer | `README` → `docs/overview/how-it-works.md` → `docs/guide/architecture.md` → **A change reaches every site** → `docs/guide/concepts/tenancy/` → `packages/domain`, `calendar`, `sync-core`, `engine`, `peer-sdk`, `apps/worker` → the recipes (`add-an-api-route`, `add-an-outbound-send`, `add-a-tenant-table`) |
| **Change safely** | senior developer | ADR 0002 (level-triggered), 0004 (fingerprints), 0007 (inventory shapes), 0016 (money), 0032 (pricing rules), 0036 (channels), 0044 (occupancy), 0065 (permissions), 0100 (modules), 0109 (finance ledger), 0163 (event store) → the relevant flow → the schema's constraints → `docs/status.md` and the tests |
| **Triage** | support or on-call | `docs/design/booking-trace.md` → `docs/design/timeline.md` → `docs/design/observability.md` → the booking's trace → `apps/admin` → diagnostics and telemetry → the runbook and the owner |
| **Understand the data** | data analyst or backend engineer | `docs/guide/concepts/tenancy/` → the five stores → `packages/persistence/src/migrations/` and `schema.ts` → the table pages → the data dictionary → `docs/legal/data-roles.md` |
| **Maintain the map** | tech lead or writer | `docs/quill.yaml` → `docs/quill.reference.yaml` → `docs/design/quill-docs.md` and ADR-0150 → `pnpm docs:check` → coverage and staleness → owners and review dates |

A path is a promise: every step works, every link resolves, and a reader can finish it without a meeting.

#### 4.3.8 The twelve questions

These are the acceptance test for the PMS prototype. Each is answered without opening the repository or a database client, in one sitting, by a reader who has never seen the PMS before.

| # | Question | Where the answer lives | Acceptance |
| --- | --- | --- | --- |
| 1 | How does a change reach Airbnb and Booking.com? | **A change reaches every site**; `decide`; `sync_slice`, `sync_dirty` | The flow names the write, the mark, the comparison, the send and the verification, with the code and tables. |
| 2 | Why can two confirmed bookings never overlap, and what happens when they do? | **A booking arrives**; `booking_clash`; `0001-foundation.sql` | The exclusion constraint, the clash record and the overbooking path are shown, not just the happy path. |
| 3 | What is a slice, and why is it the unit of sync? | `docs/guide/concepts/slices-and-fingerprints.md`; `packages/sync-core` | A slice, a fingerprint, desired/applied/observed and the no-op case are explained in one page. |
| 4 | Where does a Booking.com reservation enter, and what is saved before the 200? | **A booking arrives**, first two steps; `apps/worker/src/gateway` | The gateway, the ingest log, the worker and idempotency are visible. |
| 5 | How is a nightly price calculated, and what changes it? | Rates and pricing module; `docs/design/pricing.md`; `pricing_rule` | The grammar, the stored quote and the rules that change it are linked, with the code that reads them. |
| 6 | What are the modules, and what does an account need to open Finance, Support or CRM? | Modules map; `packages/control-plane/src/modules.ts`; `docs/design/modules.md` | Every module, its entitlement and its seats are visible, with the real table and package. |
| 7 | How does access work — entitlement, seat, area/level, reach, field guard? | Account and access module; `docs/design/auth.md`; ADR 0065, ADR 0100 | A person's path through the five facts is shown, with the code that enforces it. |
| 8 | Where does a customer's support request live, and how does it link to a booking? | Support desk module; `desk.ticket`, `desk.ticket_link` | The customer's desk in the tenant database and our desk in the support store are distinguished. |
| 9 | How does a night's money become an owner statement? | Finance module; `finance.journal`, `finance.posting`, `payout` | The posting rule, the ledger and the statement are one flow, with the money's source. |
| 10 | What is drift, and how is it detected and repaired? | Platform module; `drift_event`, `channel_health`; `docs/design/observability.md` | The read-back, the record, the repair and the measure are shown. |
| 11 | Which migration owns a table, and what depends on it? | Schema page; `packages/persistence/src/migrations` | Every table names its migration, its store, its keys and the code and flows that use it. |
| 12 | How do I follow a booking or a request end to end when something goes wrong? | **A booking arrives**; `docs/design/booking-trace.md`; `event`, `audit_request` | The trace shows the steps, the request and response, the fault reference and the owner. |

#### 4.3.9 Prototype scope and exit criteria

**In scope for the prototype:**

- **Extend the existing local index** to every non-UI TypeScript package, then the TSX apps. Add class members, `@see`/`{@link}` edges and `@concept` pages. Keep the blob-SHA cache and the measured speed. The files to lift first are `scripts/code-index/{extract,cache,git,search,page,schema,types}.ts` and their tests; the page becomes a Quill route and `index.json` becomes the artifact.
- **Add a schema index** over the 197 tenant tables and the control plane: tables, columns, types, keys, constraints, indexes, comments, migration history and ownership.
- **Host it in the internal Quill instance** behind the existing zero-trust proxy, with the source's sync status and the index's freshness. The public/customer instances are ADR-0150's, not this prototype.
- **The map:** seven top-level modules and the core's sub-domains, with an owner, purpose, paths, tables, guides and flows in `docs/quill.reference.yaml`.
- **Three flows:** A change reaches every site, A booking arrives, A property goes live. The support and finance flows are the stretch.
- **Module overviews:** every module and core sub-domain has a published overview with purpose, owner, key concepts, entry points, tables, flows, failure modes and what to read next.
- **The twelve questions** run with a novice and a senior, in a moderated session, without help.
- **A data dictionary** for the tenant schema, with descriptions and owners, and an export.

**The first pages to write, in order:**

1. The PMS overview — what the platform is for, the one-sentence promise, and the three flows.
2. The core loop — A change reaches every site.
3. A booking arrives — the domain's most important inbound path.
4. A property goes live — the onboarding path.
5. The core module — its sub-domains, in one page.
6. Bookings and guests.
7. Calendar and availability.
8. Rates and pricing.
9. Channels and peers.
10. Account, people and access.
11. Finance (the first add-on, because it proves the map's depth).
12. Support desk.
13. The data dictionary.
14. Your first week.

**Exit criteria:**

- A new developer answers **at least ten of twelve** questions in **twenty minutes** with no help, and can name the three files they would open first for a small change.
- A senior developer reaches the exact symbol behind a business rule in **under thirty seconds**, and lists the modules, tables and flows affected by a proposed schema change.
- A support engineer goes from a stuck booking to the flow, module, table, trace and owner in **under two minutes**.
- The map has **no unowned module**; every flow's references resolve; every module overview is published and reviewed.
- The index is **fresh** (a push is visible within five minutes), and an index failure leaves the last good snapshot serving.
- The local index's speed is kept or improved: whole-repo cold under 30 seconds, warm under 2 seconds, one file under 3 seconds on the same machine.
- The prototype produces **no thin page in the sitemap**, and no generated prose that a person did not review.

**Out of scope for the prototype:** other languages, cross-repository identity, call graphs, public API reference (Scalar stays the public reference), public code/schema surface, automatic generation of guides, and replacing the existing runbooks.

#### 4.3.10 What the PMS teaches the generic design

The prototype is not a special case. Each PMS need hardens a generic mechanism:

| PMS need | Generic mechanism it proves |
| --- | --- |
| 59 packages and 6 apps, with module names that do not match folders | The map manifest, reviewed as data, with path/table membership rules and a two-level map. |
| A change that crosses the API, worker, engine, transport and peer | Flows as first-class, ordered documents with validated references. |
| A booking that crosses channels, the ledger, occupancy and a clash | Entity graph plus schema relationships; the flow points at both. |
| A new developer who needs a starting point | Guided paths and module overviews, not a generated tree. |
| A senior who needs invariants and impact | Entity graph, dependency lists, constraints, ownership and ADRs. |
| 197 tables across five stores, with no ORM | Schema indexing from SQL migrations and Kysely types, not just an ORM. |
| A local index that must not become a server cost | The CI/artifact lane and a hosted read model that does not re-run the compiler per request. |
| A docs plan that already has two instances and audiences | The internal reference sits behind the internal instance; public/customer docs keep their own boundary. |
| A repository that already runs `pnpm docs:check` | The same check extends to reference links and map coverage. |

If a mechanism only works for the PMS, it is not ready. If it works for the PMS and for Quill's own TypeScript monorepo, it is general enough to promote.

## 5. The reference model

### 5.1 One entity model, several kinds

"Symbol" and "table" are both **reference entities**. One model keeps search, references, backlinks, permissions and pages from being written twice. The kind is a discriminant, and the source says which dialect it came from.

| Kind | Examples | Source |
| --- | --- | --- |
| `module`, `namespace`, `package` | `payments`, `@acme/payments` | code |
| `class`, `interface`, `type`, `enum`, `trait`, `struct` | `PaymentService`, `PaymentGateway` | code |
| `function`, `method`, `constructor` | `PaymentService.capture` | code |
| `property`, `field`, `constant` | `PaymentService.timeout` | code |
| `database`, `schema` | `payments` | schema |
| `table`, `view`, `materialized-view` | `payments.intents` | schema |
| `column` | `payments.intents.status` | schema |
| `constraint`, `index`, `enum-type` | `intents_status_check` | schema |
| `operation`, `message` | `POST /v1/payments` | future spec sources |

The model is additive: a new kind is a new discriminant and a new rendering, not a new storage system. OpenAPI operations, GraphQL types and Protobuf messages are the obvious next kinds; they are not in the first release.

### 5.2 Fidelity is explicit

Not every extractor knows the same amount. A page must not pretend a syntactic guess is a compiler's answer.

| Fidelity | What it means | Typical source |
| --- | --- | --- |
| `semantic` | Resolved types, inheritance, references and call relationships from a compiler or language server | TypeScript compiler API, Go packages, Roslyn, SCIP |
| `declared` | Declarations, signatures and doc comments, resolved across files by the tool's own rules | Dokka, rustdoc JSON, griffe, Doxygen XML |
| `syntactic` | Declarations and doc comments from a grammar, without cross-file type resolution | tree-sitter fallback |
| `exact` | Schema objects read from the database's own catalogs | Postgres, MySQL, SQL Server |
| `authored` | A schema declared in an ORM or a DDL file, which may differ from the deployed database | Prisma, Drizzle, SQLAlchemy, Flyway |

Every page shows its fidelity, and the UI says what is missing: "Types are not resolved for this source" is honest; a broken "Uses" graph that pretends to be complete is not. Coverage and drift calculations name the fidelity they rely on.

### 5.3 Identity: monikers, snapshots and aliases

- **A moniker is the stable external identity** of an entity within a source: `typescript:@acme/payments#PaymentService.capture` or `postgres:payments/public.intents.status`. The exact grammar is the artifact's business; the model treats it as opaque and only renders it in diagnostics.
- **A snapshot is one index of a source at one revision**: a commit, a tag or a schema capture time. It carries the format version, the extractor and version, the fidelity, the time, and a content hash.
- **Entities are stable across snapshots.** A snapshot version records a signature, doc comment, location, visibility and attributes. The same entity can be documented, renamed, deprecated or deleted between snapshots.
- **A rename produces an alias**, not a new identity. The alias is a row from an old moniker to a new one, with a confidence and a confirmation state. References resolve through aliases; old URLs redirect through them.
- **A deletion is a state, not a disappearance.** The entity remains addressable with its last known version and a tombstone, so a reference and an old link can say what happened. This mirrors ADR-035 and ADR-046.

The document stores the moniker, not a database UUID, so a Git round trip, an export and a reindex do not depend on Quill's rows. A moniker is never parsed to make an access decision; it is a lookup key.

### 5.4 The graph

| Edge | From → to | Derived from |
| --- | --- | --- |
| `contains` | package → module, class → member, table → column | declarations |
| `extends` / `implements` | class → class / interface | declarations |
| `uses` | function → type, function → function | compiler references, imports, type references |
| `returns` / `accepts` | function → type | signature |
| `maps-to` | class → table | ORM metadata, explicit mapping |
| `references` | column → table | foreign key |
| `indexed-by` | table → index | catalog |
| `documented-by` | entity → document | document references and `covers` |
| `mentions` | document → entity | inline references |
| `same-as` | entity → entity | a confirmed alias or cross-source identity |

Edges are per snapshot. The document side is per document revision and per publish. This keeps "what the code looked like then" separate from "what the guide says now", which is what makes staleness computable.

## 6. Indexing code generically

The hardest requirement is "support various coding languages" without Quill becoming a compiler platform. The answer is a **narrow artifact contract plus three lanes**, in order of preference.

### 6.1 Lane one: CI artifact, using the project's own toolchain

`quill index` runs in the repository's CI, imports the language's own compiler or documentation tool, and writes a **Code Index Artifact** (JSONL, versioned, deterministic). The server ingests the artifact and never runs a compiler for that source.

This is the most generic lane because it inherits whatever the project already uses to build and type-check. It also solves the practical objections:

- the server does not need a Go, Rust, JVM or .NET toolchain;
- private package registries and generated code are available where they already build;
- the artifact can be produced for a commit or a tag, so the public version selector has something to point at;
- a failure is the project's own build failure, with the project's own diagnostics;
- the artifact can be inspected and diffed like any other build output.

`quill index` lives in `apps/cli` (ADR-062), shares its version with the server, and uses the portable `@quill/format`-style constraints: no Postgres, no Docker, no native modules, no server imports. It is the same binary as `quill check` and `quill preview`.

### 6.2 Lane two: standard documentation formats

Many ecosystems already export a rich declaration graph. Quill imports these before writing a parser:

| Format | Languages | What it gives | Phase |
| --- | --- | --- | --- |
| **SCIP** | TypeScript, Go, Java, Kotlin, Rust, Python, Ruby, .NET and more through Sourcegraph indexers | symbols, monikers, definitions, references, implementations | 2 |
| **rustdoc JSON** | Rust | items, visibility, generics, impls, doc comments | 2 |
| **Dokka JSON** | Kotlin, Java | declarations, signatures, docs | 3 |
| **Doxygen XML** | C, C++, Objective-C, C#, Java, Python, PHP and more | declarations, members, inheritance, docs | 3 |
| **TypeDoc JSON** | TypeScript | declarations, signatures, comments | 2 |
| **griffe / pydoc** | Python | modules, classes, functions, docstrings | 2 |

The importer is an adapter behind the same artifact contract. It can lose fidelity (Doxygen does not know a TypeScript compiler's exact overload set), so it declares `declared` or `syntactic`, and the UI says so.

**Already proven on the PMS.** The local `scripts/code-index` spike measured the TypeScript 7 native compiler API against the alternative: 9,103 symbols over the whole non-UI repository in 17 seconds cold and 1.2 seconds warm; 99.97% agreement with the compiler's own find-references; 8.5 MB of JSON. It needs no `ts-morph`, no SCIP and no second compiler. The remaining work is members, `@see`/`{@link}`, TSX projects and the hosted artifact — not a new extractor.

### 6.3 Lane three: built-in server adapters

For the common first languages, Quill ships extractors that run in a worker on the server, so a team can connect a repository and see a result without setting up CI. These are not the only way to support a language; they are the zero-config path.

| Language | Extractor | Fidelity | Phase |
| --- | --- | --- | --- |
| TypeScript / JavaScript | TypeScript 7 native compiler API (`typescript/unstable/sync`): symbols, resolved types, JSDoc/TSDoc, find-references | semantic | 1 |
| Python | Griffe (static) or Pyright's JSON output | declared / semantic | 2 |
| Go | `go/packages` + `go/doc` | semantic | 2 |
| Rust | `rustdoc --output-format json` | semantic | 2 |
| Java / Kotlin | Dokka JSON | declared | 3 |
| C# | Roslyn semantic model | semantic | 3 |
| Ruby | YARD registry | declared | 3 |
| PHP | phpDocumentor XML | declared | 3 |
| Anything else | tree-sitter declarations + doc comments | syntactic | 3 |

A built-in adapter is a **packaged-tier** extension (ADR-039): code installed by the operator, not uploaded by a tenant. It runs in a resource-limited worker, never in the request path, and has a fixture corpus in its own language. The registry names it, its version joins the snapshot, and adding one never changes the indexer or the pages.

### 6.4 What is extracted, and what is not

**Extracted:** project/package/module structure; declarations and their kinds; visibility and export status; signatures (including generics, overloads, optional and rest parameters); doc comments in the language's conventions with structured tags; source path, start and end lines; inheritance and implementation; imports and resolved type references; deprecation, experimental and since metadata where the language has it; ORM model-to-table evidence; package ownership hints from `CODEOWNERS` where available.

**Not extracted:** function bodies, local variables, comments that are not doc comments, string literals, secrets, environment values, test fixtures, generated code by default, vendored dependencies, or runtime values. A source excerpt is a separate, pinned request for exact lines through the M5 source-reference path, with its own permission check; it is not part of the index.

**Doc comments** are parsed into structured fields where the convention allows it: summary, remarks, parameters, returns, throws, examples, see-also, deprecated, since. The raw comment is kept for diagnosis and round-trip; the rendered form is Markdown sanitised by the platform's own pipeline. A doc comment is untrusted input: it may contain HTML, links and directives, and it goes through the sanitiser like any author text.

### 6.5 Incremental and deterministic

- **File facts, not a second AST.** The indexer stores per file: content hash, language, package, declarations, doc-comment text, imports and diagnostics. A file whose hash is unchanged is not parsed again.
- **Deterministic ordering.** Packages, entities and edges are sorted by moniker before serialisation, so the same commit produces the same artifact hash and an unchanged file produces no diff.
- **Incremental on both sides.** CI can upload a full artifact or a shard; the server computes the delta against the last snapshot. The sync job can index only changed files when the source adapter permits it.
- **Versioned extractors.** The extractor id and version are part of the snapshot. Upgrading one triggers a full rebuild for that source, not a silent mixed graph.
- **Diagnostics travel with the artifact.** Unsupported syntax, unresolved imports and degraded fidelity are reported, not hidden. A page can say "12 types could not be resolved in this source".

## 7. Indexing schemas generically

Schema sources are simpler than code, and the data behind them is more sensitive. The same three lanes apply, with a stricter rule: **metadata only, never rows**.

### 7.1 Schema source kinds

| Source | What it reads | Fidelity | Phase |
| --- | --- | --- | --- |
| PostgreSQL | `pg_catalog` and `information_schema`: databases, schemas, tables, views, columns, types, defaults, identity, enums, constraints, indexes, comments, RLS policies | exact | 1 |
| Plain SQL migrations + hand-written types | SQL DDL in `packages/persistence/src/migrations`, the Kysely shape in `schema.ts`, and the same tables read back from the live catalog | authored + exact | 1 |
| MySQL / MariaDB | `information_schema` | exact | 2 |
| SQLite | `PRAGMA table_info`, `index_list`, `foreign_key_list` | exact | 2 |
| SQL Server | `sys.*` catalogs | exact | 3 |
| Prisma | `schema.prisma` | authored | 1 |
| Drizzle | the exported table definitions from the project's own build | authored | 2 |
| SQLAlchemy / Django / SQLModel | model metadata from a Python introspection command | authored | 2 |
| Hibernate / JPA | persistence metadata | authored | 3 |
| EF Core | model metadata | authored | 3 |
| DDL folder / Flyway / Liquibase | parsed `CREATE`/`ALTER` statements, with the dialect named | authored | 1 |
| OpenAPI / GraphQL / Protobuf | operations, types, fields | authored / exact | later |

**Introspection is not the default.** A checked-in schema (Prisma, Drizzle, SQLAlchemy, a DDL folder) is preferred because it is reviewable, diffable, has no credentials and describes what the application expects. Live introspection is for the case where the database is the only truth, and it must use a read-only role and a schema-only allowlist. The two can be connected together to report drift (CD-14).

### 7.2 What is captured

Catalog, schema, table and view names; table and column comments; column order, type, length/precision, nullability, default, identity/generated, collation and enum values; primary, unique, foreign-key and check constraints; indexes, their columns, uniqueness and method; relationships with cardinality; row-level security policies as policy names and expressions (never the rows they protect); triggers and their timing; sequence ownership; and, if the source permits, an approximate row count with its source and time. No row content, no sample values, no query results.

### 7.3 Safety rules

- **Read-only credentials**, a dedicated role with `CONNECT` and catalog access only; the UI explains how to create it and refuses a role that can write where the adapter can detect it.
- **No data queries.** The adapter's SQL is a fixed catalog allowlist, never user-supplied. A database adapter is not a query runner.
- **Prefer artifacts** for databases behind a firewall, production, or a vendor-managed service. CI can export a schema artifact with `pg_dump --schema-only` or the ORM's own metadata, and Quill never connects.
- **Secrets are product secrets** (ADR-034), encrypted, never returned, never logged, never in a URL.
- **The connection is an outbound request** and goes through the SSRF-safe client with host policy, timeouts and size limits (ADR-011).
- **Structure is documentation; rows are data.** Table and column names, types, keys, constraints, indexes and comments are documentation, visible to workspace members and safe to index. Row values, message bodies, guest details, payment details and call recordings are data and are never read. The adapter enforces this with a catalog allowlist and a record-shape check; it is not a redaction policy that can be forgotten.
- **Public exposure is explicit.** Indexing a schema makes it readable to workspace members, not the public. Publishing a schema surface is a separate, reviewed choice with a table/column allowlist; the PMS's reference is internal-only.
- **Snapshot, not live.** Every page names the snapshot time. "Live schema" is not a promise the product can keep without holding a connection per reader.

### 7.4 Drift

Drift is a first-class output because it is the schema equivalent of stale code references:

- **Snapshot-to-snapshot drift:** a table or column added, removed, retyped or made nullable between two captures.
- **Declared-to-deployed drift:** the ORM or DDL expects a column the live database does not have, or the reverse. This is the one that catches a forgotten migration.
- **Model-to-table drift:** the code model's fields and the table's columns disagree.
- **Documentation drift:** a described column no longer exists, or a new column has no description.

Each finding names both sides, the evidence and the confidence. It is a signal, never a silent rewrite, and it is never a reason to refuse a documentation publish.

## 8. The surfaces

### 8.1 Where it lives

A workspace gains a **Reference** area, beside its documents, not inside the document tree:

```text
/w/<workspace>/reference                     overview and sources
/w/<workspace>/reference/map/<source>        the module map (the PMS map, the default view)
/w/<workspace>/reference/map/<source>/<module>  a module's overview, tables, symbols and flows
/w/<workspace>/reference/code                packages and modules
/w/<workspace>/reference/code/<source>/<package>/<module>
/w/<workspace>/reference/code/<source>/<package>/<module>#<symbol>
/w/<workspace>/reference/schema              schemas and tables
/w/<workspace>/reference/schema/<source>/<schema>/<table>
/w/<workspace>/reference/search?q=...        scoped search
```

A workspace without a reference source does not show the area. A workspace with one shows a quiet "Reference" entry in the navigation, with a freshness dot and a text label, never colour alone. The area is reachable from the command palette and from any reference chip; it is not a second application shell.

A **module** may span several packages, and one package may serve several modules. The module's canonical page is `/reference/map/<source>/<module>`; the package pages under `/reference/code/...` are the generated reference beneath it. A module page links to its packages, and a package page says which module owns it. When a source has no map, the package pages are the only view; no module is invented.

The **canonical address of a symbol** is its module page plus an anchor, unless it is promoted to its own page (section 8.4). The URL service resolves both, and an old address is kept as an alias after a rename. Addresses use the human package path and a short key, following ADR-035, never a raw moniker in the path.

### 8.2 Reference home

```text
REFERENCE
[ Code ] [ Schema ]                                   [ Search reference ]

Sources
  acme/payments        main @ a1b2c3d   2 min ago    1,204 symbols
  acme/web             main @ 9f8e7d6   1 hour ago     804 symbols
  staging / payments   captured 11 Nov              38 tables

Coverage
  Public API documented        68%     [Open report]
  Guides with stale refs        7     [Review]
  Tables with an owning guide   12/38 [Open schema]

Recently changed
  PaymentService.capture   signature changed   3 guides affected
  payments.intents         column added        no guide
```

The page answers three questions before it shows a tree: what is indexed, how fresh it is, and what needs attention. A source that has never synced shows a setup card with the preview action. An empty workspace shows the two ways to connect (repository or CI artifact) and one sentence explaining that documents remain Markdown.

When a source has a map, the map (section 8.11) is the default view and this overview sits one level behind it. Without a map, this page is the home.

### 8.3 Explorer

- **Code:** modules → packages → members when a map exists, otherwise packages → modules → members, with filters for kind, visibility, deprecation, language and "has a guide". A flat list is available because a deep tree is not always the fastest way to find a class.
- **Schema:** schemas → tables/views, with filters for "has a guide", "has a code model" and "changed since". A diagram toggle is offered, with an accessible list always available.
- **Search within the explorer** uses the same reference search as the palette, scoped to the current source.
- **Recents** are per reader and per workspace, not a global activity feed.

### 8.4 A symbol page that serves both a novice and an expert

One page, one address, progressive disclosure. There is no "beginner mode" toggle, because a mode is a second page that goes stale.

```text
Payments / @acme/payments / PaymentService                 class  public
PaymentService                                               [Deprecated?]
src/payments/service.ts:42  ·  as of a1b2c3d (main), 2 min ago  [Source ↗]

Read first
  Payment retries: how capture, refund and the outbox fit together
  Guide · Ada Lovelace · updated 3 days ago

Summary
  Captures a payment through the selected gateway, records an intent, and
  emits PaymentCaptured. Idempotent on the caller's key.

Signature
  class PaymentService implements PaymentGateway
  capture(input: CaptureInput, options?: CaptureOptions): Promise<CaptureResult>

Parameters
  input      CaptureInput    required   The payment to capture.
  options    CaptureOptions  optional   Timeout and retry overrides.

Returns / Throws
  CaptureResult              Never throws for a declined card; returns a result.
  GatewayUnavailable         When the selected gateway is unreachable.

Members (12)  [documented 6]        [Show inherited] [Show private]
  capture        method   ...
  refund         method   ...
  ...

Used by (8)        Uses (14)        Documented in (3)
  api/checkout      PaymentGateway   Payment retries
  jobs/retry        Outbox           ADR-012 Payment capture
  ...

Related schema
  payments.intents   writes   Modeled by PaymentIntent
  payments.refunds   writes

Source excerpt (optional, permission-checked)
  42  export class PaymentService implements PaymentGateway {
  43    ...
```

- **The top** answers "what is this?" in one line, then gives the guide to read if one exists.
- **The middle** is the exact contract: signature, parameters, returns, throws, members. Empty sections are omitted, never rendered as "None".
- **The bottom** is the graph: used by, uses, documented in, related schema. It is bounded, paginated and collapsible.
- **Advanced** (type parameters, decorators, inherited and private members, raw source path) is a disclosure after the main content, not a separate mode.
- **The page never shows raw tags.** `@param`, `@returns`, `@throws`, `@example`, `@deprecated`, `@see` become the platform's parameter table, callouts and links.
- **Provenance is always visible** but quiet: "as of a1b2c3d (main), 2 min ago" with a link to the source and a "how this page is generated" note.
- **No page per function.** A module page lists its symbols with anchors; a symbol is promoted to its own page when a guide claims it, when it is explicitly promoted, or when it is too large to sit comfortably in the module page. The promotion is a page setting, not a new document, and the module page keeps a link. This is the difference between a usable reference and ten thousand thin pages.
- **A module page without a guide** still has a generated summary from the module's doc comment and a "Write the overview" action. A module page with a guide opens with the guide's first paragraph and a link, because the human explanation is more useful than the generated list.
- **A symbol with no doc comment** says "No description in the code" and offers "Write a guide" to someone who can edit. It never invents a description.
- **Deprecated, experimental and internal** are words, not colours. Deprecated pages say what to use instead and, where possible, link to it.
- **A migrated symbol** says "Formerly `OldName`" and keeps the old anchor working.

### 8.5 A table page

```text
payments / public / intents                    table  38 columns
intents                                                     [Copy DDL]
Captured 11 Nov 2026 from staging (read-only role)   [Relationships]

Description
  One row per payment attempt. Owned by the payments service.

Columns (38)                                            [Filter columns]
  id              uuid          not null   pk      Intent id.
  customer_id     uuid          not null   fk→customers.id
  status          intent_status not null   default 'created'
  ...
  idempotency_key text          null       unique  Caller's key, unique per merchant.

Indexes / Constraints
  intents_pkey              primary key (id)
  intents_idempotency_key   unique (idempotency_key)
  intents_customer_id_fkey  foreign key → customers.id

Relationships
  Many intents → one customers
  One intents → many refunds

Code
  Modeled by PaymentIntent (Prisma, src/payments/schema.prisma:18)
  Writes from PaymentService.capture

Documented in
  Payment intents and refunds
  ADR-012 Payment capture
```

The table page is a data dictionary and a map, not a query console. "Copy DDL" copies the definition, not the data. A diagram is a sibling view, never the only representation.

### 8.6 Search

Search is the front door, so it must work before a reader knows the difference between a symbol and a table.

- **The palette** keeps documents first for an ordinary query, then "Code" and "Schema" groups when they match. `@` scopes to code and schema. A symbol hit shows kind, package, name and a signature fragment; a table hit shows schema, table and its description.
- **The search page** has the same three groups and facets: kind, language, package, source, visibility, deprecated, documented. The existing document search is unchanged; the reference search is a second index with its own ranking profile, because exact-name ranking is different from prose relevance.
- **Ranking:** exact moniker or qualified name; exact short name; prefix; case- and separator-insensitive token match (`PaymentService` finds `payment_service` and `payment-service`); doc-comment match; recency only as a tie-breaker, never over exactness. A deprecated symbol ranks below a live one only when the text scores tie.
- **No result** suggests removing a filter, trying a broader word, or searching all workspaces. It never offers an auto-generated "did you mean" that is not a real entity.
- **The query language** gains `kind:`, `lang:`, `package:`, `table:`, `schema:`, `deprecated:` and `documented:`; the existing parser, chips and refinement UI are reused. A query the parser cannot read is refused at the character, as today.

### 8.7 In the editor

- **Insert** from `/code` and `/schema`, from an "Insert reference" toolbar action, or by typing `[[` in the body. The picker is a combobox over the same search; it shows recents and filters by source, kind and package.
- **Choose a form:** inline reference (default), signature card, source excerpt, table card, schema diagram. Each form previews in place.
- **Options:** display text, show or hide the summary, pin to this commit or follow the current version, line range for an excerpt, columns for a table card.
- **The node view** is a chip or a card with a menu: Open, Copy link, Copy signature, Change display, Refresh, Remove. A broken reference is visibly broken in the editor, not only at publish.
- **Round-trip:** the directive keeps its display text, attributes and unknown attributes. An author's own text is never rewritten. The editor's schema accepts the directive as a node; a reader without the extension sees the display text.
- **Quick create:** "Document this symbol" from the picker creates a draft guide from a template, with a `covers` claim and a scaffold. It is clearly a draft, and it never publishes on its own.

### 8.8 On the reading page

- **Inline chips** are links with a visible name; a hover/focus card adds the summary and signature fragment. The card is supplementary; everything in it is on the symbol page.
- **Block references** render server-side with a static fallback, so a reader without JavaScript, an export and a crawler get the signature and its provenance.
- **Backlinks** appear after the body, under "Documented in" and "Mentioned in", with the guide title, section and a short excerpt. They are permission-filtered and never include a draft.
- **A stale reference** gets a quiet inline marker and a header indicator for someone who can edit. A public reader sees the current or pinned rendering and no internal warning.
- **The document's "Linked code" panel** (in the document menu, not the body) lists every entity the page references, its status, and actions. This is the writer's maintenance view without cluttering the reader's page.

### 8.9 On the public site

The public reference reuses the same page templates as the app and the same theme, with no application shell. It is server-rendered and cached by snapshot and page hash.

- **Only the public surface** is emitted: exported/public symbols in the chosen packages, with an explicit review before the first publish. A private symbol is absent from pages, search, counts, the sitemap and the structured data.
- **Versions** are snapshots. The site chooses a default; a selector offers tags and `latest`. A version page says when it is no longer supported and offers the supported one.
- **Canonical and indexing:** documented module and promoted symbol pages are canonical and in the sitemap; an undocumented symbol anchor is reachable but not a separate indexable page; an unsupported version is `noindex` or canonical to the supported one, decided in the ADR.
- **Metadata:** title, description from the doc summary, `TechArticle` structured data, Open Graph, and the source link only when the repository is public.
- **Search:** public search covers the public reference and public documents, scoped to the site, rate limited and cached.
- **Export/print:** the reference is included in the site's export with its provenance; a printed page keeps signatures, parameter tables and links.

### 8.10 What a novice sees and what an expert sees

| Moment | Novice | Expert |
| --- | --- | --- |
| Landing on a symbol | The guide first, then a one-paragraph summary and the parameter table. | The signature, kind, visibility and source at the top; the guide one line below. |
| A type they do not know | A plain-language sentence and a link to the type's page. | The full generic signature, constraints and implemented interfaces. |
| The member list | Collapsed to public members, with "Show more". | Full list, filterable, with inherited/private toggles. |
| Search | Plain words; documents and code grouped with labels. | `@`, `kind:`, `package:` and exact qualified names. |
| A stale reference | "This may be out of date" in words, with a link to the guide. | The old and new signature diff, the snapshot and the acknowledgement action. |
| The source | A "View source" button. | Path, line range, commit and "open in IDE" deep link. |

The same page serves both because the expert information is *additional*, not *replacing*. The only ordering decision is that a human guide, when one exists, comes before generated detail for everyone. That is not a novice mode; it is the product's opinion about what documentation is for.

### 8.11 The system map

The Reference home for a platform like the PMS opens on the **map**, not on a package tree.

```text
THE PMS
[Your first week] [Change safely] [Triage] [Understand the data] [Maintain the map]

Modules (7) + core                                        [Search modules]

CORE
  Bookings and guests          12 tables   19 guides   2 stale   [Open]
    The booking lifecycle, from a channel's reservation to a stay, an amendment and a clash.
    Depends on: Calendar and availability, Rates and pricing, Channels and peers, Finance
  Calendar and availability     9 tables   11 guides   0 stale   [Open]
  Rates and pricing             7 tables   14 guides   1 stale   [Open]
  Channels and peers           11 tables   18 guides   1 stale   [Open]
  Properties and inventory      8 tables   12 guides   0 stale   [Open]
  Owners and ownership          5 tables    7 guides   0 stale   [Open]
  Account, people and access    6 tables    9 guides   0 stale   [Open]
  Tasks, operations and workflows 10 tables  8 guides  0 stale   [Open]
  Activity, audit and events    7 tables    6 guides   0 stale   [Open]
  Platform and reliability      6 tables    9 guides   0 stale   [Open]

ADD-ONS
  Finance                      14 tables   21 guides   1 stale   [Open]
  Support desk                  8 tables   12 guides   0 stale   [Open]
  CRM                           9 tables   10 guides   0 stale   [Open]
  Voice                         4 tables    5 guides   0 stale   [Open]
  Privacy                       5 tables    7 guides   0 stale   [Open]
  Hotels                        (core tables) 4 guides 0 stale  [Open]

Flows
  A change reaches every site   7 steps   [Read]
  A booking arrives             6 steps   [Read]
  A property goes live          6 steps   [Read]

Health
  Modules without an overview       0
  Modules without an owner          0
  Tables without a description    23
  Stale guides                      3
  Broken references                 0
```

- **A module card** shows purpose, owner, key concepts, table count, guide count, staleness and its dependencies. It is a summary, not a score; a module with no guides shows a "Write the overview" action, not a red number.
- **A module page** opens with the human overview, then "How it connects": depends on, used by, events, flows. It then lists its tables, key symbols and guides. The generated reference follows.
- **A flow page** is the narrative plus the ordered steps. It shows the modules, tables and symbols involved, the failure modes, the owner and the guides. It is the one page for "how does this actually work?".
- **The dependency view** is a filtered list first, a diagram second. It can answer "what depends on `availability`?" without rendering a hairball; a cycle is reported as a finding, not drawn as a puzzle.
- **Guided paths** are pinned to the top of the map. They are normal documents, reviewed and linked; the Reference home only offers the entry points.
- **The map is not a permission boundary.** It groups entities and documents the reader may already see; a module card never names a table or a guide the reader cannot open.
- **An empty map is honest.** A source with no map manifest shows the generated package tree and a "Make a map" action, with a preview of the modules it proposes from paths and table prefixes. It never invents names and presents them as fact.

A map page for a non-software workspace is not shown at all. The capability is off until a reference source exists.

## 9. References and the two-way relationship

### 9.1 Markdown that reads well outside Quill

References are directives (ADR-002, ADR-039), because a directive degrades to its content. The display text is always the first thing a reader sees.

```markdown
Capture goes through :code[PaymentService.capture]{ref="typescript:@acme/payments#PaymentService.capture"}.

::signature{ref="typescript:@acme/payments#PaymentService.capture" snapshot="a1b2c3d"}

::source{ref="typescript:@acme/payments#PaymentService.capture" snapshot="a1b2c3d" lines="42-71"}

The status column is :schema[payments.intents.status]{ref="postgres:staging/public.intents.status"}.

::table-card{ref="postgres:staging/public.intents" columns="name,type,nullable,description"}

::erd{tables="public.intents,public.refunds,public.customers" snapshot="2026-11-11"}
```

- `:code[...]` and `:schema[...]` are inline text directives. Outside Quill they read as `PaymentService.capture` and `payments.intents.status`.
- `::signature`, `::source`, `::table-card` and `::erd` are leaf or container directives. Outside Quill they read as a line naming the entity and its location, and the `:::` lines are visible but harmless (the same as every other directive in ADR-002).
- `ref` is the moniker, quoted because it can contain punctuation. `snapshot` is optional: present means pinned, absent means follow the source's current snapshot.
- `display` can override the visible text, but the picker does not offer it by default; the entity's own name is the readable default.
- **No reference is written into a code block or an attribute of an unrelated element.** A reference is a node, so the editor, sanitiser, converter, exporter, search indexer and Git round trip all see it.

A `covers` claim is front matter, not a body directive:

```yaml
covers:
  - typescript:@acme/payments#PaymentService
  - postgres:staging/public.intents
```

It is descriptive, not a permission, and it survives export and sync. It appears in the properties panel as "Documented entities", not as raw YAML. An older reader ignores an unknown field without error (ADR-005), and the body stays prose.

### 9.2 The body stays a pure function of the source

A reference is resolved at **page assembly**, not inside the cached body, for the same reason a live block is (ADR-031, ADR-032):

1. The renderer emits a slot for each reference: a `span` or `section` with the entity's moniker, the display text, the options and a readable fallback. The cached body depends only on the Markdown and the extension versions.
2. Page assembly batches every reference on the page, resolves them against the allowed snapshot, and fills metadata: kind, current name, signature, summary, status, links, backlinks. It never resolves one reference at a time.
3. The page's envelope lists the references and their status, so the client can show a hover card, a stale badge or a "signature changed" action without a second round trip.
4. An index that is down or stale still yields a page: the fallback is the author's text, and the page says the reference metadata is unavailable instead of failing.

This keeps reference rendering out of the render cache key. A new snapshot does not invalidate every document body; it invalidates only the assembled page, which is cheap and correct.

### 9.3 Backlinks

- **Document → entity** is recorded when a document is published: every `:code`, `:schema`, `::signature`, `::source`, `::table-card` and `::erd` contributes a `mentions` edge; every `covers` entry contributes a `documented-by` edge. The link index gains these kinds alongside internal links and external links.
- **Entity → document** is a query over the same table, filtered by the reader's permissions, never a second hand-maintained list. The symbol page shows "Documented in" (claims) and "Mentioned in" (references) separately, because a passing mention is not documentation.
- **The backlink carries context:** the document's current title, the section heading, a short excerpt around the reference, and the publication time. It is computed at publish, not stored as HTML.
- **A draft never appears** in a backlink to a reader, and a document the reader cannot open is not named. The count is permission-filtered, so it never leaks a title by arithmetic.
- **Renames on the document side** follow ADR-035; the backlink uses the document's current address, not the address at publish time.

### 9.4 Staleness is a state machine, not a boolean

Each document reference records the signature hash, doc-comment hash and snapshot it saw when the document was last published. The index records the current hashes. The states are:

| State | Meaning | What the writer sees |
| --- | --- | --- |
| `current` | Same signature and doc comment. | Nothing. |
| `description-changed` | Signature same, doc comment changed. | A low-severity "Description changed"; prose may quote the old wording. |
| `signature-changed` | Signature changed. | A warning, with the old and new signature and the affected references. |
| `renamed` | The entity resolved through an alias. | "Renamed to …", with the old name and a confirmation for ambiguous cases. |
| `deprecated` | The entity is deprecated. | A notice linking the replacement. |
| `missing` | The entity was deleted or removed from the public surface. | "No longer in this snapshot", with "Find a replacement". |
| `acknowledged` | A person reviewed the current hash and said the page is still accurate. | Nothing until the next change. |

- **The alert is about the reference, not the whole page.** One changed signature in a page of forty references marks that reference, not a red banner over the document.
- **Acknowledge is not "dismiss".** It records the hash that was reviewed, who reviewed it and an optional note. It returns when the hash changes again.
- **Public pages never show the internal state.** A public reader sees the pinned rendering or the current one, with its provenance.
- **The publish dialog warns** with a list and links, and blocks only where a workspace policy says so. A warning that cannot be acted on is noise.
- **A signature change is not proof the prose is wrong.** The tool reports the diff; the author decides.

### 9.5 The entity page as the other half

The symbol or table page is not just generated output. It is the **hub** for that entity:

- the guide that explains it (primary), and every other page that mentions it;
- its current signature and the previous one, with a diff;
- the code and schema relationships a reader can follow;
- the coverage state: documented, mentioned, undocumented, stale;
- an owner and review date, inherited from the covering guide or the source's configured owner;
- a "Report a problem" action that opens an issue-like note for the workspace, naming the snapshot; this is not a code edit.

This is what makes the relationship two-way in practice: the guide is not a dead link into a generated page, and the generated page is not a dead end back into the repository.

## 10. Maintaining it

### 10.1 First connection

- **Zero-config path:** connect a repository through the existing source flow (ADR-061), choose the paths to index, and preview. Quill detects languages, package manifests, ORM schemas and a DDL folder, and proposes a source configuration. On the PMS, the docs source is already `docs/quill.yaml`; the reference adds `docs/quill.reference.yaml` beside it, and the existing `pnpm code:index` proves the extractor before the hosted connection is made.
- **Preview before save:** counts by language, package and kind; skipped paths and why; doc-comment coverage; schema objects; problems; and an estimate of pages. Nothing is persisted until save. This reuses ADR-061's "preview before save" pattern and ADR-062's shared planning.
- **Schema path:** choose a checked-in schema first (Prisma, Drizzle, SQLAlchemy, DDL); choose a live read-only connection only when there is no checked-in truth. The form shows the exact catalogs and says no rows will be read.
- **The first snapshot is a draft of the reference, not a publication.** Public exposure is a separate switch with a review list.

### 10.2 Keeping it current

- **A push webhook is the trigger** (ADR-061/063). A daily reconciliation is the safety net; a "Sync now" action exists for a manager.
- **A snapshot is built off the request path**, by the job runner, with the same worker pool and budgets as ADR-062. A failed build keeps the previous snapshot and notifies the source's administrators.
- **A snapshot diff is shown** before it becomes current: new, removed, renamed, signature-changed, deprecated. A manager can see it; a writer sees only the documents affected.
- **CI is the alternative** for teams that need their own toolchain (CD-16). The artifact is idempotent and versioned, and a failed upload leaves the previous snapshot current.
- **Tags are first-class snapshots** for public versions. A branch is a moving snapshot; a tag is immutable. Retention keeps tagged snapshots and the last N branch snapshots; the policy is shown to the admin.

### 10.3 Coverage and the inbox

Coverage is the maintenance surface, not a vanity metric:

- **Public API documented:** the share of exported symbols with a `documented-by` claim, by package, with a trend.
- **Mentioned only:** referenced but not claimed; a hint, not a pass.
- **Undocumented:** neither; grouped by package, with the scaffold action.
- **Stale:** signature or description changed since publish, by document and by entity.
- **Broken:** missing or ambiguous after a rename.
- **Schema:** tables with no description, columns with no description, tables with no owning guide, declared-to-deployed drift.
- **Orphans:** guides that reference nothing and tables no guide mentions; useful for information architecture, not a failure.

The **needs-attention inbox** is one list per workspace with filters by source, package, state and owner. It supports bulk acknowledge, bulk refresh, and snooze until a date. It sends a weekly digest to owners, not a notification per symbol; the outbox consumer aggregates.

### 10.4 Creating documentation without sprawl

- **Scaffold, not generate prose.** "Create a guide" from a symbol or a package produces a draft with the entity's name, signature, parameter table, doc summary and a `covers` claim, plus template sections for purpose, behaviour, examples and failure modes. The author writes the explanation; the index fills the mechanical parts.
- **One guide per cohesive area.** The picker shows how many entities a new guide would claim and warns when the set is too broad. The default is the module or a cluster the author selects, not every symbol in a package.
- **No auto-publish.** A scaffold is a draft. A release can require a review, not a generated page.
- **Promotion, not duplication.** A symbol with a guide gets a page; the guide remains the document, and the generated sections are composed around it. The guide is not copied into the reference.
- **Templates** reuse ADR-054: a built-in "API guide" and "Data dictionary" template, with questions for performance, failure modes and ownership. The template's required sections are indicated, never enforced (ADR-029).

### 10.5 Acknowledging change

- **Acknowledge** records the reviewed hash, the reviewer and a note; it suppresses only the exact change.
- **Snooze** hides a finding for a chosen period, with a reason, and returns it.
- **Bulk refresh** updates the rendered references and their stamps for a selection; it never edits prose.
- **Review before publish** lists stale and missing references in the publish dialog, with links to the guide and the diff. The default is a warning; an opt-in policy can block a publish for a named package.
- **A release summary** lists new, changed and removed public entities since the last tag, with the guides affected. This is useful for release notes and for the "what changed?" question in CD-07.

### 10.6 Ownership and review

- A **source** has an owner (the team that connected it) and an optional `CODEOWNERS` import for package-level suggestions.
- A **guide** has the existing owner and lifecycle properties (ADR-055, ADR-059). The symbol page shows the covering guide's owner; it does not invent one.
- A **table** gets an owner from its owning guide or the source's configured owner. An unowned table is reported, not guessed.
- A **review date** on a guide appears on the symbol page, so a reader can judge currency. The existing review signals gain "covers a changed symbol" as another reason a page is due.

### 10.7 Maintaining the map and the flows

- **The map is reviewed like code.** `docs/quill.reference.yaml` lives beside `docs/quill.yaml`, changes in a pull request, and is read by the indexer. The settings copy exists only for a team that cannot add the file; it is the same shape and the same validation.
- **A map change is previewed.** Adding a path or a table shows which entities join or leave the module, which guides and flows would break, and which modules become empty or unowned. Saving writes nothing to the repository.
- **A module without an owner, a path or a purpose is a finding**, not a silent default. The coverage page lists it beside stale and missing references.
- **A flow is a document with a review.** A step that no longer resolves is a broken reference; a flow that no longer matches the code is a stale guide. Both appear in the inbox, and both are fixed by editing prose or retargeting a reference, never by regenerating the flow.
- **The map is not regenerated from folders.** The tool proposes groups from packages, schemas and table prefixes on first connect; a person confirms the names, the boundaries and the owners. A generated map that is wrong is worse than no map.
- **Quarterly, not per release:** the map is reviewed for module drift, new modules, retired modules, and flows that no longer reflect the product. The review is a normal document with an owner and a date, not a new workflow.
- **The health of the map is visible on the map**, not buried in an admin report: modules without an overview, stale guides, unowned tables and broken flows. A clean map is the first thing a new developer sees, so it is worth keeping clean.

## 11. Clean, sleek and polished

This feature will fail if it looks like a generated dump. The following are acceptance criteria, not aspirations.

### 11.1 Design rules

- **One renderer, every surface.** The app, the public site, the export and the preview use the same templates and the same design tokens, as ADR-023 and ADR-062 require. There is no second "API docs" theme.
- **One page per concept.** A module page, a symbol page and a table page each have one template. The same `ParameterTable`, `Signature`, `MemberList`, `EntityCard`, `Provenance` and `Backlinks` components are used everywhere.
- **Human first, generated second.** When a guide exists, its first paragraph leads. Generated detail follows. The generated stamp is quiet and always present.
- **No empty sections.** A section with no data is omitted, not rendered with "None". An entity with no doc comment gets one honest line and an action, not a blank panel.
- **No raw tags or JSON.** Doc-comment tags become the platform's components. A field the renderer does not understand is shown in a small "Additional metadata" disclosure, never as a wall of text.
- **Progressive disclosure.** Members, inherited members, private members, type parameters, source paths and the graph are folded or paginated. The first screen is the answer.
- **Bounded pages.** A class with 500 members, a table with 300 columns and a package with 2,000 symbols all remain usable: grouped, filtered, paginated and searchable within the page, with a sticky outline and a "jump to" control.
- **Stable layout.** Signatures scroll horizontally inside their card; the page never scrolls sideways. Tables scroll inside their region. A long identifier wraps only where the language allows it.
- **Light, dark, print.** Signatures, callouts and tables use theme tokens. A print stylesheet keeps the signature, parameter table, provenance and links, and drops interactive controls.
- **Mobile.** One column; the outline becomes a disclosure; the graph becomes a list; chips are tappable; code scrolls inside its card. No hover-only information.
- **Accessibility.** Semantic landmarks; `article` for a symbol; `table` with `th scope` for parameters and columns; `dl` for key-value metadata; heading order; visible focus; keyboard-complete explorer and picker; axe on every page template; a list fallback for every diagram; states in words, not colour.
- **No dead ends.** A missing reference, an empty source, a failed index, a private target and a stale snapshot each have designed copy and an action. "Something went wrong" is not a state.

### 11.2 The generated page as a product surface

- **A reference page has a design review like any other page.** It gets visual regression tests at three widths, in light and dark, with a long signature and a deprecation. A change to the template is reviewed by someone who cares about reading.
- **A page's first screen answers three questions:** what is it, where is it from, and what should I read next.
- **The generated stamp is provenance, not apology.** "Generated from acme/payments at a1b2c3d · 2 minutes ago" with a "How this page is built" link. It is not a warning banner.
- **The reference does not imitate the code host.** It is a Quill page, with Quill's typography and navigation. The source link is a secondary action.
- **Thin pages do not get indexed.** A public symbol with no doc comment and no guide is reachable from its module page but is not a canonical, indexable page. This protects both the reader and the search index; it also gives the team a reason to document.
- **A guide and its reference read as one thing.** The guide's "Covers" line, the reference's "Read first" block and the shared backlinks make the pair obvious without duplicating either.

### 11.3 Quality gates

- **Visual regression** for the symbol, table and package templates, at 320, 768 and 1280 px, light and dark, with long names, deprecation, no doc comment, and a 200-member entity.
- **axe** on every page template and on the picker with its list open.
- **Keyboard journeys** for the explorer, the picker, a reference card and a table with a horizontal scroll.
- **Round-trip tests** for every reference directive, including unknown attributes and an uninstalled extension.
- **Snapshot tests** for the generated artifact and the rendered page, so a change to the extractor or the template is visible in review.
- **Performance budgets:** the reference route is a lazy chunk; the reading route's bundle does not grow; symbol pages are server-rendered and cached; search p95 stays within the search budget; index builds and page assembly have budgets in section 12.4.
- **Link integrity:** a broken entity link, a missing backlink and a stale snapshot are tested states, not production surprises.

## 12. Architecture

### 12.1 Layering

```text
Domain        ReferenceEntity, ReferenceSnapshot, ReferenceSource, DocumentEntityReference,
              ReferenceState, Moniker, SchemaDialect, coverage calculations
Application   ports: ReferenceIndex, ReferenceSearch, ReferenceArtifactStore, SchemaIntrospector?
              use cases: ConnectReferenceSource, PreviewReferenceSource, IngestCodeIndex,
              IngestSchemaSnapshot, BuildReferenceSnapshot, RecordDocumentReferences,
              ResolveReference, AcknowledgeReference, PublishReferenceSurface
Infrastructure  packages/code-index (neutral artifact, extractors, importers)
                apps/server/src/infrastructure/reference (Postgres, search, jobs)
                apps/cli (quill index, quill check integration)
Server        routes call use cases; public templates use the same components
Web           routes, components and hooks; never infrastructure
Markdown      reference directives, render slots, editor bindings
```

- **Domain** imports nothing from React, Fastify, Drizzle or a language parser. It owns the states and the rules: what a valid reference is, when it is stale, what coverage means, which entity kinds exist.
- **Application** declares the ports and the use cases. It never runs `git`, a compiler, or a database driver.
- **`packages/code-index`** is portable and pure: the artifact schema, the normaliser, the deterministic serialiser, the extractor interface, and the language adapters that do not need server infrastructure. It can run in the CLI and in a server worker. It imports no Fastify, Postgres, React or auth. **It starts from the PMS's `scripts/code-index`**: the compiler extractor, blob-SHA cache, public-surface walk and search page are the reference implementation, lifted behind the artifact contract rather than rewritten.
- **The server** owns the Postgres repositories, the job runner, the SSE fan-out, the routes and the public pages. The indexer runs in a worker with limits.
- **The web app** owns the explorer, pages, picker and editor bindings. It reads domain types and the generated API client.
- **Markdown** owns the directive syntax, the slot rendering and the editor node. The resolution of a moniker is an application concern passed in at assembly, never a fetch inside the renderer.

### 12.2 Ports and patterns

| Name | Kind | Why |
| --- | --- | --- |
| `ReferenceIndex` | port | Query entities, snapshots, edges and backlinks; the server's Postgres adapter implements it. |
| `ReferenceSearch` | port | A separate ranking profile for exact names and kinds; the Postgres search adapter implements it beside the document index. |
| `ReferenceArtifactStore` | port | Raw artifacts in the blob store, content-addressed, so a snapshot can be rebuilt and audited. |
| `CodeIndexExtractor` | strategy/registry | One interface, one entry per language or format; `KNOWN_EXTRACTORS` and `createIndexer(config)`. |
| `SchemaSource` | strategy/registry | One interface, one adapter per dialect or declared schema; a factory chooses by configuration. |
| `SchemaIntrospector` | port | A live database connection behind the SSRF-safe client; the artifact path does not use it. |
| `ReferenceSourceProvider` | provider | `forWorkspace(id)` or `forSource(id)` yields the source configuration and its credentials, as the content store does. |
| `resolveReference` | pure function | Moniker + snapshot + alias → entity version or a typed result (`missing`, `ambiguous`, `renamed`), testable without a database. |
| `coverageReport` | pure function | Entities + references → counts and findings; no HTML, no permissions. |
| `ingestArtifact` | command | Validate, normalise, deduplicate and write a snapshot in one transaction; idempotent on the artifact hash. |

The patterns catalogue's names are used deliberately: ports for boundaries, a registry for languages, a factory for adapters, a command for ingestion, a reducer/state machine for reference status. No new universal abstraction is introduced before the second real adapter exists.

### 12.3 Storage sketch

```text
reference_source        id, workspace_id, kind (code|schema), provider, config jsonb,
                        visibility (workspace|public), status, created_by, last_synced_at
reference_snapshot      id, source_id, ref, commit, label, format_version, fidelity,
                        extractor, extractor_version, artifact_hash, stats jsonb,
                        state (building|current|failed|superseded), created_at
reference_entity        id, source_id, moniker, kind, name, qualified_name, package,
                        module, parent_id, first_seen, last_seen
reference_entity_version id, entity_id, snapshot_id, signature, doc_summary, doc_body,
                        location jsonb, visibility, deprecated, attributes jsonb,
                        signature_hash, doc_hash
reference_edge          snapshot_id, from_entity_id, to_entity_id, kind, evidence jsonb
reference_alias         source_id, old_moniker, new_moniker, confidence, confirmed_by,
                        confirmed_at
schema_capture          snapshot_id, dialect, database, captured_at, source_kind,
                        connection_ref (secret name), stats jsonb
document_entity_ref     document_id, revision_id, entity_id, snapshot_id, kind
                        (mention|signature|source|table|erd|cover), display, anchor,
                        signature_hash, doc_hash, state, acknowledged_hash, acknowledged_by
```

- **Current vs history:** `reference_entity_version` is per snapshot; `reference_entity` is stable. A page reads the current snapshot's version; an old link can read the snapshot it names.
- **Hot path:** the current snapshot is marked; indexes on `(source_id, moniker)`, `(source_id, kind, name)`, `(from_entity_id, kind)` and `(document_id, state)` keep pages and the inbox fast. The search table is separate.
- **Raw artifacts** are content-addressed blobs, retained for the snapshots the policy keeps. Ingest is streaming; the server never holds a whole monorepo artifact in memory.
- **Document references** are rebuilt per publish from the link index and the front matter, in the same transaction that records the revision, so a backlink never points at an unpublished draft.
- **No foreign key from a document to a symbol** that would prevent a document from surviving a source disconnection: `entity_id` is nullable in the resolved view, and the moniker plus display text remain on the reference row.

### 12.4 Performance and budgets

| Operation | Budget | How |
| --- | --- | --- |
| CI index, 100k symbols | under 5 minutes on 4 cores, cold | compiler API/importers, file-hash cache, worker pool, deterministic streaming |
| Incremental index, 100 changed files | under 30 seconds | only changed files parsed; artifact diff |
| Server ingest, 100k symbols | under 90 seconds | streaming JSONL, batched COPY, one transaction per snapshot |
| Symbol page, server-rendered | p95 under 200 ms cached, under 500 ms cold | current snapshot only, batched backlinks, rendered cache keyed by snapshot + entity hash |
| Reference search | p95 under 300 ms on 1M entities | FTS + trigram, exact-name index, keyset paging, permission filter in SQL |
| Page assembly with 40 references | one batched query, no N+1 | resolve all monikers for the page at once |
| Explorer page | keyset pagination, no full tree | package children loaded on demand |
| ERD | lazy, bounded to the selected tables | server-side SVG for the public site; interactive only on demand |
| Reading route bundle | unchanged | reference route lazy; no graph library on the reading route |

The budgets are enforced the way the repository already enforces them: a benchmark with a corpus, a bundle check, and a test that fails on a regression. The index build is off the request path and has a deadline; a slow source cannot hold a publish or a reader.

**The PMS baseline is the first regression test:** 9,103 symbols over the whole non-UI repository in 17 seconds cold and 1.2 seconds warm, 8.5 MB of JSON, and 99.97% agreement with the compiler's own find-references. The hosted version must not be slower than the local one for the same corpus, and the local command must keep working.

### 12.5 Events

- `SourceSynced` / `ReferenceSnapshotBuilt` → update the search projection, compute the snapshot diff, mark affected document references, notify the source's owners.
- `DocumentPublished` → record document references, update backlinks, recompute coverage, invalidate the page cache.
- `ReferenceEntityChanged` (signature/doc/deprecation/rename) → the staleness state machine, the inbox, the digest, the SSE signal.
- `ReferenceSourceDisconnected` → keep the last snapshot for reading and backlinks, stop syncing, mark the source as historical.
- `ReferenceSurfacePublished` → public cache invalidation, sitemap, search.

All go through the transactional outbox (ADR-056); none is a direct call from a route.

### 12.6 Versioning and compatibility

- The artifact has a `formatVersion`; the server dispatches on it and refuses an unsupported version with a supported range (ADR-033). A newer server reads older artifacts.
- The reference directive has a syntax version carried in the extension id/version; unknown attributes are preserved; a document written for a newer Quill degrades to text in an older one.
- The database schema is migrated expand-and-contract. A new entity kind or column is additive.
- A source's extractor version is part of its snapshot; upgrading it is a new snapshot, never a silent rewrite of the old one.

### 12.7 What this does not reopen

- **Content store:** the index is derived data in Postgres and the blob store. It is not a document, not a revision and not a Git object. Nothing above the content-store port learns about Git; the indexer uses ADR-061's `ExternalSource`.
- **Markdown:** references are directives and degrade (ADR-002, ADR-039). The AST stays canonical.
- **Render cache:** references are slots filled at assembly, as live blocks are (ADR-031, ADR-032). The cached body stays pure.
- **Permissions:** the index is a workspace-scoped resource; public exposure is a filter through the existing public principal, not a new resolver. Source configuration follows ADR-061's administration model.
- **Data classification:** schema structure is documentation; rows are data. Table and column names, types, keys, constraints, indexes and comments are indexed and visible to workspace members. Row values, message bodies, guest details, payment details and call recordings are never read. The adapter enforces it with a catalog allowlist and a record-shape check, so there is no redaction problem and no row to leak.
- **Public site:** reference pages are server-rendered from the same templates and theme (ADR-023).
- **Search:** reference search is a second index and ranking profile, not a change to document ranking; the parser, chips and refinement are reused (ADR-010).
- **Extensions:** a language adapter is a packaged-tier extension (ADR-039); a reference block is a component block (ADR-060); the editor binding is required.

### 12.8 The map manifest and flow documents

The map is not a new store or a new permission model. It is a **view** over entities and documents the platform already has, plus two small, reviewable inputs:

- **`docs/quill.reference.yaml`** is source-level configuration, versioned with the source beside `docs/quill.yaml`. It is validated against a JSON Schema (`map/v1`), read by the indexer, and stored with the source's settings so the UI can render the map without a repository fetch. It names modules, paths, tables, owners, guides, flows and curated dependencies. It is data, never code, and it grants nothing.
- **A flow document** is an ordinary Markdown document with `flow:` front matter and an ordered list inside a `:::flow` container. It is stored, published, versioned and permissioned exactly like any other document. Its references are the same entity references as section 9, so backlinks and staleness work without a second mechanism.
- **`buildModuleMap`** is a pure function from the manifest, the current snapshot, the published documents and the access-filtered entity set to the map view. It has no I/O; the use case supplies the inputs. It is tested without a database.
- **Membership is by rule, not by copy.** A module's entities are those whose path or table matches the manifest, plus the entities reachable through a curated flow. A moved file or renamed table appears in the diff as a membership change, so the map cannot silently rot.
- **Health is recomputed, not stored as a score.** Coverage, staleness and broken flows are projections of the reference state, the document state and the map; a cached health summary is invalidated by the same outbox events.
- **The map is permission-filtered at read time.** The manifest can name a path or table the reader cannot see; the map omits it and the counts, exactly as search does. The manifest itself is visible only to workspace members who can read the source.

The flow directive reuses the platform's component-block contract (ADR-060): a schema for its props, a renderer, an editor binding and a static form. It is not a new execution surface, and a flow without the extension still reads as its ordered text.

## 13. Rollout

This should not be inserted before the foundations it reuses. The PMS can prove the index locally now (`pnpm code:index`); the hosted layer waits for ADR-061/062 and the internal Quill instance. The earliest useful slice is after M5 (Trust). It is milestone **M6a**, after M6 (Maintain), whose backlinks and quality signals are the same machinery. It must not delay Release 1.

### R15 — research spike (during M5, 3 to 4 weeks)

Prove the hosted shape on **the PMS first**, reusing the local index it already has, with Quill's own TypeScript monorepo as the second corpus:

- **Lift `scripts/code-index` into a portable package.** Keep the compiler-API extractor, the blob-SHA cache and the measured speed; move the logic behind the artifact contract so the CLI and the server can both run it. It is the source of truth for what "extraction" means, not a rewrite.
- **Extend the index** from the two scoped packages to every non-UI package, then the TSX apps. Add class members, `@see`/`{@link}` edges and `@concept` pages; keep the two-package 568-symbol and whole-repo 9,103-symbol results as regression evidence.
- **Add the schema index** over the 197 tenant tables and the control plane: migrations, Kysely types, live catalog, keys, constraints, indexes, comments, ownership and drift. It is a new extractor, not a second code index.
- **Write `docs/quill.reference.yaml`** for the seven modules and the core sub-domains and run the preview: paths that match nothing, tables that match nothing, modules with no owner, modules with no guide.
- **Write the three flows** in section 4.3.6 and prove that every step resolves to a symbol or a table, that the flow renders as a narrative and a list, and that entity pages link back to it.
- **Host the result in the internal Quill instance** behind the existing zero-trust proxy, with the source's sync status and the index's freshness. The public/customer instances are ADR-0150's.
- **Write, publish and re-read** a document with `:code`, `::signature`, `:::flow` and a `covers` claim; prove the byte-for-byte round trip and assembly-time resolution.
- **Run the twelve questions** (section 4.3.8) with one novice and one senior, and record the time and the failures.
- **Measure** cold and incremental index time against the existing 17 s / 1.2 s baseline, artifact size, ingest time, page p95, search p95 and bundle impact.
- **Prototype the rename alias and one stale-signature diff**, and decide the moniker grammar, the internal-only surface and the first adapter set.

**Exit:** the numbers are inside the budgets in section 12.4 (or the ADR records why not), the round trip is byte-identical, the pages pass axe and the visual checks, the map preview reports no silent mismatch, and a novice and a senior can complete the twelve questions within the prototype's criteria.

### Phase 1 — the useful slice, proven on the PMS

**The PMS prototype:**

- **The map:** seven top-level modules and the core sub-domains with an owner, purpose, key concepts, paths, tables, guides, flows and curated dependencies; `docs/quill.reference.yaml` reviewed in the repository; the map page, module cards and dependency list.
- **Module overviews:** every module and core sub-domain has a published guide with purpose, owner, key concepts, entry points, tables, flows, failure modes and what to read next.
- **Three flows:** A change reaches every site, A booking arrives, A property goes live, each with validated steps and a narrative; the support and finance flows are the stretch.
- **Guided paths:** the five paths in section 4.3.7, written as normal documents and linked from the map; "Your first week" is complete.
- **Data dictionary:** the 197 tenant tables indexed, with the top thirty described and owned; every table page shows its module, migration and owner.
- **The twelve questions:** moderated with a novice and a senior; the prototype's exit criteria met.

**Generic slice:**

- **Code:** TypeScript/JavaScript through the proven compiler API; a connected repository through ADR-061 and a CI artifact upload. Standard-format importers (SCIP, TypeDoc, rustdoc, Dokka, Doxygen) are Phase 2 for other repositories, not for the PMS.
- **Schema:** Postgres with plain SQL migrations and hand-written types (the PMS's actual shape), plus live catalog introspection for drift; Prisma, Drizzle and other declared schemas follow in Phase 2.
- **Pages:** Reference home, package/module pages with anchors, promoted symbol pages, table pages, explorer, recency, freshness.
- **Search and palette:** reference search, `@` scope, groups, filters, keyboard.
- **References:** `:code`, `:schema`, `::signature`, `::source` (through M5), `::table-card`, `:::flow`, `covers`; backlinks; the staleness state machine; the document's linked-code panel.
- **Maintenance:** preview before save, snapshot diff, coverage report, needs-attention inbox, acknowledge/refresh, scaffold from a symbol.
- **Public (for a public source such as an OSS project, not the PMS):** reference pages for one selected source, exported surface only, sitemap and canonical rules, server-rendered.
- **Quality:** round-trip, visual, axe, keyboard, budgets, and a benchmark.
- **Not yet:** ERD, model-to-table mapping beyond one ORM, drift, versions, other languages, CI gates, cross-repository identity.

### Phase 2 — breadth and trust

- **The PMS, complete:** every module and core sub-domain mapped and owned; the remaining flows (support request, owner statement, call to task, rate update, night audit); every table described; drift between migrations, Kysely types and the live schema; the ERD; support triage tested with a real incident; the data dictionary exported for audit.
- SCIP import for Go, Java, Kotlin, Rust, Python, Ruby and .NET; rustdoc JSON and Dokka; tree-sitter fallback.
- MySQL, SQLite, SQL Server; SQLAlchemy, Django, Drizzle, Hibernate and EF Core metadata; declared-to-deployed drift; model-to-table mapping and a drift report.
- ERD with an accessible list and an embedded block; data dictionary export.
- Public version selector, tag snapshots, retention and unsupported-version notices.
- CI coverage gate, `CODEOWNERS` suggestions, release summary, digest notifications.
- Publish warnings and opt-in blocking policies; review-surface integration.
- Partner-facing API reference for a platform that needs one, reusing the public surface and version rules.

### Phase 3 — depth

- Cross-repository and monorepo graphs; a symbol from one source used by another.
- OpenAPI, GraphQL and Protobuf as reference sources, reusing the same entity model.
- Pull-request comment: which guides a change affects (CD-25).
- Call graphs and impact analysis where a compiler provides them, bounded and paginated.
- More language adapters; a published adapter guide and conformance corpus.

### Dependencies and risks

| Risk | Mitigation |
| --- | --- |
| Scope creep into an IDE or code search | The index stores declarations and relationships, not bodies; search is documentation search, not grep. The non-goals are in the ADR. |
| Language matrix explosion | The artifact contract and CI lane make a language a build step, not a Quill feature. Native adapters cover only the first languages. |
| Thin generated pages and SEO spam | Module pages by default; promotion only with a guide or substance; `noindex` for thin pages; sitemap lists documented pages. |
| Staleness alert fatigue | Per-reference state, severity, acknowledge with a hash, digest, snooze, and no alert without an actionable diff. |
| Generated pages feel bolted on | Same design system, same templates on every surface, design review, visual regression, one page per concept. |
| Parser drift and false confidence | Explicit fidelity, extractor versions, fixture corpora, diagnostics, and a "what is missing" line. |
| Privacy of row data | Only structure is indexed; no row values, message bodies, guest details, payment details or call recordings; source excerpts permission-checked; audit. |
| Index cost and storage | Incremental builds, current snapshot hot path, tags retained, branch snapshots pruned, streaming ingest. |
| Index failure blocking docs | The previous snapshot serves; failures notify admins; reading and publishing never depend on the index. |
| Renames breaking links | Aliases, Git rename detection, confidence review, old addresses redirecting, missing state instead of 404. |
| Users expect AI to write the docs | Explicitly out of scope; the scaffold is deterministic and the guide is human. |

## 14. How this compares

| Product | What it does well | What it does not do |
| --- | --- | --- |
| **Backstage TechDocs** | Docs next to code, a software catalogue, one portal | Code and schema are not a navigable, cross-linked graph; no prose-to-code backlinks or staleness |
| **Sourcegraph** | Code search and code intelligence at scale | Not authored documentation, no guides, no schema dictionary, no public docs site |
| **Docusaurus / TypeDoc / MkDocs** | Fast static API reference and guides | Separate build, weak two-way links, no permissions, no schema, no freshness state |
| **Mintlify / ReadMe** | Polished API docs and references | Spec-driven public docs, not an internal knowledge platform; weak code/schema graph |
| **SchemaSpy / dbdocs** | Schema diagrams and data dictionaries | No code, no prose, no permissions, no maintenance workflow |
| **Swimm** | Docs coupled to code | Not a general documentation platform, no public site or schema index |
| **Confluence / Notion** | Prose and collaboration | No first-class code or schema graph, no generated reference, no freshness |

The wedge is not "another API reference generator". It is **one permissioned, versioned, searchable place where the guide and the reference are the same knowledge**, with the code and schema as first-class, living sources.

## 15. Success criteria

The feature is working when:

- A new developer answers "what does this service do and what does it touch?" from one page, without opening the repository.
- An experienced developer reaches an exact signature in two keystrokes and never sees a stale copy in a guide.
- A writer inserts a reference once and is told, with a diff, when the code changes under it.
- A tech lead can name the undocumented public API and create the guides that close the gap.
- A backend engineer can read a table, its relationships and its owning model without a database client.
- A maintainer publishes an API reference from CI, with versions and guides, and does not hand-edit a generated page.
- Every reference survives export, print, Git sync and an uninstalled extension.
- Nothing leaks: a reader sees only the symbols, tables and documents they may read; the public site sees only the reviewed surface.

**On the PMS specifically:**

- A new developer answers at least ten of the twelve questions in section 4.3.8 in twenty minutes, without help, and names the first three files they would open for a small change.
- A senior developer reaches the exact symbol behind any named business rule in under thirty seconds, and lists the modules, tables and flows affected by a proposed schema change.
- A support engineer goes from a stuck booking to the flow, module, table, trace and owner in under two minutes.
- Every module has an owner and a published overview; every flow's references resolve; every table in the top thirty has a description and an owner; the schema's 197 tenant tables all have a page.
- The map is reviewed quarterly and is the first thing a new developer opens, not a page they are told about in a meeting.

**Leading indicators:** sources connected; references per published guide; module coverage; flow validity; public-surface coverage; stale references resolved per release; schema tables with an owning guide; reference search success; time from a push to a fresh snapshot.

**Guardrails:** reading-route bundle unchanged; document p95 unchanged; symbol page p95 inside budget; search p95 inside budget; index freshness under five minutes for a connected source; zero generated pages in the sitemap without a guide or a doc comment.

**Anti-metrics:** the number of thin generated pages (should be zero), stale alerts per guide per month (should fall), the number of references acknowledged without a review note (a hint that the alert was noise), and the number of modules with no owner (should be zero in the prototype).

## 16. Open questions

1. **Name.** "Reference" is the working name for the area; "code index", "API reference" and "schema explorer" are the jobs. The product name is ADR-026's problem.
2. **Moniker grammar.** Adopt SCIP's symbol format verbatim, or wrap it with a source prefix? What is stable across a package rename?
3. **Default language set.** TypeScript, Python and Go first? Does SCIP import make a native Python adapter unnecessary?
4. **Default page shape.** Is the module page with anchors sufficient, or do developers expect a page per class? The proposal is module-first; this needs a usability test with novices and experts.
5. **Public versions.** Which version is canonical: the default, the latest, or the version itself? Are unsupported versions `noindex` or canonical to the supported one?
6. **Source excerpts.** Is a signature a documentation fact (visible to any workspace reader) while a source excerpt needs repository access? The proposal separates them; it needs a security review.
7. **Database credentials.** Is a live read-only connection acceptable for the first release, or is a checked-in schema artifact the only safe default?
8. **Coverage gate.** Which packages count as the public surface, and who may set a blocking gate?
9. **Span of the first index.** Tests, internal packages, generated code and vendored dependencies are excluded by default. Does a monorepo need a per-package policy on day one?
10. **Cross-repo identity.** When one repository's symbol is used by another, is the moniker source-scoped or globally unique? Phase 3 needs the answer.
11. **Call graphs.** Are they worth the storage and the false confidence, or is `uses` enough?
12. **Ownership.** Does `CODEOWNERS` import create a grant, a suggestion, or only a label? It must not become a permission.
13. **Retention.** How many branch snapshots are kept, and for how long, before a page's "as of" link can 404?
14. **Scaffold policy.** Should a workspace administrator be able to create guide stubs in bulk, and who owns them?
15. **Search scope.** Does an ordinary query search code by default, or only after `@`? The proposal shows code groups when they match; this needs measurement.
16. **The PMS's data boundary.** The user has ruled that schema structure is not sensitive and the rows are. Which row-shaped values still need special handling in logs, traces and source excerpts, beyond the "never indexed" rule?
17. **The map manifest's home.** A sibling `docs/quill.reference.yaml` is the proposal. Does it become a block in `docs/quill.yaml` instead, so there is one manifest for docs and reference?
18. **Flow markup.** Is `:::flow` around an ordinary ordered list enough, or does a step need its own node? The list form degrades best; it should reuse the component-block contract rather than invent a second extension system.
19. **The first flows.** The core loop, a booking and a property going live are the proposal. Is a support or finance flow more valuable for the first cohort? The twelve questions decide.
20. **Public surface.** The PMS is internal-only; Scalar stays the public API reference. Is there any internal schema or symbol that should be hidden from staff, or is workspace membership the only gate?
21. **The existing local index.** Does Quill host the index as an artifact generated in CI, or does the server run the extractor? The current local prototype and the 17 s cold run make CI the obvious first lane.

## 17. Proposed decisions for the ADR

When this is promoted, the core is one ADR (the next free number; **065**, because the math work takes 064), with these decisions. A second ADR can cover the reference syntax and the map/flows if they grow.

1. **A derived reference index, not documents.** Code symbols and database entities live in Postgres with raw artifacts in the blob store; they are never content-store documents and never editable in Quill.
2. **One entity model with explicit kinds and fidelity.** Symbols, tables, columns and future spec operations share search, references, permissions and pages; every source declares `semantic`, `declared`, `syntactic`, `exact` or `authored`.
3. **The artifact is the generic language boundary.** `quill index` in CI is the primary lane; native adapters cover the first languages; standard formats (SCIP, rustdoc, Dokka, Doxygen, TypeDoc) are importers; tree-sitter is the honest fallback. No language is hard-coded into the pages.
4. **Metadata only.** No function bodies, no rows, no sample values. Source excerpts go through M5's source-reference path and its permissions.
5. **Stable monikers, snapshots and aliases.** Documents store monikers; renames create aliases; deletions leave tombstones; old addresses redirect.
6. **References are directives that render as slots.** The cached body stays pure; assembly fills current metadata; the fallback is readable Markdown; the editor binding is required.
7. **A claim (`covers`) is separate from a mention.** Coverage counts both; only a claim is "documented".
8. **Generated module pages by default, promoted symbol pages by exception.** No page per symbol; no thin pages in the sitemap.
9. **Human guides lead, generated reference follows.** One renderer on app, public site, export and preview.
10. **Public exposure is an explicit, reviewed filter.** Only exported/public entities, chosen packages and reviewed pages; no private names, links or guides.
11. **Freshness is a state machine with acknowledgement.** A signature change is a diff to review, not proof of wrong prose; a publish warns and only a policy blocks.
12. **The index never blocks reading or publishing.** The last good snapshot serves; a failed index is an admin signal.
13. **Performance and accessibility are acceptance criteria**, with the budgets in section 12.4 and the quality gates in section 11.3.
14. **The map is a reviewed manifest plus documents, not an inference.** Modules, paths, tables, owners, guides and flows are declared in `map/v1` configuration, validated, previewed and permission-filtered. A generated proposal is never presented as fact.
15. **A flow is a document with validated steps.** `flow:` front matter and an ordered list inside `:::flow` reuse the entity reference and backlink machinery; a flow is versioned, reviewed and published like any guide, and its broken steps are ordinary broken references.
16. **The PMS is the prototype and the acceptance test.** The first implementation is considered useful only when at least ten of the twelve PMS questions pass for a novice and a senior, and the map, flows and module overviews are complete enough to replace a meeting. The existing `scripts/code-index` extractor, cache and measurements are reused, not replaced.
17. **Structure is documentation; rows are data.** Table and column names, types, keys, constraints, indexes and comments are indexed and visible to workspace members. Row values, message bodies, guest details, payment details and call recordings are never read. The adapter enforces it with a catalog allowlist and a record-shape check.
18. **The PMS's index is internal.** The code and schema reference lives on the internal Quill instance; the public and customer instances keep ADR-0150's audience boundary and Scalar reference. A public OSS reference is a separate source and surface, not the PMS schema.
19. **Hosting is additive to the local tool.** `pnpm code:index` and its artifact remain the inner loop for an engineer's machine; the hosted layer reuses the same extractor and artifact. The local-only ruling of 2026-10-25 is extended, not discarded.
