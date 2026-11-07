# ADR-060: Component blocks, and MDX as a dialect

**Status:** Proposed
**Date:** 2026-10-17
**Related:** ADR-002 (Markdown is canonical), ADR-011 (security baseline), ADR-021 (drafts and locking), ADR-023 (public publishing), ADR-054 (template library), ADR-031 (render caching), ADR-032 (live blocks), ADR-033 (compatibility), ADR-036 (diagrams), ADR-039 (Markdown extensions), ADR-041 (code groups), ADR-042 (link previews and embeds), ADR-048 (details), ADR-050 (presenting), ADR-058 (navigation blocks); `quill-plan.md` sections 16, 21, 24 and 31; decisions D9 and D16

## Context

Adding a block to Quill today means writing it into seven places by hand:
- a `DirectiveDefinition` and its entry in `KNOWN_DIRECTIVES`;
- a branch in `render/handlers.ts`;
- the sanitiser's schema;
- a `CHROME` entry or a leaf-view `switch` in the editor;
- a slash catalogue item;
- CSS.

Attributes are edited only through bespoke controls: the callout menu, the language picker, and the hand-written **Settings** popovers ADR-058 gave `::toc` and `::children`. There is no generic way to edit a block's attributes. ADR-039 set out one contract for all of this, but its packaged tier assumes code installed at deploy time and leaves custom editing to "custom node views", which means ProseMirror.

The owner asked whether Quill should support MDX. The aim is that developers can add their own functionality without implementing a ProseMirror plugin. The owner sketched the shape:
- a module that exports a rendering version and an editor version;
- a kit of components for building editor UIs;
- a generated props dialog as the fallback editor;
- a declared schema for each block;
- both render-once and live blocks.

Three ADRs have already rejected MDX: ADR-002, ADR-032 and ADR-039. Read closely, what they reject is MDX's **semantics**:
- `import` and `export`;
- `{expressions}`;
- components that are code, chosen by the document.

These put an execution surface in every document, make rendering impure, and leave nothing to export. None of those objections applies to the *syntax* of a JSX tag with literal props.

An early draft of this ADR kept directives as the only spelling, on the grounds that directives "degrade better". The owner challenged that, and the challenge holds:
- **Readers never see the raw file.** Quill controls degradation wherever Quill renders, whichever spelling is stored.
- **The raw file matters only to people reading source** (a pull request diff, an IDE, an agent, the exit story). There `<Release version="2.4.0">` reads as well as `::release{version=2.4.0}`.

What actually separates the two spellings is:
- **Ecosystem.** Docusaurus, Astro, Next and Mintlify speak MDX, and teams already have repositories in it.
- **Parse safety.** Angle brackets are core CommonMark HTML, which ADR-039 says no extension may reinterpret.

## Decision

Quill gets **component blocks**: one module per block that covers its schema, rendering, editing, interactivity, live data and export, with no ProseMirror code. Documents can be stored in either of two **dialects**: `directives` (the default) or a data-only **MDX** subset. The AST stays canonical (D9), and Quill never evaluates JSX, ESM or expressions.

### 1. A block is a module, described by JSON Schema

The developer writes one module with `defineBlock` from a new package, `@quill/blocks`. `blockToExtension(block)` turns it into a `MarkdownExtension`, so ADR-039's guarantees apply unchanged:
- one registry;
- the render cache key;
- the sanitiser runs last;
- the conformance kit.

~~~tsx
// acme-endpoint/src/block.tsx
import { defineBlock, p, Prop, Content } from '@quill/blocks'

export default defineBlock({
  id: 'acme.endpoint',
  version: '1.0.0',
  name: 'endpoint',                       // ::endpoint / :::endpoint, and <Endpoint> in MDX
  title: 'API endpoint',
  description: 'An HTTP endpoint: method, path, authentication and parameters.',
  icon: 'plug',
  keywords: ['api', 'http', 'route'],
  mdx: { component: 'Endpoint', import: '@acme/docs/Endpoint' },
  content: 'blocks',
  props: {
    method: p.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], { title: 'Method', default: 'GET' }),
    path: p.string({ title: 'Path', pattern: '^/', examples: ['/v1/documents/{id}'], 'x-quill-inline': true }),
    auth: p.enum(['none', 'session', 'token'], { title: 'Authentication', default: 'session' }),
    params: p.list(
      p.object({ name: p.string({ title: 'Name' }), type: p.string({ title: 'Type' }), required: p.boolean({ title: 'Required', default: false }) }),
      { title: 'Parameters', default: [] },
    ),
  },
  render: ({ props }) => (
    <section class="qb-endpoint" aria-label={`${props.method} ${props.path}`}>
      <header class="qb-endpoint-head">
        <span class="qb-endpoint-method" data-qb-method={props.method}>{props.method}</span>
        <code><Prop name="path" /></code>
      </header>
      {props.params.length > 0 && (
        <table>
          <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Required</th></tr></thead>
          <tbody>{props.params.map((param) => <tr><td>{param.name}</td><td>{param.type}</td><td>{param.required ? 'Yes' : 'No'}</td></tr>)}</tbody>
        </table>
      )}
      <Content />
    </section>
  ),
})
~~~

