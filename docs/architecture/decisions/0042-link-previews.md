# ADR-042: Link previews

**Status:** Accepted
**Date:** 2026-10-11 (display and authoring amended 2026-10-13)
**Delivery:** M5, with embeds (quill-plan.md section 20)
**Related:** ADR-008 (providers and integrations), ADR-011 (security baseline, amended by this ADR), ADR-031 (render caching), ADR-032 (live blocks), ADR-039 (Markdown extensions), [docs/ideas/work-tracker-and-code-host-connectors.md](../../ideas/work-tracker-and-code-host-connectors.md)

## Context

A pasted URL is the commonest reference in documentation, and today Quill renders it as a bare link. Every tool people compare us with turns it into a preview: Slack, Notion, Confluence, Linear, GitHub. Plan section 20 already says "Open Graph and oEmbed first. Unknown providers become link cards." Quill produces Open Graph for its own public pages but consumes none.

Fetching someone else's page from our server is the hard part:
- it is an SSRF vector;
- it is a privacy event, because the target learns the link was shared;
- it is a cache problem, because pages change and die;
- third-party images and HTML must never reach a page as they are.

The existing outbound client (`apps/server/src/infrastructure/http/outbound-client.ts`) solves SSRF for a known set of hosts, using an exact allowlist. Previews must reach arbitrary public hosts.

## Decision

### One provider, layered resolution

A `LinkPreviewProvider` (ADR-008: a capability-specific provider; the configured instance is an integration) resolves a URL to a `LinkPreview`. A preview holds:
- the title;
- the description;
- the site name;
- the kind (article, video, repository, issue, …);
- a stored thumbnail reference;
- a favicon reference;
- the canonical URL;
- the layer that answered it;
- `fetchedAt`.

It tries each layer in turn and keeps the first rich answer:

1. **A connector's API**, for a host with one configured: GitHub, Jira and the like (see the connectors idea). This is the only layer that can see private content, and what it may show of it is limited (see "Connectors and private content").
2. **oEmbed.** A known provider from a vendored, pinned copy of the oembed.com registry, otherwise discovery via `<link rel="alternate" type="application/json+oembed">`. JSON only. XML oEmbed is refused.
3. **Open Graph**, then **Twitter Card** tags.
4. **The page itself:** `<title>`, `meta name="description"`, `link rel="icon"`, and JSON-LD `headline` and `description`.

