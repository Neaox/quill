# ADR-039: Markdown extensions

**Status:** Accepted
**Date:** 2026-10-11
**Related:** ADR-002 (Markdown is canonical), ADR-004 (one definition per directive), ADR-011 (security baseline), ADR-031 (render caching), ADR-032 (live blocks), ADR-036 (diagrams and reading blocks), ADR-037 (tenant labels), ADR-038 (emoji), quill-plan.md principle 9 ("open and extensible"); ADR-060 (proposed: component blocks)
**Guide:** [docs/extending/markdown-extensions.md](../../extending/markdown-extensions.md)

## Context

Quill's Markdown vocabulary has grown one feature at a time: callouts, layout, badges, figures, cards, diagrams, labels, emoji. Each was written into four places by hand: the parser (`packages/markdown/src/directives`), the renderer (`render/handlers.ts`), the sanitiser's allowlist (`render/sanitize-schema.ts`) and the editor's schema (`packages/editor/src/schema`). The registry in `directives/registry.ts` is a fixed list.

The owner asked for plugins: installable extensions built on the underlying engine (unified, remark, micromark, mdast, hast), which "must work with the reading AND writing surface", are documented clearly, and are supported cleanly. They also asked that networked plugins not be ruled out, because live segments are planned.

A raw remark plugin cannot meet that on its own:
- It only covers reading. It parses and renders, but tells the editor nothing about how to show, edit or write back its syntax.
- It is server code. It runs inside every tenant's render, after which only the sanitiser stands between it and a page.
- It can be non-deterministic, which would break the render cache key (ADR-031), or change how core syntax parses, which would break every existing document's round trip (ADR-002).

## Decision

### One contract: the Markdown extension

An extension is a single typed object that covers every stage, so it cannot work on one surface and not the other:

```ts
interface MarkdownExtension {
  readonly id: string                  // 'acme.decision', unique, stable
  readonly version: string             // semver; joins the render cache key
  readonly syntax: ExtensionSyntax     // what it claims (below)
  readonly parse?: ...                 // mdast node -> model, with validation issues
  readonly serialize: ...              // model -> mdast node: the writing surface's way back to Markdown
  readonly render: ...                 // model -> hast: one template, shared by app, public site, export
  readonly sanitize: SanitizeGrant     // the elements, classes and attribute values its output needs
  readonly editor: EditorBinding       // the editor's node: a declared view, input rules, toolbar entry
  readonly live?: LiveBinding          // only for networked extensions (below)
  readonly styles?: string             // CSS under `.prose`, using theme tokens only
}
```

The built-in vocabulary is re-expressed as extensions over time, starting with the next feature that touches the directive code, so the contract is the one Quill itself uses rather than a side door. `KNOWN_DIRECTIVES`, the renderer's handler table, the sanitiser's schema and the editor's node list are each assembled from the installed extensions by one registry (`createMarkdownRegistry(extensions)`), built once per process at the composition root.

### What an extension may claim

- **Directives**, the default and preferred surface: `:name[...]{...}`, `::name{...}`, `:::name ... :::`. They already degrade to readable text everywhere else (ADR-002), so an uninstalled extension never breaks a document.
- **New inline or block syntax** through a micromark extension, allowed only with a fallback that reads as text, and only if it parses no existing CommonMark or GFM construct differently. The conformance kit proves this against the corpus.
- **Tree transforms** (remark or rehype) that touch only the nodes the extension owns.

An extension may never change how core CommonMark or GFM syntax parses, and never read or change nodes it does not own.

### Both surfaces, always

The `editor` binding is required. An extension chooses one of:

1. **A declared view**: one of the editor's existing node shapes (inline pill, block card, callout-like container, figure) filled from the model, with input rules and a toolbar entry.
2. **A custom node view**, for operator-tier extensions only (below).
3. **The source island**, the fallback any extension can use: the editor shows the rendered result, a click edits the Markdown source in place, and the source is written back byte for byte. Reading is exact, writing is honest, and a round trip never loses anything.

An extension with no editor binding is refused at registration, so no feature can exist on the reading surface alone.

### Three trust tiers