**JSON Schema is the descriptor.** A build turns the module into a `block.json` manifest, validated against a published, versioned meta-schema (`block/v1`, ADR-033). The manifest is what Quill reads before, and often instead of, any code. It holds:
- id, version, name, title, description, icon, keywords;
- kind, `content`, `mdx`;
- `props`, a JSON Schema 2020-12 object;
- presets;
- grants, network origins and integrations;
- entry hashes, cost class and budgets;
- the listing fields below.

- **Props are plain JSON Schema:** `type`, `enum`, `default`, `examples`, `minimum`, `maximum`, `pattern`, `format`, `items`, `required`, `oneOf` with a discriminator, `readOnly`, `deprecated`, `title`, `description`. Every prop must have a `title`, and the build fails without one.
- **UI hints are a small vocabulary that other tools ignore:**
  - `x-quill-widget`: `textarea`, `slider`, `radio`.
  - `x-quill-ref`: `document`, `person`, `attachment`, `colour-token`.
  - `x-quill-group` and `x-quill-order`: layout of the form.
  - `x-quill-inline`: the prop is editable in place.
  - `x-quill-searchable`: the prop is indexed for search.
- **Authoring.** The `p.*` helpers are TypeBox, whose schemas *are* JSON Schema, as front matter (`front-matter/core-schema.ts`) and live blocks already use. Types come from `Static<>`. A developer may write the JSON by hand instead and get types from `FromSchema`.
- **Validation** reuses Ajv, as `front-matter/validate.ts` does:
  - on parse, producing issues for the editor;
  - in the props form, for live field errors;
  - at install, against the meta-schema.
- **JSON-only blocks.** A manifest with no code, naming one of the platform's renderings (card, callout, badge, figure, details, table), is a complete block. This is ADR-039's declarative tier, now with typed props and the generated form. An administrator can create one in settings with no build step.

**The manifest is also the listing.** The same schema carries everything a catalogue or marketplace needs, so a later marketplace needs no new format:
- `publisher` and `licence` (an SPDX identifier);
- `homepage`, `repository`, `changelog`;
- `categories`, `screenshots`, and `examples` (sample Markdown and MDX that a listing renders);
- `engines.quill` (a semver range, checked at install);
- `capabilities`: a readable summary derived from the grants, network origins, integrations, live binding and public-island flag, and the same text the install review shows;
- `integrity` and an optional publisher `signature`.

A catalogue is an index of manifests. Because a manifest can be read without running anything, a listing can show the props form, the presets and the capabilities before anything is installed. The meta-schema covers every kind of `MarkdownExtension` (component blocks, drawing claims such as draw.io, adapted remark plugins), so Settings → Extensions lists them all the same way. Marketplace hosting, publisher verification and review policy are a later decision.

### 2. Four kinds, one contract

What a block exports decides its kind:

| Kind | Exports | Where it runs | Examples |
| --- | --- | --- | --- |
| Static ("render once") | `render` | On the server at render time, cached in the body (ADR-031) | Endpoint card, decision record, pricing table, a chart drawn as SVG on the server |
| Interactive | `render`, `island` | Static body, then enhanced in the browser | Tabs, calculator, quiz, sortable table, chart tooltips |
| Live | `render`, `live`, optionally `island` | Fetcher on the server, never during render; a slot filled at page assembly (ADR-032) | Deploy status, issue lists, metrics, document queries |
| Viewer-scoped | `render` (a placeholder), `island` | In the browser only, per reader; never snapshotted, omitted from export | "Your open reviews", "You own this release" |

Blocks display; they do not act. A block that changes something outside Quill needs an integration with confirmation and audit (`quill-plan.md` section 21), and is a later decision.