oEmbed discovery (the page's own `<link>`) costs a second request to the host, so it runs only when Open Graph, Twitter Card and the page's own tags did not give a rich answer. A *known* provider is asked first, before the page is fetched at all: one request, and the only way to get anything from a host that serves bots nothing. A card is **rich** when it has a title and either a description or an image.

Every field is treated as untrusted plain text: trimmed, length-capped, and stripped of control characters. Remote HTML is never rendered. oEmbed `html` is ignored unless the provider is on the **embed allowlist** (below).

### Fetching the open web safely

The outbound client gains an **open-web mode**, as a separate instance with its own stricter configuration, never by loosening the allowlisted one. ADR-011 is amended to admit it. In this mode:
- there is no host allowlist;
- every address check of the existing client still runs, and runs on every hop: private, loopback, link-local, unique-local, CGNAT, multicast, the metadata ranges, and IPv4 embedded in IPv6;
- the connection is pinned to the address that was checked;
- at most 5 redirects;
- the request has a 6-second total budget;
- only `http(s)` on ports 80 and 443;
- only `text/html` or `application/json`, decided from the response headers before the body is read; a short allowlist of file types (see "File links") is answered from the headers alone, with the body cancelled unread;
- the body is read as a stream, and reading stops at `</head>` or 512 KiB, whichever comes first;
- the character set is taken from the header, else the meta tag, else UTF-8;
- names are resolved with c-ares, not `getaddrinfo`, so a hostile nameserver cannot hold the threadpool that serves every file read in the process;
- at most 8 requests run at once and 64 wait, and more are refused as busy;
- only the markup before `<body>`, and at most 2 000 tags of it, is parsed, because the HTML parser's cost is quadratic in nesting;
- a URL longer than 4 096 characters is not looked up at all.

The user agent is honest: `<Brand>Bot/<version> (+<instance URL>/bot)`. The `/bot` page explains what is fetched and how to opt out. A small, documented list of hosts known to serve Open Graph only to well-known crawlers may get a fallback user agent. Every such entry is reviewed.

Rate limits apply per target host, globally (a token bucket), and per organisation. Fetches are de-duplicated: concurrent requests for the same key share one in-flight fetch.

`robots.txt` is not consulted, as with Slack and other unfurlers, because a preview is a single fetch on a person's behalf, not a crawl. The `/bot` page says so, and an organisation can block hosts.

### Images are ours or nothing

A thumbnail or favicon is never hotlinked: that would leak readers' addresses and break the image CSP.
- The image is fetched once through the same open-web client, with images only and a 5 MiB cap.
- Its bytes are sniffed to confirm it is PNG, JPEG, WebP or GIF; SVG is refused.
- It is decoded, re-encoded and resized to fixed sizes, which also strips metadata. Only the first frame of an animation is read.
  - The decode happens in a **small pool of reusable child processes** (two by default, replaced after 100 images, stopped when idle, and killed on any failure rather than reused), because starting a process that loads the codec cost half a second and 70 MiB per image. Each has a heap cap, a pixel limit (24 megapixels, checked from the header) and a time limit, as ADR-047 requires for every untrusted codec. A crash or hang costs one job. The child is given **no environment variables**, so the database URL, keys and credentials are not in its memory, and its reply is treated as untrusted too: it must still be a WebP, within the size asked for, or it is refused.
  - The sizes are 640 pixels for a thumbnail and 64 for a favicon, never enlarged. The output is WebP.
- It is stored in the blob store under its hash and served same-origin and immutable.

A preview whose image fails keeps its text.

### File links

A URL that is a file rather than a page (an image, a PDF, a video or an audio file, a common document, a spreadsheet, a presentation, a text or CSV file, an archive) is recognised by the media type in the response headers, **before any body is read**, in the same single request that would have fetched a page. The client answers it from the headers alone (the type, the length the host declared, and the file name from `Content-Disposition` or the last segment of the address, cleaned like any stranger's text and cut to one file name) and cancels the transfer; nothing of a PDF or a video is ever downloaded. Only a fixed allowlist of types is offered as a file; an executable or `application/octet-stream` is still refused as not a page.

- The preview is the file's name, its type and its size (`file: { mediaType, bytes, name }`, layer `page`). It is drawn as a card with an icon for the type, the name, and "PDF document · 471 KB" beneath it; an inline form is the icon and the name.
- **A picture** (PNG, JPEG, GIF or WebP) is fetched a second time through the image pipeline above, with all its caps, to store a thumbnail by hash, unless the host declared it over the cap. It then draws as the card with its picture. An SVG is inert: it is a file card with no thumbnail, and is never drawn.
- `text` mode stores no thumbnail, and the policy is asked on every hop of both requests.

### Cached as snapshots, never fetched while rendering

- **The key** is the normalised URL:
  - lower-case scheme and host;
  - default port removed;
  - fragment removed;
  - tracking parameters removed (`utm_*`, `gclid`, `fbclid`, `mc_*`, from a maintained list);
  - remaining parameters sorted.
- **Previews are snapshots in ADR-032's snapshot store.**
  - A success lives 3 days. After that it is served stale while a background job refreshes it.
  - A failure is cached for 1 hour, which bounds retries against dead links.
  - "Refresh preview" in the editor forces a fetch, rate-limited per user.
- **Scope.** A preview from the public layers (2 to 4) is shared across the instance. A connector preview is held to a stricter rule, in "Connectors and private content" below: it is only ever made of content that anyone could open, which is what allows it into the same shared scope.
  - **A restrictive policy gets its own scope, named for the policy.** A fetch runs under the policy of the person whose reading asked for it, so an organisation that limits where Quill goes can be sure Quill did not go there on its behalf. A fetch under the default policy is stored in the shared `public` scope. A fetch under any other (an allow or block list, text-only) is stored in a scope derived from a hash of that exact policy: everyone with the same policy shares it, nobody else can read it, and changing the policy moves an organisation to a new scope with no migration. Both are read, the organisation's own first.
- **Scope.** A preview from the public layers (2 to 4) is shared across the instance. A preview from a connector (layer 1) is keyed by integration and visible only where that integration is granted.
  - **A restrictive policy gets its own scope, named for the policy.** A fetch runs under the policy of the person whose reading asked for it, so an organisation that limits where Quill goes can be sure Quill did not go there on its behalf. A fetch under the default policy is stored in the shared `public` scope. A fetch under any other (an allow or block list, text-only) is stored in a scope derived from a hash of that exact policy: everyone with the same policy shares it, nobody else can read it, and changing the policy moves an organisation to a new scope with no migration. **Only the audience's own scope is read.** A restrictive audience is never shown what a looser policy fetched, even from the shared scope: the looser fetch may have followed a redirect to a host this policy blocks, or kept a picture its mode forbids. The cost is one fetch per distinct policy, which only organisations that restrict links pay. A fetch is stored under the scope of the policy in force when it *ran*, not when it was queued, so a policy changed while a fetch waited cannot put a looser result in a stricter scope, or the reverse.
- **One row per link and scope**, holding the preview as a versioned document (ADR-033), when it was fetched, when a fetch was last asked for, and when it may next be tried. A row is derived data: rows nobody has read for 90 days are swept, and one fetch rebuilds any of them.
- **A miss queues, atomically.** Asking for a fetch is a conditional upsert, so any number of readers who miss the same link at once queue exactly one fetch, and a fetch that was lost (a restart) may be asked for again after five minutes. The fetch is an outbox event (`LinkPreviewRequested`), so it has retries with backoff and a dead letter. The processed row keeps the site's address and drops the path and query, since a link can carry a token.
- **A failed refresh keeps the last good preview.** Its clock moves so a dead link is not asked for on every read, and the card is shown with its age.
- **Rate limits** apply to each fetch: per host, per scope, and globally, as token buckets. A fetch that finds no room is put back for exactly as long as the bucket says (plus jitter) and the attempt is **not counted**, so a burst of links to one site is spread out and never dead-lettered. A forced refresh is limited per person, as is looking up a page of links, and as is **causing new fetches**: asking is free, so a person can read any page, but the number of requests to strangers' servers one person can cause is rationed. The links left out simply read as pending and are queued by a later read.
- **Fetches run on a lane of their own**, not on the outbox's main poller. The main poller handles one event at a time inside the transaction that claimed it, which is right for quick work of ours and wrong for a fetch that waits seconds on someone else's server: a few slow sites would delay publishing and mail. The lane claims events with a lease (short transaction, no connection held while the fetch runs), runs up to eight at once, and treats "not yet" as a deferral rather than a failure.
- **Anonymous readers never cause a fetch.** The public site and an export read stored previews through a read that cannot queue (`peekLinkPreviews`). Only a signed-in member's page loads and pastes can ask for one, so a stranger cannot make Quill fetch an address by requesting a page.
- **Every fetch is logged**: one line with the host, what it was for (page, oEmbed, image), the outcome, status, redirects, bytes and duration. Never the path, the query or the response.
- **The pictures are served by us** from `/link-previews/images/<hash>`, immutable and inert (`nosniff`, a policy that allows nothing, a fixed WebP type). **Only a hash a stored preview shows is served**: the blob store holds attachments by hash too, and a hash is not a permission, so every other hash answers the same not-found as one that does not exist.
- **`/bot`** is a public page the user agent names, generated from the limits the client enforces, saying what is fetched, how much, how often, and how to stop it.
- **The API** has two endpoints, both only reading what is stored and queueing: `POST /api/link-previews/resolve` takes up to 50 links and answers, for each, one of `ready` (with `stale`), `pending`, `unavailable` (with the reason) or `blocked`; `POST /api/link-previews/refresh` forces one.
- **Rendering never fetches** (ADR-031). The body renders a link with a preview slot carrying the normalised key. Page assembly fills slots from the snapshot store, exactly as it fills live blocks. A missing snapshot shows the plain link and queues a fetch. The public site shows a preview only from the public layers, and only if the organisation allows previews there.
- **In the editor**, pasting a URL inserts the link at once, and a placeholder chip resolves when the preview arrives. A slow or failed preview never blocks typing.

### Display: the author decides

A preview is a presentation of a link, never content, so how a link looks is the author's choice. The choice is stored in the document and read the same way by every reader.

**What other tools offer.** Notion offers URL, mention, bookmark and embed from a menu on every paste. Confluence offers inline, card, embed and URL, switched from a floating toolbar. Google Docs offers a chip, a hover card, and "convert to plain link". Slack unfurls below the message, and only removal is the author's. Linear and GitHub turn their own links into status-aware titles. What people value is the same everywhere: the choice is per link, switching is one click and reversible, the link never gets in the way while typing, and the plain link is always one step away. What people complain about: a modal menu on every paste, a card the author did not ask for, an author's own words replaced by a scraped title, and previews that shift the page as they arrive.

**Five displays.**

| Display  | Reads as                                | Use                                                                   |
| -------- | --------------------------------------- | --------------------------------------------------------------------- |
| `url`    | The link as written, with no preview    | Prose that names a destination; always the fallback                   |
| `inline` | Favicon and title, in running text      | Linking to a page mid-sentence                                        |
| `compact` | Favicon, title and site on one line, block | A list of references, where a card for each would drown the page   |
| `card`   | Title, description and thumbnail, block | A reference worth a look: an article, a design, a pull request        |
| `embed`  | The live content in a sandboxed frame   | Video, slides, a design file, from an allowlisted provider only       |

**What the author can shape on a card:**
- `layout`: `side` (thumbnail beside the text; the default and the most compact) or `top` (a large image above it);
- `image=none` to drop the thumbnail;
- `title` and `description` to replace the fetched text with their own; `description=""` hides it. This also repairs a page whose tags are wrong or missing, and gives a stable result where the host blocks us.

**The author's words always win.** If the author wrote link text (`[the design doc](https://…)`), `inline` keeps it and only adds the favicon and the hover peek. The fetched title replaces the text only for a bare URL.

**In the Markdown file** a choice is a directive, so it round-trips and degrades: `::link{url="https://…" display=card layout=top}` as a block, `:link[https://…]{display=inline}` in running text. A directive with an unknown attribute keeps it (rule 7), and one with an unknown `display` renders as `url`. Outside Quill every form reads as its URL. A link with no directive takes the organisation's default.

**Defaults.** The organisation chooses the default for a pasted or bare link: `url`, `inline` (the shipped default), `compact` or `card`. `embed` is never a blanket default: it is a choice about one link and an allowlisted provider. `inline` is the least surprising: it reads as a link, and a card is something the author asks for. A bare URL on a line of its own does not change this.

**Authoring surface.**
- **Paste inserts the link at once.** A small, non-blocking prompt then appears at the link: `Show as  Link · Inline · Compact · Card · Embed`. An option appears only if it can work (`Embed` only for an allowlisted provider). The organisation's default display is marked in the prompt (underlined and described, so it is not carried by colour alone) as the choice to point at; the pasted link stays a plain link until the author picks. The prompt takes no focus, and goes away when the author types, presses Escape or clicks elsewhere. It never blocks typing, and `Ctrl+Z` straight after a paste returns the plain link.
- **The floating toolbar on any link** has the same segmented control, plus edit text, open, copy, refresh preview and remove link. For a card it adds a **Preview details** popover: layout, image, and title and description overrides, with the fetched values as placeholders and a "reset to fetched" action.
- **Every feature has slash, toolbar, keyboard and undo.** The slash menu has `/link card`, `/link compact`, `/link inline` and `/link embed`; `Ctrl+K` (the link dialog) includes the display choice, as one radio group the keyboard moves through, applied with the address as one undo step; the command palette has "Show link as link / inline / compact / card" for the link at the cursor, listing only the displays it could change to.
- **The preview is honest while it loads and when it fails.** A placeholder chip with the height of the final inline form holds the place, so nothing shifts. A failure leaves the plain link and a quiet "Preview unavailable. Retry" in the toolbar, never an error in the page. A status line in the toolbar says where a preview came from ("Open Graph, fetched 2 days ago") and warns when it will not show on the public site, either because the organisation draws no previews there or because the preview came from a layer only members may see; its "Refresh preview" answers a refused refresh (too often, or blocked by the organisation) as a quiet sentence, never an error.
- **Pasting from outside** (a Slack message, a web page, an email) keeps links as links, which take the default. Only a bare pasted URL is offered the prompt.
- **Internal links.** A link to another Quill document is the first-party case of layer 1. It is written as a `:link` whose address is the document's id, `/d/<id>` (a pasted app address is turned into that, so it survives a rename and a move), and it resolves by id when a page is read: **no fetch, and nothing stored**, so there is no snapshot that could go stale or outlive a change of permissions. It shows the document's live title, its first paragraph (the description the public site derives) and its place (the collection, as the site name). It respects what the reader may see, and the fill is **per reader** even though the body is cached and shared:
  - a signed-in member, or the holder of a share link, is checked with the request's authorizer (ADR-012): a reader who may not view the document, and any document that does not exist, get the same plain, unlinked label (the author's words, else "Document unavailable"), never a title or a link, so the answer cannot be used to find out which ids exist;
  - an anonymous reader of a public site sees a preview only for a document published **on that site**, and the link goes to its public page; every other document reads as the unlinked label;
  - the collection is named only if the reader may see the collection too;
  - the same displays apply, minus `embed`; an unfilled body (an export) keeps the plain `/d/<id>` link.
  In the editor the author sees what the reader will see: a card shows the live title, and a bare inline link shows the title in place of its address until the caret enters it.

**Reading surface, internal and public.**
- **One component per display**, shared by the app reader, the public site, presentation mode and export (rule 16). Inline is an `<a>` holding a decorative favicon and the title. A card is a single `<a>` block: the title is the accessible name, the site name and description follow, and the thumbnail is decorative (`alt=""`) and sized from its stored dimensions so the page does not shift as images load. One tab stop per link, with a visible focus ring.
- **Hover and focus peek.** An `inline` or `url` link to a previewable page shows a compact card on hover or keyboard focus after a short delay. It is dismissible with Escape, stays open while the pointer is over it, and never traps focus (WCAG 1.4.13). It is a reader setting ("Show link previews on hover", on by default), because it is a reading preference where the author's choice of display is content. On touch devices the peek is off and the link behaves as a link.
- **Public site.** A preview is drawn only from a public layer (2 to 4), and only if the organisation allows it. Anything else renders as `url`, and the editor says so at authoring time. Images are same-origin and immutable. External links carry `rel="noopener"`.
- **Print, export and offline.** **An export is the rendered body before its link slots are filled, so every link in it is a plain, working link with the words the author gave it or its address.** The directive renders as an ordinary anchor first (a *slot*, carrying the author's choice and the address its preview is stored under), and the page's server-side step swaps a slot for a chip or card only when a preview is ready. Anything that does not run that step, an export to HTML, PDF or Word, a Git sync, a crawler that reads the cached body, a printout, therefore gets plain links without having to know about previews. The export code must not call the fill step, and a test pins that an unfilled body has no chip, card or image in it.
- **Dead links.** A preview is a snapshot. When a link later dies (ADR-046) the snapshot stays as it was, and the link-health report is where that is surfaced.
- **Presentation mode.** Cards scale with the slide, and `layout=top` suits it.

### Connectors and private content

A connector asks a service's own API about a link, with credentials an administrator stored (ADR-034). It is a port in `packages/application` (`matches(url)`, `resolve(url, credentials, signal)`), with a registry that allows one connector per host family; the resolver asks it before any page layer. Three rules govern it.

- **It never uses the open-web client.** That client holds no credentials and refuses a credential header (ADR-011). A connector reaches its API through the allowlisted client, whose one host is the service's API host, and builds every request path from validated pieces of the link, never from the link.
- **It makes a preview only of what anyone can open.** The token can read private content; a preview is shared by everyone who can see the link. So the first request of every resolution reads the repository, and a repository that is not public yields the failure `restricted`: no preview is made and the page layers are not tried (their answer would be a sign-in page). A preview kept from when the link was public is dropped, not kept as the last good one, and a reader is never told *why* nothing is shown (the stored failure reads as "not a page"), because the service itself answers 404 for private and absent alike. Showing private content to those who may open it needs a per-reader check against the service and a scope per person; that is not built, and a connector must not be given private content to show until it is.
- **A failure falls through, a wait does not.** A connector that cannot answer (not found, an API error, a timeout, a bad token) hands over to the page layers, and a reader never sees its error. A rate limit is not a failure: the fetch is deferred for as long as the API asks (`LinkPreviewRetryLater`, which the outbox lane turns into a `DeferEvent`), never stored, never counted as an attempt.

A connector adds fields only it can know: `status` (the state of a pull request or issue) and, for a permalink to lines of source, `code` (language, first line, the lines as plain text, path, repository). Lines are capped, stripped of control characters and invisible formatting, escaped on output and never highlighted by a script.

### Embeds are an allowlist

A live embed (video, slides, a design file) is an iframe. Only providers on an instance embed allowlist may embed:
- each entry names the provider, its URL patterns, its iframe source pattern, and the `sandbox` and `allow` tokens it needs;
- the page's CSP `frame-src` is generated from that list;
- iframes are `sandbox`ed, `loading="lazy"`, and without `allow-same-origin` unless the entry requires it and was reviewed.

Everything else is at most a card.

As built (`packages/domain/src/link-preview/embed-providers.ts`):
- **The registry is code.** One entry per provider, reviewed like any change; an operator can only switch entries off, by id, with `LINK_EMBEDS_DISABLED` (a typo stops the boot). Entries today: YouTube (always the `youtube-nocookie.com` origin), Vimeo, Loom, Figma, Google Docs, Slides, Sheets and Drive, Miro, Spotify, and LinkedIn posts.
- **Matching has no regular expression over the path.** A page is recognised by exact host, then by path segments and identifiers checked one character at a time, so a hostile address cannot make a match backtrack (a test times a 10 000 character path against every entry).
- **The frame address is built by us**, from the validated parts (a video id, a document key), on one of the provider's own https origins. Nothing from the page, its Open Graph tags or an oEmbed `html` field reaches it.
- **The resolver records the frame** (`preview.embed`) only under a `rich` organisation policy. An organisation in `text` or `off` mode never gets one, and a policy that does not permit the page never gets as far.
- **The renderer re-checks it.** Drawing an `embed` asks the registry to recognise the stored frame (provider still on, https, no credentials, an origin of that provider); anything else is drawn as a card. The `sandbox` and `allow` tokens come from the provider's entry, not from the stored preview. The body still holds only a slot, so an export, which is the unfilled body, never contains a frame.
- **Every frame** is `loading="lazy"`, has a title, `referrerpolicy="strict-origin-when-cross-origin"`, and sits in a figure whose shape is a named token (the CSP forbids an inline `style`). The caption is a plain link to the page and is the fallback.
- **`allow-same-origin`** is granted to every provider today, each with a stated reason (`sameOriginReason`): their players and viewers do not run without their own origin's storage, and the frames are on other origins than ours, so the token gives them nothing of ours. A test requires a reason wherever the token appears and refuses `allow-top-navigation`, any `allow-popups` form, `allow-forms`, `allow-modals` and `allow-downloads`.
- **The CSP `frame-src`** is generated from the providers left on (`registry.frameSources()`), together with the draw.io editor's origin, in the one policy every HTML response carries (the app, the public site, shared pages). With every provider off it is `'none'`.
- **Posts from X stay cards.** Its post embed is a script that injects the frame, and the only address that works without the script is undocumented; a third-party script is not something this allowlist admits. LinkedIn is admitted because it publishes a plain iframe address for a post (`/embed/feed/update/urn:li:…`).
- **Editor.** `Embed` is listed with the other displays (toolbar, paste offer, context menu) and is available only for an address whose preview has a frame; otherwise it is disabled and says why. The writing surface draws an embed as an inert placeholder naming the provider and shape, never a live frame.

### Policy

An organisation decides what Quill may do about links. The settings are:

- **Mode**, one of:
  - `off`: nothing is fetched, and every link is a plain link. Authors can still write directives; they render as `url`.
  - `text`: titles, descriptions and site names only. No picture is fetched, stored or shown, so no third-party image is ever copied or served.
  - `rich`: everything, including thumbnails and favicons (the shipped default).
- **The public site**, on or off, separately: an organisation may use previews internally and publish plain links.
- **The default display** of a pasted or bare link (`url`, `inline` or `card`).
- **An allow list and a block list** of URL patterns (below).
- **Whether the instance-wide anonymous layer may be used**, so an organisation can require connectors.

**Patterns.** A pattern names a host, optionally with a path prefix:

| Written                      | Matches                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `example.com`                | that host                                               |
| `*.example.com`              | any subdomain, not `example.com` itself (list both)     |
| `example.com/docs`           | that host, at `/docs` and under it, never `/docsx`      |
| `*.example.com/internal/*`   | the same on every subdomain; a trailing `*` is optional |

The grammar has no regular expressions: an administrator can read what a pattern does, and it cannot be made to backtrack. A wildcard is allowed only as a leading `*.` on the host and a trailing `*` on the path. A scheme is ignored, a port is not accepted (only 80 and 443 are ever used), and an internationalised name is matched in its punycode form. Hosts compare case-insensitively and without a trailing dot, so `EVIL.example.` is `evil.example`; numeric forms of an address (`2130706433`, `0x7f.1`) are compared as the address they are; paths compare case-sensitively after dot segments are resolved. A list holds at most 500 patterns, and a policy with one pattern that does not parse is refused whole with the pattern named, because a block list that silently skips the entry that was mistyped is worse than none.

**Semantics.** A block wins over an allow. If the allow list is not empty, only matching URLs may be contacted. `off` permits nothing.

**What the policy governs is Quill's requests, not what people may write.** A link to a blocked site is still a working link; Quill just never contacts that site to describe it. So the policy is enforced where a request is made, on **every** request a preview makes: the pasted URL, each redirect it lands on, an oEmbed endpoint (known or discovered), and each image. A block list that is checked only against the pasted URL is one a redirect, or a page that names an image on another host, walks around. The pasted URL is also checked on its own before an oEmbed provider is asked about it, since that request would otherwise send the provider a link the policy forbids.

**At read time too.** A stored preview was made under whatever policy applied then, and is read only by an audience whose policy is exactly that one (above). Showing one applies the viewing organisation's policy again as well: a preview of a URL the policy does not permit is not shown (the link renders as `url`), and in `text` mode a stored thumbnail and favicon are not served. A policy change therefore takes effect at once, without waiting for a refresh.

**Operators have a layer above organisations.** The instance's own configuration can add hosts that no organisation may enable, and the operations guide recommends an egress firewall as a second wall: the server's outbound traffic is allowed to the public internet and to nothing inside the network, so a flaw in the application-level checks is not the only thing between a pasted URL and an internal service.

Internal hostnames, including the instance's own private names and anything resolving inside, are never fetched, whatever the policy says. Private content needs a connector. Every fetch is logged with its host and outcome, never the response. Policy changes are audited.

## Dependencies

Two runtime dependencies are added to the server (AGENTS.md rule 11):
- **`parse5`**, the HTML Standard's reference parser (already in the lockfile through other tooling). Metadata is where hand-written patterns fail on real pages: attribute order and quoting, entities, `<noscript>`, markup in comments. It is used only to read HTML we fetched ourselves, which is the allowance in "Alternatives considered" below.
- **`sharp`** (libvips), the image codec ADR-047 already chooses. It lands here first, behind an `ImageTranscoder` port, so ADR-047 reuses it rather than adding it again.

## Alternatives considered

- **Fetching in the browser.** CORS stops it in most cases, it leaks every reader's address, and every reader sees something different. Rejected.
- **A hosted service (Iframely, Microlink).** Good coverage, but it sends every URL our users paste to a third party, which a self-hosted product cannot do by default. It could later be an optional provider behind the same interface.
- **Hotlinking `og:image`.** It leaks reader addresses, breaks the CSP, and fails on mixed content. Rejected.
- **Fetching at render time with HTTP caching.** It ties rendering to third-party uptime and breaks ADR-031. Rejected, as ADR-032 rejected it for live blocks.
- **A library such as metascraper or open-graph-scraper as the fetcher.** They bring their own HTTP stacks, which would bypass the SSRF client. Their *parsing rules* may be used on HTML we fetched ourselves, if a dependency review approves.

## Consequences

- Links read as previews in the editor, the reader and (optionally) the public site, consistently, without a fetch per reader.
- The open-web client is a new, security-critical surface. It gets ADR-011's adversarial test table (redirect to private ranges, DNS rebinding, slow-drip responses, oversized and compressed bodies, odd charsets, oEmbed `html` injection), and a checklist entry.
- Previews depend on the snapshot store and job runner from ADR-032, so they land with M5's live blocks. Connector-backed previews follow the connectors idea.
- Some hosts will block or degrade bots. A link always remains a working link.

## Delivery

1. The open-web outbound client, with its tests and the ADR-011 amendment. *Built.*
2. The resolver layers 2 to 4 and the image pipeline, against recorded fixtures. *Built.*
3. Snapshots and refresh jobs, and the read API. *Built*, on a table of its own (`link_previews`), since ADR-032's snapshot store does not exist yet; folding it into that store later is a move of rows, not of behaviour. Slot filling at page assembly arrives with the renderers in step 4, which call the same read.
4. The directive and its renderers (inline, card, peek) on the reading and public surfaces, then the editor: paste prompt, floating toolbar, preview details, slash, `Ctrl+K` and command palette. *Started.* Built and tested: the `link` directive (parse, validate, write back, unknown attributes kept), its slot in the body, and the fill. **The reading surfaces are built:** a member's `GET /documents/:id/rendered` fills the body for the viewer (queueing what is missing, answering `pendingLinks`, tagged by what was drawn so a late preview is never a 304 for the plain link), the public site and share links draw stored previews only, and publishing queues the previews of a document's links so the first reader finds them. The web client looks again at 2, 4, 8 and 16 seconds while any are pending, then stops. Chips and cards are styled in the shared prose stylesheet. **The hover and focus peek is built** (a reader preference of the browser, on by default, off on touch). **The editor is built in part.** A link is one thing with a display: a plain Markdown link, an inline `:link` or a `::link` card, and one command moves it between them without losing its address or the author's words (`packages/editor/src/link`). Pasting a bare address inserts the plain link at once and offers `Show as Link · Inline · Card`, which takes no focus and goes away on typing, Escape or moving off; the floating toolbar on any link has the same segmented control, and for a card its layout, image and a Preview details box (title and description over the page's, with the fetched words as placeholders, "No description", and "Reset to fetched"); `/link card` and `/link inline` take an address in the slash menu; the context menu has "Show link as"; a card is drawn in the writing surface from its preview, or from its address while there is none. Not built: `Ctrl+K` with the display choice, the command palette entries, refresh and the status line in the toolbar, the embed display, and the organisation default display and settings screens (step 5).
5. Settings and policy, then the embed allowlist. *The embed allowlist, its CSP, the renderer and the editor's `Embed` choice are built (2026-10-17); the settings screens are not.*
4. The directive and its renderers (inline, card, peek) on the reading and public surfaces, then the editor: paste prompt, floating toolbar, preview details, slash, `Ctrl+K` and command palette. *Started.* Built and tested: the `link` directive (parse, validate, write back, unknown attributes kept), its slot in the body, and the fill. **The reading surfaces are built:** a member's `GET /documents/:id/rendered` fills the body for the viewer (queueing what is missing, answering `pendingLinks`, tagged by what was drawn so a late preview is never a 304 for the plain link), the public site and share links draw stored previews only, and publishing queues the previews of a document's links so the first reader finds them. The web client looks again at 2, 4, 8 and 16 seconds while any are pending, then stops. Chips and cards are styled in the shared prose stylesheet. **The hover and focus peek is built** (a reader preference of the browser, on by default, off on touch). **The editor is built in part.** A link is one thing with a display: a plain Markdown link, an inline `:link` or a `::link` card, and one command moves it between them without losing its address or the author's words (`packages/editor/src/link`). Pasting a bare address inserts the plain link at once and offers `Show as Link · Inline · Card`, which takes no focus and goes away on typing, Escape or moving off; the floating toolbar on any link has the same segmented control, and for a card its layout, image and a Preview details box (title and description over the page's, with the fetched words as placeholders, "No description", and "Reset to fetched"); `/link card` and `/link inline` take an address in the slash menu; the context menu has "Show link as"; a card is drawn in the writing surface from its preview, or from its address while there is none. **Internal document links and file links are built** (they are layers of the same preview, with their own notes under "Internal links" and "File links"): a link to a document is resolved for the reader by id and never stored, in the member, share-link and public fills and in the editor's lookup; a link to a file is recognised from its headers and drawn as a file card. Not built: `Ctrl+K` with the display choice, the command palette entries, refresh and the status line in the toolbar, the embed display, and the organisation default display and settings screens (step 5).
5. Settings and policy, then the embed allowlist.
4. The directive and its renderers (inline, card, peek) on the reading and public surfaces, then the editor: paste prompt, floating toolbar, preview details, slash, `Ctrl+K` and command palette. *Started.* Built and tested: the `link` directive (parse, validate, write back, unknown attributes kept), its slot in the body, and the fill. **The reading surfaces are built:** a member's `GET /documents/:id/rendered` fills the body for the viewer (queueing what is missing, answering `pendingLinks`, tagged by what was drawn so a late preview is never a 304 for the plain link), the public site and share links draw stored previews only, and publishing queues the previews of a document's links so the first reader finds them. The web client looks again at 2, 4, 8 and 16 seconds while any are pending, then stops. Chips and cards are styled in the shared prose stylesheet. **The hover and focus peek is built** (a reader preference of the browser, on by default, off on touch). **The editor is built in part.** A link is one thing with a display: a plain Markdown link, an inline `:link` or a `::link` card, and one command moves it between them without losing its address or the author's words (`packages/editor/src/link`). Pasting a bare address inserts the plain link at once and offers `Show as Link · Inline · Card`, which takes no focus and goes away on typing, Escape or moving off; the floating toolbar on any link has the same segmented control, and for a card its layout, image and a Preview details box (title and description over the page's, with the fetched words as placeholders, "No description", and "Reset to fetched"); `/link card` and `/link inline` take an address in the slash menu; the context menu has "Show link as"; a card is drawn in the writing surface from its preview, or from its address while there is none. **The editor is now complete** except the embed display: `Ctrl+K` carries the display choice, the command palette lists "Show link as …" for the link at the cursor, and the toolbar's status line and "Refresh preview" are built (see Authoring surface). **The compact display** (favicon, title and site on one line, for lists of references) is a first-class display everywhere: the paste offer, the toolbar, the context menu, `/link compact`, the writing surface, the reader, the public site and share links, presentation mode (it is drawn in `em`, so it scales with the slide) and print (a line is never split across pages); a run of compact links sits closer than paragraphs do. A link written with no display is drawn, in the editor as in the reader, as the organisation's default. Not built: the embed display (step 5, with the embed allowlist).
5. Settings and policy, then the embed allowlist. *Settings and policy built; the embed allowlist is not.* The organisation's `linkPreviews` section (an additive, optional part of its settings document, ADR-033/034: mode, public site, default display, allow and block lists) is saved from **Settings, Links**, which validates each pattern as it is typed with the parser the server enforces with and refuses an invalid one with the line and the reason (the settings API answers the same, `422 invalid_settings`, naming `/linkPreviews/block/2`). It decides what Quill fetches for members and for the public site (a change takes effect on the next request in every process, and moves the organisation to a new scope), how a link its author gave no display is drawn for members, the public site and share links, and which choice the paste offer points at. With the public site switched off, the public site and share links draw plain links. An unreadable settings file fails closed (previews off). A change to the policy is its own audit event (`settings.link_previews.changed`, the shape of the policy and the size of each list, never a pattern).
6. The connector layer, with the first connector (GitHub).
5. Settings and policy, then the embed allowlist.
6. The connector layer, with the first connector (GitHub). *Built.* The port, the registry, resolver layer 1 and GitHub over `api.github.com`: repositories, pull requests, issues (an issue number that is a pull request follows to the pull request, which knows if it merged) and code permalinks (`blob/<full commit id>/<path>#L10-L20`; a branch is not a permalink and is left to the page layers). The token is the secret `connectors/github/token`, entered on the Secrets screen or with `secrets:set`, read when a fetch needs it and never held; with none, GitHub is asked anonymously, for public content, at its lower rate limit. The token should be a fine-grained one limited to public repositories, read-only: only public content is ever shown, so a token that cannot read anything else costs nothing and cannot leak anything else. A line-range fragment is now part of the preview key (`normaliseUrl` keeps `#L10-L20`, since it changes what the link is about), so two permalinks to one file do not share a snapshot. The editor's card shows the status and a three-line excerpt; the reader and the public site draw the status on chips, compact links and cards, and a permalink as a captioned, numbered code block. Not built: private content shown to those who may open it (above), Jira and other connectors, and a settings screen specific to connectors (the Secrets screen is the entry for the token).