| Tier | Who installs | What it is | Where it runs |
| --- | --- | --- | --- |
| **Declarative** | An organisation administrator, in settings | Data: a directive's name, kind, attribute schema and one of the built-in renderings (badge, callout, card, figure, details, label, emoji) | Quill's own code; nothing new executes |
| **Packaged** | The operator of a self-hosted instance, at deploy time | A code package implementing `MarkdownExtension`, listed in instance configuration | In-process on the server and in the web bundle |
| **Adapted** | The operator | An existing remark or rehype plugin wrapped by `adaptRemarkPlugin(...)`, with an explicit sanitise grant and the source-island editor binding | As for packaged |

Tenants never upload code. A multi-tenant instance offers the declarative tier only, unless its operator chooses otherwise. Labels (ADR-037) and emoji (ADR-038) are the first declarative extensions.

### What the platform guarantees around every extension

- **The sanitiser runs last** (ADR-011). An extension widens the allowlist only through its declared `SanitizeGrant`: element names, class names, and attribute values as enumerations or patterns, never "any". Grants are listed per extension, so a review sees exactly what each one admits.
- **Rendering is a pure function.** For the same source and the same extension versions the output is identical, with no clock, randomness or I/O. Extension ids and versions join the render cache key, so upgrading one re-renders exactly the bodies that use it.
- **No author code.** An extension may offer authors syntax, never expressions or scripts (ADR-032's "not MDX" stands).
- **Budgets.** Each extension declares its render cost class. The conformance kit measures it against the corpus and fails it if it breaks the reading budgets in quill-plan.md section 31. Editor-side code loads lazily, only in documents that use the extension.

### Networked extensions are live blocks

An extension that needs the network does not fetch while rendering. It declares a `live` binding, which is exactly a live block type (ADR-032):
- an attribute schema;
- a fetcher that runs on the server through the SSRF-safe outbound client, with an integration's credentials and never the reader's;
- a cadence;
- a static renderer for snapshots;
- an island for the web app.

The body renders the slot deterministically, and page assembly fills it from the snapshot store. The network is never on the path of the cached body, and a failing source shows its last good snapshot. Live extensions are packaged-tier only, because their fetchers are code.

### Conformance kit

`@quill/markdown/testing` exports `describeExtension(extension, corpus)`. It runs:
- the round trip (Markdown → editor → Markdown, byte for byte for the corpus);
- degradation (the source reads sensibly with the extension uninstalled);
- the sanitiser's attack corpus against its grant;
- determinism (render twice, compare);
- the "no core syntax changed" check against the shared corpus;
- axe on its rendered output and editor view.

An extension that does not pass cannot be registered in a production build.

## Alternatives considered

- **Accept any remark plugin.** Reading only, unbounded output, and code from npm running in every tenant's render. Kept as the adapted tier, behind the operator and the kit, rather than as the model.
- **MDX or embedded components.** Rejected again for the reasons in ADR-032: not portable, an execution surface inside documents.
- **Tenant-uploaded code in a sandbox (WebAssembly or isolates).** It solves execution safety but not output safety, editor parity or determinism, and it is a large surface to secure. The declarative tier covers what tenants have asked for. Revisit if a real need appears.
- **No plugins, only built-ins.** It contradicts principle 9, and every customer-specific need would become core code.

## Consequences

- One registry replaces four hand-maintained lists, and adding a feature becomes adding one extension.
- Every feature exists on both surfaces by construction, because the editor binding is required.
- The security review of an extension is a review of its grant and its kit results, not of the whole renderer.
- Re-expressing the built-ins is real work. It happens incrementally, starting with the next directive change, and the guide documents the contract as it stands at each step.

## Delivery

1. This ADR and the guide (`docs/extending/markdown-extensions.md`).
2. The registry and the `MarkdownExtension` type in `packages/markdown`, with the four lists assembled from it. The built-ins move behind it one at a time, each move a no-change refactor proved by the existing corpus.
3. The conformance kit.
4. The declarative tier in settings: custom directives with a built-in rendering (labels and emoji first, then "custom directive").
5. The packaged tier with instance configuration, then `adaptRemarkPlugin` and the source-island editor node.
6. Live bindings with the live-block work in M5.