### 3. One tree, two dialects

**The dialect is a setting at the serialisation boundary.**
- `markdown.dialect` is set per workspace (`directives` or `mdx`) and per Git-sync target, so a synced Docusaurus or Astro repository stays MDX.
- The parser reads both spellings in either dialect, and so do paste and import. The serialiser writes the workspace's dialect.
- Switching a workspace's dialect is an explicit bulk rewrite that is previewed first and lands as one commit. It never happens silently on save.
- Moving a document between workspaces of different dialects re-serialises and renames it in the same commit.
- Documents in the `mdx` dialect are `.mdx` files. The `.md` suffix is hard-coded today in four places: `content-store/src/git-content-store.ts`, `content-store/src/document-index.ts`, `application/src/use-cases/document-path.ts` and `content-store/src/commit-message.ts`. Each learns both suffixes. Documents are still addressed by id, never by path.

**Directive spelling.** The block's `name` is the directive name, and `content` chooses the form:

| `content` | Form |
| --- | --- |
| `none` | leaf, `::name{…}` |
| `inline` | text, `:name[…]{…}` |
| `blocks` | container, `:::name … :::` |
| `{ body?: 'blocks', items: '<child block id>' }` | container: an optional Markdown body, then the child blocks (tabs, steps). The serialiser counts the colons |

- **Scalar props** (string, number, boolean, enum, date, URL, document id, person id, attachment hash) are attributes, written in schema order.
- **Structured props** (arrays and objects) go in a first-child fence with the info string `yaml props`.
- Unknown attributes survive (rule 7). An unchanged directive keeps its exact bytes through `pipeline/source-form.ts`.

**The MDX dialect is data only.**
- **Claimed tags.** Only PascalCase tags named by an installed block's `mdx.component` are read as blocks. Lowercase tags remain CommonMark HTML. No existing document parses differently, so ADR-039's "no core syntax changed" rule holds.
- **Props** are strings, or `{…}` expressions that are pure data literals: numbers, booleans, `null`, arrays, and object literals with literal keys.
  - `remark-mdx` parses each expression with acorn, and Quill checks that AST.
  - Any identifier, call, template literal or spread makes the whole element opaque.
  - Nothing is ever evaluated.
  - Structured props are written as `prop={{…}}`, because that is what real MDX components expect. A YAML child would be shown as a code block by Docusaurus.
- **Children** are Markdown, written by the serialiser with blank lines around them.
- **Opaque nodes.** Everything else a real MDX file contains (`import` and `export` lines, `{expressions}`, unregistered components) becomes an opaque node:
  - its source is kept byte for byte, as `rawMdast` is today;
  - the editor shows it as a source island;
  - the renderer shows a visible fallback with a warning;
  - it is never executed.
  - In the `directives` dialect the same text stays raw HTML, which is escaped as it is today.
- **New dependency:** `remark-mdx`, for the MDX dialect only. It is the reference parser for the syntax, and its acorn ASTs are what make "data literal only" checkable rather than guessed.

**Versions (ADR-033).** A block's props carry a major version, written as `v=` (or `v={2}`) only from 2 onward.
- The block declares `migrations` keyed by major version.
- The reader dispatches on `v` and migrates on read. Documents are never bulk-rewritten.
- If an installation is rolled back below a document's major, that block becomes a source island with its bytes intact. The install review says how many documents that affects.

### 4. Rendering: one pure template, as hast

- **`render(props, ctx)` returns hast**, written in JSX through `@quill/blocks/jsx-runtime`, a thin layer over `hastscript`.
  - React never runs on the server (ADR-023).
  - Rendering stays a pure function, cacheable under the source hash, the extension signature and the workspace locale (ADR-031).
  - Nothing reads a clock, randomness or I/O.
- **`ctx` offers:**
  - the rendered body;
  - the locale;
  - `link.document(id)` and `person(id)`, which are placeholders filled at page assembly. A person is shown by display name only, never by email. On the public site, people follow the workspace's people-visibility setting. In an export, document links become the relative path of the exported file.
- **Markers** let the platform own the parts that are not plain output:

| Marker | In the reader | In the editor |
| --- | --- | --- |
| `<Content/>` | The rendered Markdown body | ProseMirror's live `contentDOM`: the body is edited in place |
| `<Items/>` | The rendered child blocks | The child blocks, each with its own view |
| `<Prop name>` | The value, as text | An inline field bound to the prop |
| `<Live/>` | The slot that page assembly fills from the snapshot; the rest of the block stays in the cached body | The last snapshot, labelled "as of …" |

