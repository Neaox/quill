# ADR-042: Link previews

**Status:** Accepted
**Date:** 2026-10-11
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

1. **A connector's API**, for a host with one configured: GitHub, Jira and the like (see the connectors idea). This is the only layer that can see private content.
2. **oEmbed.** A known provider from a vendored, pinned copy of the oembed.com registry, otherwise discovery via `<link rel="alternate" type="application/json+oembed">`. JSON only. XML oEmbed is refused.
3. **Open Graph**, then **Twitter Card** tags.
4. **The page itself:** `<title>`, `meta name="description"`, `link rel="icon"`, and JSON-LD `headline` and `description`.

Every field is treated as untrusted plain text: trimmed, length-capped, and stripped of control characters. Remote HTML is never rendered. oEmbed `html` is ignored unless the provider is on the **embed allowlist** (below).

### Fetching the open web safely

The outbound client gains an **open-web mode**, as a separate instance with its own stricter configuration, never by loosening the allowlisted one. ADR-011 is amended to admit it. In this mode:
- there is no host allowlist;
- every address check of the existing client still runs, and runs on every hop: private, loopback, link-local, unique-local, CGNAT, multicast, the metadata ranges, and IPv4 embedded in IPv6;
- the connection is pinned to the address that was checked;
- at most 5 redirects;
- the request has a 6-second total budget;
- only `http(s)` on ports 80 and 443;
- only `text/html` or `application/json`, decided from the response headers before the body is read;
- the body is read as a stream, and reading stops at `</head>` or 512 KiB, whichever comes first;
- the character set is taken from the header, else the meta tag, else UTF-8.

The user agent is honest: `<Brand>Bot/<version> (+<instance URL>/bot)`. The `/bot` page explains what is fetched and how to opt out. A small, documented list of hosts known to serve Open Graph only to well-known crawlers may get a fallback user agent. Every such entry is reviewed.

Rate limits apply per target host, globally (a token bucket), and per organisation. Fetches are de-duplicated: concurrent requests for the same key share one in-flight fetch.

`robots.txt` is not consulted, as with Slack and other unfurlers, because a preview is a single fetch on a person's behalf, not a crawl. The `/bot` page says so, and an organisation can block hosts.

### Images are ours or nothing

A thumbnail or favicon is never hotlinked: that would leak readers' addresses and break the image CSP.
- The image is fetched once through the same open-web client, with images only and a 5 MiB cap.
- Its bytes are sniffed to confirm it is PNG, JPEG, WebP or GIF; SVG is refused.
- It is decoded, re-encoded and resized to fixed sizes, which also strips metadata.
- It is stored in the blob store under its hash and served same-origin and immutable.

A preview whose image fails keeps its text.

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
- **Scope.** A preview from the public layers (2 to 4) is shared across the instance. A preview from a connector (layer 1) is keyed by integration and visible only where that integration is granted.
- **Rendering never fetches** (ADR-031). The body renders a link with a preview slot carrying the normalised key. Page assembly fills slots from the snapshot store, exactly as it fills live blocks. A missing snapshot shows the plain link and queues a fetch. The public site shows a preview only from the public layers, and only if the organisation allows previews there.
- **In the editor**, pasting a URL inserts the link at once, and a placeholder chip resolves when the preview arrives. A slow or failed preview never blocks typing.

### Markdown stays a URL

A preview is a presentation of a link, never content.
- A bare URL on its own line, or a pasted URL, takes the organisation's default display.
- An author's choice is written as a directive so it round-trips and degrades: `::link{url="https://…" display=card}`, or `:link[https://…]{display=inline}` in running text. The display is one of `url`, `inline`, `card` or `embed`; a `fields=` attribute applies where a connector supplies structured fields.
- Outside Quill each form reads as its URL. The choice is made from a floating toolbar on the link (ADR-039's editor binding), with keyboard access and undo.

### Embeds are an allowlist

A live embed (video, slides, a design file) is an iframe. Only providers on an instance embed allowlist may embed:
- each entry names the provider, its URL patterns, its iframe source pattern, and the `sandbox` and `allow` tokens it needs;
- the page's CSP `frame-src` is generated from that list;
- iframes are `sandbox`ed, `loading="lazy"`, and without `allow-same-origin` unless the entry requires it and was reviewed.

Everything else is at most a card.

### Policy

Organisation settings control link previews:
- on or off;
- on or off for the public site;
- a block list and an allow-only list of hosts;
- whether the instance-wide anonymous layer may be used, so an organisation can require connectors.

Internal hostnames, including the instance's own private names and anything resolving inside, are never fetched. Private content needs a connector. Every fetch is logged with its host and outcome, never the response. Policy changes are audited.

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

1. The open-web outbound client, with its tests and the ADR-011 amendment.
2. The resolver layers 2 to 4 and the image pipeline, against recorded fixtures.
3. Snapshots and refresh jobs (on ADR-032's store), and slot filling at page assembly.
4. Editor paste, the toolbar, and the directive.
5. Settings and policy, then the embed allowlist.
6. The connector layer, with the first connector (GitHub).