- **Times** render as `<time datetime>` in UTC. The island localises them to the reader's zone, so the body does not vary by reader.
- **The default sanitise grant** means most blocks never write one:
  - the base allowlist;
  - classes under `qb-<name>-*`;
  - `data-qb-*` attributes;
  - inline SVG through the drawing allowlist (ADR-036).
- **Extra grants** may name elements only from a reviewed safe set (for example `meter`, `progress`, `dl`), and are shown at install. `script`, `style`, `iframe` and event handlers can never be granted; iframes come only through the embed allowlist (ADR-042). The sanitiser runs last, on the server and before every preview in the editor.
- **Styles** are one CSS file per block, under `@scope (.qb-<name>)`, using theme tokens only, and linked only on pages that use the block.
- **One render for every surface:** the reader, share links, presentation, the public site, export and the editor's preview. The static render must be complete on its own, because it is what crawlers, print, readers without JavaScript and failed islands get.
- **Presentation.** A block's root is never split across slides by `splitSteps`.

### 5. Editing without ProseMirror

There are three levels, chosen by the block.

**Generated (the default, no code).** A generic `BlockNodeView` runs the block's `render` in the browser and converts the hast to DOM after the client-side sanitiser. This is a React node view, as `blocks/leaf-directive-view.tsx` is today.
- **In-place editing:** `<Content/>` and `<Items/>` stay editable, and `<Prop>` fields can be edited where they sit.
- **Chrome:** the block shows its icon, its title, an **Edit** button and a badge when it has issues.
- **The props editor:** Edit opens a form generated entirely from the schema, with a live preview. A small schema opens in a `Popover`, as ADR-058's **Settings** do for `::toc` and `::children`; a larger one opens in a `Dialog`. Apply is one undo step and Cancel reverts. This generalises ADR-058's two hand-written node views, which become the first built-ins to move onto it.
- **How the schema becomes the form:**

| Schema | Field |
| --- | --- |
| `title`, `description`, `default`, `examples` | Label, help text, initial value, placeholder |
| `required`, `pattern`, `minimum`, `maximum`, `format` | Live validation with `aria-invalid` and the message |
| `enum` | Select, or radio with `x-quill-widget` |
| `boolean` | Switch |
| `number` | Number field, or slider |
| `string` | Input, or textarea |
| `format: date` / `date-time` | Date field |
| `x-quill-ref` | Document, person or attachment picker; theme colour token picker |
| `array` | Repeater with reorder |
| `object` | Fieldset with a heading |
| `oneOf` with a discriminator | Variant switch that shows each variant's fields |
| `readOnly`, `deprecated` | Disabled field, with the reason |
| `x-quill-group`, `x-quill-order` | Sections and field order |

A block never needs editor code to be fully editable. The same dialog serves the built-in directives, which gives Quill the generic attribute editor it lacks today.

**Customised.** A block may export `editor`, a React component that receives:
- `props`, `issues`, `selected`, `readOnly`;
- `update`;
- `Content`, `Items` and `Preview`.

It is built from `@quill/blocks/editor`: `PropField` (the generated field for one prop), `InlineText`, `Repeater`, `BlockToolbar`, `Popover`, `Preview`. These are `@quill/ui` primitives bound to the schema. `update(patch)` is one transaction, and typing is coalesced into one undo step. The block never touches ProseMirror.

**Source island (ADR-039).** If props cannot be read or migrated, or `render` throws, the block shows its source and its issues. The source is edited as text and written back byte for byte.

**Inserting and using blocks.**
- **Insertion** is through the slash menu, the toolbar's insert menu and Markdown shortcuts, all built from manifests, so the menu loads no block code.
- **Presets** (named sets of props) appear as their own entries ("Release: hotfix").
- **Required props** with no default open the dialog before the block is inserted; Cancel inserts nothing.
- **Paste** accepts either spelling in either dialect.
- **Keyboard:** Enter on a selected block opens Edit and Escape closes it. Arrow keys move into and out of the block, and focus is always visible.
- **Uninstalled or disabled blocks** show the plain directive chrome with their attributes, and their bytes are untouched.
- **Scope:** a block can be inserted only in workspaces where it is enabled. Existing instances elsewhere stay editable as source.

### 6. Islands

An island is `mount(root, props, runtime) => unmount`. It is framework-agnostic, and `reactIsland(Component)` adapts a React component.
- **It enhances the static DOM** rather than replacing it. The static render reserves the block's size, so nothing shifts.
- **`load`** is `visible` (the default), `idle` or `interaction`.
- **`runtime`** offers:
  - `live.subscribe` (per slot key);
  - `viewer` (the reader, for viewer-scoped blocks);
  - `theme`, `locale`;
  - an abort `signal`.
- **Updates** are announced through `aria-live="polite"` and never move focus.
- **Errors** leave the static render in place and are reported.
- **Where islands run:** the reader, share links and presentation (in the audience window only, ADR-050). The editor shows the static preview with the last snapshot.

### 7. Live blocks are ADR-032

A block's `live` binding is exactly a live block type:
- `params` (a subset of its props) form the slot key;
- the block sets the minimum cadence;
- the fetcher runs on the server through the SSRF-safe client, with an integration's credentials and never the reader's;
- the snapshot is validated against its declared schema;
- `renderSnapshot` returns hast under the same grant;
- a failing source shows its last good snapshot with its age.

In the app, updates arrive over server-sent events. On the public site (section 10), islands poll a shared snapshot endpoint that a CDN can cache, never one stream per anonymous visitor.

### 8. Installing, enabling, trusting

Quill is open source, and the operator and the organisation are usually the same people. ADR-039's "tenants never upload code" and "packaged means deploy time" are replaced as follows:
- **Install.** Installing a block is an **instance administrator** capability. It is equivalent to deploying code, and the install screen and the audit log both say so.
- **Enable.** Organisation and workspace administrators enable installed blocks for their scope.
- **Use.** Writers use the blocks that are enabled.

**The artefact.** `quill-block build` produces a `.qblock` archive:
- `block.json`, the manifest;
- `render.js` and `live.js`, server entries, pure modules;
- `editor.js` and `island.js`, browser ESM with React and `@quill/blocks` external through an import map, so no block bundles its own React;
- `styles.css`;
- the licence and an SBOM.

**Installation** is by upload in Settings → Extensions, by `quill blocks install`, or from a configuration directory for infrastructure as code. Each install:
1. validates the manifest and checks `engines.quill`;
2. runs the conformance kit headless (section 9) and refuses the block if it fails;
3. shows the capability review (grants, network origins, integrations, live binding, public islands, budget overrides);
4. on approval, stores the archive content-addressed in the blob store (D16) and writes an audit entry.

**Versions.**
- Every installed version is kept, and rollback is one action.
- A minor or patch upgrade re-renders the bodies that use the block, through the cache key.
- A major upgrade must ship migrations.
- **Disable** is a kill switch: documents fall back to their readable form with their bytes untouched, and enabling again restores them with no rewrite.

**On the server.** Block `render` and `live` code runs in a `worker_threads` pool, inside a realm with no `Date.now`, `Math.random`, `fetch`, `process` or `require`, and with time and memory limits for each render.
- **Batching:** a document's blocks are rendered in one message per document, never one per block.
- **Async boundary:** `DocumentFormat.render` becomes asynchronous, and the cold-open budget is measured before and after.
- **Not a sandbox.** This isolation buys determinism and fault containment. It is not a security boundary; the trust boundary is the administrator who installed the block.

**In the browser.**
- Block chunks are served from the same origin, under `/_blocks/<id>/<version>/<hash>/`, immutable and integrity-checked.
- They are loaded by the nonce'd loader and `modulepreload`ed on pages that use them.
- `connect-src` widens only by origins an administrator approved at install.

**The security checklist** (`docs/security/checklist.md`) gains:
- the install review;
- block network origins;
- the iframe and `postMessage` items that ADR-043 promised.

### 9. Conformance and budgets

`describeBlock(block, corpus)` extends ADR-039's `describeExtension`. It runs:
- the round trip in **both** dialects, byte for byte;
- degradation with the block uninstalled;
- determinism (render twice, compare);
- the sanitiser's attack corpus against the grant;
- every migration;
- axe on the render, the generated form and the custom editor;
- the budgets.

The default budgets can be overridden by an administrator, and the override is shown in the review:

| Budget | Default |
| --- | --- |
| Render, per instance on the reference corpus | 5 ms |
| Island, gzipped | 30 KB |
| Editor, gzipped | 60 KB |
| CSS | 10 KB |
| Manifest | 8 KB |

None of this counts against the reading route's 250 KB, because it loads only on pages that use the block. Editor keystrokes stay under 16 ms, because a block's view updates only when its own node changes.

### 10. Public site islands (amends ADR-023)

The public site still ships no JavaScript by default. Islands appear there only when both of these hold:
- the workspace has opted in to public islands;
- the block is marked safe for the public site.

A page that has such a block gets a nonce'd loader of about 2 KB plus the chunks of the blocks on that page, nothing more. The static render is always first.

### 11. Export and import

An export chooses one of five modes. The mode can be overridden for each block type and saved as an export preset:

| Mode | Each block becomes |
| --- | --- |
| **Quill Markdown** | Itself, in the workspace's dialect. Lossless |
| **Rendered** | Its static render, with the live snapshot and its "as of" time. The default for HTML and PDF; inside `.md` it is raw HTML, which GitHub shows |
| **Portable Markdown** | The block's own `toMarkdown(props, content)`, or its static render converted with `rehype-remark` |
| **MDX** | `<Component …>` with its `import` line from the block's `mdx` mapping, for Docusaurus and Mintlify |
| **Strip** | Its content without the block, or nothing |

Viewer-scoped blocks always export as a short note. Importing is now parsing followed by serialising in the target dialect. The existing MDX importers (`import/code-groups.ts`, `import/details.ts`) become `mdx` mappings of the blocks they produce.

### 12. Search

Props marked `x-quill-searchable` are included in the search projection, so a page is found by the service and version written in its blocks.

## Alternatives considered

- **Full MDX: evaluating imports, expressions and components.** Every document would become a program, rendering would stop being a pure function, and there would be no editor parity. Rejected again, for the reasons in ADR-002 and ADR-032.
- **Directives only, with MDX at the edges (import, paste, export).** Simpler, but Quill could not edit an existing Docusaurus or Astro repository in place, which is where many developer docs live.
- **The MDX subset as the only spelling.** The best fit for developer ecosystems, but it rewrites every existing directive and makes plain-Markdown workspaces carry JSX.
- **Choosing a spelling by how it degrades.** Rejected as a criterion. Readers never see the raw file, and source legibility is comparable in both spellings.
- **Structured props as a YAML child in MDX too.** One rule for both dialects, but real MDX components expect `prop={{…}}`, and Docusaurus would show the YAML as a code block.
- **Rendering blocks with React on the server.** Breaks ADR-023, and is heavier than producing hast.
- **Running every block in a sandboxed cross-origin iframe.** Inline editing, theming, accessibility and performance all get worse, and the installer is trusted anyway. Kept for third-party embeds (ADR-042).
- **Web Components as the render format.** Nothing would show without JavaScript, which breaks export, print and the public site.
- **ProseMirror plugins as the extension model.** This is what developers are meant to be spared.

## Consequences

- **One module, every stage.** A block covers parsing, serialising in both dialects, rendering, sanitising, editing, interactivity, live data, export and search.
- **Editing comes free.** Every block, and every built-in directive, can be edited through a generated, accessible form, with no editor code.
- **Existing MDX repositories** can be edited in place without a lossy conversion, and a diff touches only the prop that changed.
- **Installing a block runs an administrator's code** on the server and in readers' browsers. This is stated in the product, the audit log and the guide.
- **Two dialects mean two round-trip corpora**, kept green permanently (ADR-033), and content-store paths that know two suffixes.
- **New infrastructure:** the worker pool, the import map, the `/_blocks/` route, the install flow and the asynchronous render boundary.
- **New `@quill/ui` primitives:** checkbox and switch, and a radio group. `Textarea`, `Popover` and `AnchoredPopover` already exist.
- **Collaboration later.** If real-time collaboration arrives (ADR-021 uses locks today), props are node attributes and sync with no change to blocks.
- **Marketplace later.** The manifest is the future marketplace's listing format; hosting, signing and publisher verification are decided later.
- **Templates later.** A template (ADR-054) could ask questions whose answers fill a block's props. The schema makes this possible, but it is not decided here.

**Revisit** if data-literal props prove too narrow for the MDX repositories people bring, or if anyone asks for blocks installed by someone who is not trusted with the server.

## Amendments on acceptance

- **ADR-002:** the canonical model is the AST (D9). Storage has two deterministic dialects, `directives` (the default) and a data-only MDX subset. "MDX rejected" is narrowed to "MDX semantics rejected".
- **ADR-023:** islands may run on the public site when a workspace opts in and the block is marked safe for it (section 10).
- **ADR-032:** reaffirmed. Live blocks never execute document code; a block's `live` binding is a live block type.
- **ADR-039:**
  - instance administrators install code at run time;
  - generated and kit-built editors replace "custom node view, operator only";
  - "no author code" and "no core syntax changed" stand.

## Delivery

Each step ships on its own.

1. This ADR, and the guide `docs/extending/component-blocks.md` next to the existing extension guide.
2. ADR-039 delivery step 2: directive syntax, `parse`, `serialize` and hast `render` in `extensions/contract.ts` and `extensions/registry.ts`.
3. `@quill/blocks` core:
   - the `block/v1` meta-schema, the `x-quill-*` vocabulary and Ajv validation;
   - `defineBlock` and `p.*`;
   - JSON-only blocks;
   - the JSX runtime;
   - serialisation;
   - `blockToExtension`;
   - `describeBlock`.

   The worked scenario below is the first corpus.
4. Editor:
   - `BlockNodeView` with its markers;
   - the generated props dialog, used for the built-in directives too;
   - the missing `@quill/ui` primitives (checkbox, switch, radio group);
   - slash entries and presets.
5. The editor kit for custom editors.
6. Islands in the app, share links and presentation.
7. Packaging and run-time install:
   - `.qblock` archives;
   - Settings → Extensions;
   - the worker pool and the asynchronous render boundary;
   - `/_blocks/`, the import map and CSP;
   - audit and the checklist items.
8. The MDX dialect:
   - `remark-mdx` parsing into block and opaque nodes;
   - the dialect-aware serialiser;
   - the MDX corpus, starting from the Docusaurus, Starlight and Mintlify fixtures already in `packages/markdown`;
   - the workspace and Git-sync setting;
   - `.mdx` in the content store;
   - the previewed dialect switch.
9. Export modes, with the export work in M4.
10. Live bindings, with live blocks in M5.
11. Public-site islands.

## Appendix: worked scenario

This scenario exercises every part of the decision. It is the guide's reference block and the first conformance corpus.

Acme's platform team writes a page per release. The page for `payments-api 2.4.0` says:
- who owns the release and which runbook applies;
- the risk;
- the release notes;
- the rollout steps by region, each with its window;
- live progress per region from the deploy system.

The engineering handbook is an existing Docusaurus repository, synced to a workspace in the `mdx` dialect. The product wiki is a workspace in the `directives` dialect. Release pages are also published as a public status page.

### The blocks

**`acme.release`** is a container whose body is followed by items of `acme.rollout-step`. It has a live binding, an island, a custom editor and presets. Its props:

| Prop | Schema |
| --- | --- |
| `service` | string, required, no default, `x-quill-inline`, `x-quill-searchable` |
| `version` | string, semver `pattern`, `x-quill-searchable` |
| `channel` | enum: `alpha`, `beta`, `stable` |
| `owner` | `x-quill-ref: person` |
| `runbook` | `x-quill-ref: document` |
| `risk` | `oneOf` on `level`: `{ level: low }` or `{ level: high, mitigation, approver: person }` |
| `links` | array of `{ label, url }` |

- **Live binding:** `params: [service, version]`, from the `deploys` integration, refreshed `on-view` with a 30-second minimum and pushed by the deploy webhook.
- **Island:** localises each window to the reader's time zone and updates progress through `aria-live`.
- **Viewer-scoped part:** highlights "You own this release" for the owner.
- **Extra grant:** progress is a `<meter>`, which is outside the base allowlist, so it is granted and shown at install. No `style` is needed.
- **Version history:** in 1.x, `risk` was a string. Version 2 makes it the `oneOf`, with a migration.

**`acme.rollout-step`** has the props `region` (enum), `window` (`{ start, end }` date-times, so structured) and `percent` (0 to 100), and a Markdown body.

**`acme.version`** is a JSON-only inline block using the badge rendering, created in settings: `:version[2.4.0]{service=payments-api}`.

### The same document in both dialects

~~~~markdown
::::release{service=payments-api version=2.4.0 channel=stable owner=u_7f3 runbook=d_91c v=2}
```yaml props
risk: { level: high, mitigation: "Feature flag payments.v24", approver: u_2aa }
links: [{ label: Changelog, url: "https://example.com/changelog" }]
```

Adds idempotency keys to refunds. See :version[2.3.0]{service=payments-api} for the old flow.

:::rollout-step{region=eu percent=100}
```yaml props
window: { start: 2026-11-02T09:00Z, end: 2026-11-02T11:00Z }
```

Canary first.
:::
::::
~~~~

~~~~mdx
import Admonition from '@theme/Admonition'

<Release service="payments-api" version="2.4.0" channel="stable" owner="u_7f3" runbook="d_91c" v={2}
  risk={{ level: "high", mitigation: "Feature flag payments.v24", approver: "u_2aa" }}
  links={[{ label: "Changelog", url: "https://example.com/changelog" }]}>

Adds idempotency keys to refunds. See <Version service="payments-api">2.3.0</Version> for the old flow.

<RolloutStep region="eu" percent={100} window={{ start: "2026-11-02T09:00Z", end: "2026-11-02T11:00Z" }}>

Canary first.

</RolloutStep>
</Release>

<Admonition type="tip">{props.hint}</Admonition>
~~~~

In the MDX file, the `import` line and the `Admonition`, whose child is an expression, are opaque. They are kept byte for byte, shown as source islands and never run.

### Journeys

| # | Journey | What it proves | Passes when |
| --- | --- | --- | --- |
| 1 | An administrator uploads `acme-release-2.0.0.qblock`, reads the review ("reads the `deploys` integration; extra element `meter`; public islands; Quill 1.4 or later") and approves | Manifest, kit, review, audit | A failing kit refuses the install; the listing renders from the manifest with no code loaded; the audit entry exists |
| 2 | A workspace administrator enables it for Platform only | Scoped enabling | It is absent from other workspaces' slash menus; documents there show source |
| 3 | A writer types `/release` and chooses the "Hotfix" preset | Slash, presets, required props | The dialog opens first, because `service` has no default; Cancel inserts nothing; Apply is one undo step |
| 4 | The writer edits `service` in place and the notes in the body | `<Prop>`, `<Content/>` | One undo step per run of typing; keystrokes under 16 ms with 20 releases on the page |
| 5 | The writer sets risk to high and leaves mitigation empty | `oneOf`, validation | The variant's fields appear; `aria-invalid` and the message; an issues badge; a warning on publish |
| 6 | The writer reorders steps and adds `apac` in the custom editor | Editor kit, `<Items/>` | One transaction; axe passes |
| 7 | The writer opens a 2025 page with `risk=high` (v1) | Migration on read | It reads as v2 and gains `v=2` only when saved; rolling back to 1.x turns it into a source island with its bytes intact |
| 8 | The page is published and read | Static render, `<Live/>` | The body is cached once; the slot is filled with "as of"; no layout shift |
| 9 | The deploy webhook moves `eu` to 100% | Push, island | The reader sees it without reloading; focus stays put; both workspaces' pages share the snapshot |
| 10 | The owner opens the page | Viewer-scoped | Only the owner sees the highlight; it is in neither the body nor the snapshot |
| 11 | An anonymous visitor opens the public status page | Public islands | The loader plus one island chunk; updates from the cacheable snapshot endpoint; the owner shown by the visibility setting |
| 12 | Someone presents the page | Presentation | The block is not split across slides; the island runs in the audience window only |
| 13 | Someone edits the page in the Docusaurus workspace | MDX dialect | The opaque `import` and `Admonition` are byte-identical after save; `<Release>` is fully editable; the diff touches only the changed prop |
| 14 | Someone pastes `<Release …>` into the wiki | Cross-dialect paste | It arrives as `::::release` with `yaml props`; the opaque line arrives as text with a warning |
| 15 | The page moves from the handbook to the wiki | Dialect on move | One commit re-serialises it and renames `.mdx` to `.md` |
| 16 | Someone searches "payments-api 2.4.0" | Search | The page is found through its searchable props |
| 17 | Someone exports the page in every mode | Export | Lossless; rendered with snapshot and "as of"; portable through `toMarkdown`; MDX with its `import`; stripped to its notes. The runbook link becomes a relative path, and the owner highlight becomes a note |
| 18 | An administrator disables the block | Kill switch | Readers see the readable fallback; no bytes change in either dialect; enabling again restores everything |
| 19 | `:version[2.4.0]{…}` is used in prose | JSON-only block | It was made in settings with no build, and the generated form edits it |
| 20 | The developer runs `quill-block dev` | Developer experience | Every surface in both dialects at 320 and 1920 pixels, light and dark; the budget badge fails when the island passes 30 KB |
