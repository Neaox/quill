# Security review: link previews (ADR-042, steps 1 and 2)

**Date:** 2026-10-13
**Standard:** ADR-011 and `docs/security/checklist.md`; ADR-042.
**Scope:** `apps/server/src/infrastructure/http/` (the open-web client, its resolver and limiter), `apps/server/src/infrastructure/link-preview/` (resolver layers, metadata extraction, image pipeline), `packages/domain/src/link-preview/` (URL normalisation and policy), and the vendored oEmbed registry.
**Method:** a read of every module against the threat model below, then measurement of every place that takes untrusted input and does work proportional to it. Two findings below were found by measuring, not by reading.
**Not in scope:** anything not built yet: the snapshot store and refresh jobs, the settings screens, the directive and its renderers, the editor, the `/bot` page, and the connectors.

## Threat model

The server fetches whatever a signed-in person pastes. The attacker is that person, or the author of any page, image, redirect or oEmbed endpoint the server is then pointed at. They want to:

1. reach something inside our network (SSRF);
2. make the server do unbounded work (CPU, memory, sockets, threads);
3. get something of theirs stored and later served from our origin (stored XSS, content injection);
4. read secrets from the process;
5. learn about, or track, other people's reading.

## Summary

Nine findings. Two were high-severity denial-of-service problems that the first implementation had, found by measurement. All are fixed in code except the parts that need the next steps, listed under **Open**. No finding allowed reaching an internal address: the SSRF defences held under every test, including DNS rebinding, redirects, numeric host spellings and IPv4-in-IPv6.

| #   | Severity | Finding                                                                                         | Status                                   |
| --- | -------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------- |
| S1  | High     | The HTML parser is quadratic in nesting: a 500 KiB page of `<div>` blocks the server for ~47 s | Fixed                                    |
| S2  | High     | oEmbed scheme matching backtracked catastrophically: a 600-character URL took ~1 s, longer ones never finished | Fixed                    |
| S3  | Medium   | Name resolution ran on the libuv threadpool shared with file I/O                                | Fixed                                    |
| S4  | Medium   | Nothing bounded how many fetches ran at once                                                    | Fixed for the process; fairness is open  |
| S5  | Medium   | The image worker inherited the server's environment, and its reply was trusted                  | Fixed; OS sandboxing is an operator task |
| S6  | Low      | Several special-purpose IPv6 ranges were not refused                                            | Fixed                                    |
| S7  | Low      | An IPv6 literal as a host could not be fetched (brackets), and IP literals were looked up       | Fixed                                    |
| S8  | Medium   | A block list checked only against the pasted URL is bypassed by a redirect or an image host     | Designed and enforced per request        |
| S9  | Low      | No bound on URL length                                                                          | Fixed                                    |

## Findings

### S1. HTML parser quadratic in nesting (High, fixed)

parse5 implements the HTML Standard's tree construction, whose "in scope" checks walk the stack of open elements. Measured on this machine, parsing `<div>` repeated N times: 10 000 deep took 0.46 s, 50 000 took 15.5 s, 100 000 took 46.6 s (a 500 KiB page, which is exactly the read cap). The parse runs on the one thread that serves every request, so one pasted link to such a page stops the server. `</head>` truncation does not help, since an attacker simply omits it.

**Fix.** `headMarkup` cuts the input at `</head>` or `<body`, and at 2 000 start tags, before parsing. A page's metadata is in its head; the rest is content a preview never reads. Tests cover 100 000 nested `<div>`s in the body, with no head close, and 100 000 nested `<template>`s inside the head (which would otherwise nest legitimately), each under 500 ms.

### S2. oEmbed scheme matching backtracked (High, fixed)

The first matcher compiled each provider scheme to a regular expression. The registry contains `https://backtracks.fm/*/*/*/*/e/*/*`, six wildcards, which becomes `.*/.*/.*/.*/e/.*/.*`. Against `https://backtracks.fm/` followed by repeated `a/`, 100 segments took 61 ms, 300 took 935 ms, and 1 000 did not finish.

**Fix.** The matcher is a two-pointer glob (cost at most `pattern × text`), host and path matched separately so a host wildcard can never reach into a path. Registry lookups are indexed by host, so a lookup tries a handful of patterns, not all of them. URLs over 4 096 characters are not looked up (and `normaliseUrl` refuses them outright).

### S3. Threadpool starvation through `getaddrinfo` (Medium, fixed)

Node runs `getaddrinfo` on its four-thread libuv pool, shared with `fs`, `crypto` and `zlib`. A domain whose nameserver is slow on purpose holds a thread until the resolver gives up; four such lookups stall every file read in the process. The allowlisted client is safe from this because its names are vetted; the open-web client's are not.

**Fix.** `open-web-resolver.ts` uses c-ares (`dns.Resolver`), which does its own non-blocking I/O, with a 2-second timeout and two tries, querying A and AAAA together. Every answer is kept and any private one refuses the host. Trade-off, deliberate: c-ares does not read the hosts file, so `localhost` and other local names no longer resolve here, which is the safe direction.

### S4. No bound on concurrent work (Medium, fixed for the process)

Unbounded, a burst of pastes opens a socket and a buffer per link, and a tarpit host costs a connection each for the full 6 s.

**Fix.** `limiter.ts`: 8 requests at once, 64 queued in order, the rest refused immediately as `too_busy` (reported to callers as `busy`, which is never cached because it says nothing about the link). The time budget starts when a request starts, not while it queues.

**Open.** This bounds the process, not fairness: one organisation or one host can still take every slot. The per-host token bucket and per-organisation limits in ADR-042 are step 3.

### S5. Image worker environment and reply (Medium, fixed)

Two issues. The worker was forked with the server's full environment (database URL, session and encryption keys, integration credentials), so an exploit in libvips that ran code there would find them. And its reply, which is stored and later served from our origin, was trusted.

**Fix.** The worker gets `env: {}`, pinned by a test. The reply is validated: the bytes must be a WebP, at most 2 MiB, with whole-number dimensions within the size the job allowed.

**Residual risk, stated plainly.** A native exploit runs as the server's OS user. I tried Node's permission model (`--permission`) and it does not help: native addons must be allowed (`--allow-addons`), and Node documents that this invalidates the model. The real mitigations are operational and belong in the deployment guide: run the server as an unprivileged user in a container with a read-only filesystem and no egress other than the public internet.

### S6. IPv6 ranges (Low, fixed)

Not refused before: `fec0::/10` (site-local), `64:ff9b:1::/48` (local-use NAT64, where the embedded IPv4 address's position depends on a prefix length we cannot know, so the whole range is refused), `::ffff:0:0:0/96` (IPv4-translated, with the IPv4 address checked), `100::/64` (discard-only), and `2001:db8::/32` (documentation). IPv4 documentation ranges (TEST-NET) are deliberately **not** refused: they are unroutable, and the OIDC development helper uses one as its stand-in "public" address.

### S7. IP literals as hosts (Low, fixed)

A URL's host for an IPv6 literal keeps its brackets (`[2606:2800::1]`), which a lookup cannot resolve, so such links could not be previewed; and an IP literal was sent to the resolver. Both forms now bypass the lookup and go straight to the address check.

### S8. Policy must be enforced per request (Medium, designed and enforced)

An organisation's block list that is evaluated only against the pasted URL is bypassed by a `302` to a blocked host, by a page whose `og:image` is on a blocked host, and by an oEmbed endpoint on another host. Also, an oEmbed provider would be sent a URL the policy forbids contacting.

**Implemented.** `UrlPermit` is asked on **every** hop and every request, including each image and oEmbed fetch, and the pasted URL is checked on its own before any provider is asked. The domain package holds the policy grammar (hosts, `*.` subdomains, path prefixes, no regular expressions) with tests for the usual bypasses: trailing dot, upper case, explicit port, credentials in the URL, decimal, hex and octal IP forms, dot segments, encoded dot segments, and doubled slashes.

**Open.** Storage, the settings screens and audit are step 5 (built; see S10). Enforcement **at read time** is specified in the ADR and must be built with step 3: a cached preview must be re-checked against the viewing organisation's policy when shown, or a policy change would not take effect until the entry expired.

### S9. URL length (Low, fixed)

`normaliseUrl` refuses a URL over 4 096 characters, the bound on what every later step is asked to process.

## What was checked and held

- **DNS rebinding.** The address is resolved, checked, and the socket pinned to exactly those addresses; the hostname is never resolved a second time. A second hop re-resolves and re-checks.
- **Redirects.** At most 5, each checked for scheme, port, credentials, policy and address. A `Location` that does not parse, or is missing, is a failure.
- **Numeric hosts.** WHATWG parsing normalises `2130706433`, `0x7f.1` and `0177.0.0.1` to `127.0.0.1` before any check, so the address check and the policy see the real address.
- **Scheme, port, credentials.** `http(s)` only, ports 80 and 443 only, never a URL with credentials. The client also refuses to carry an `Authorization`, `Cookie`, `Proxy-Authorization` or `X-Api-Key` header at all, so a future caller cannot send a credential to a host the page chose.
- **Body handling.** The media type is decided from headers before the body is read; compressed bodies are refused (the byte cap counts real bytes); a lying `Content-Length` is ignored while reading; reading stops at the marker or the cap; the one time budget covers the body, so a slow-drip host is cut off.
- **Untrusted text.** Whitespace and control characters collapse, bidirectional overrides and zero-width characters are removed (so one domain cannot be made to read as another), length is capped on a code point.
- **oEmbed `html`** is never read. Embeds will be built by Quill from an allowlisted provider's own iframe pattern.
- **A page's canonical link** is believed only for its own site.
- **Images.** Never hotlinked; fetched once; type decided by bytes, not header or extension; SVG refused; re-encoded to WebP at fixed sizes (stripping metadata); animation reduced to its first frame; pixel limit checked from the header; stored under its hash.
- **No ambient privacy leaks from the client.** No cookies, no referrer, an honest user agent, and nothing sent that identifies the person who pasted.

## Addendum: step 3 (snapshots, queue, read API)

Reviewed as it was built. No finding of the severity of S1 or S2; three decisions are worth recording.

- **A fetch runs under the asker's policy, and a restrictive policy's results are private to it.** The first design stored every snapshot in one shared pool and filtered at read time. That hides a result from an organisation that blocked it, but not the fact that Quill *contacted* the blocked host (or its image host) on that organisation's behalf, which is what a block list is for. Scopes derived from a hash of the exact policy fix it: the fetch honours the policy, and the result is only ever read by the same policy. A policy that cannot be compiled fails closed, as previews off.
- **The queued URL can carry a token** (a signed or unlisted link). It has to be in the payload for the job to run, so the processed row is redacted to the site's address, as the mail consumer does for its link. The stored preview row is keyed by the normalised URL; it is derived data, already present in the document that contains the link, and swept after 90 days.
- **The endpoints cannot be made to fetch faster than the limits allow.** Reading only queues; the fetch is rate-limited per host, per scope and globally, and a refresh is limited per person. A burst is spread out by the outbox's backoff rather than refused.

Closed from the open list below: 1 (rate limits and de-duplication of concurrent fetches), 2 (read-time policy and scoping). The pass of 2026-10-17 below closes the logging part of 3, the `/bot` page (4) and serving stored images (5).

## Addendum: the full pass on outbound requests and performance (2026-10-17)

A second review, asked for as "are we following the rules when we make external requests, and is it fast". It covered every place the server talks to another machine, not only link previews, and measured each hot path against the budgets in the plan (section 31). Findings S10 to S19; everything here is fixed unless it says otherwise.

### Every outbound request, and the rules it is held to

| Call                                    | Reaches                                                   | Who chooses the host   | Client                         | SSRF address check | Redirects          | One clock for the call | Size cap  | Credentials         |
| --------------------------------------- | --------------------------------------------------------- | ---------------------- | ------------------------------ | ------------------ | ------------------ | ---------------------- | --------- | ------------------- |
| Pwned Passwords range                   | `api.pwnedpasswords.com`                                  | Operator               | Allowlisted client             | Yes                | Re-checked, max 3  | **Now yes** (S10)      | 1 MiB     | None                |
| OIDC discovery, JWKS, token exchange    | The issuer an administrator configured                    | Administrator          | Allowlisted client             | Yes                | GET re-checked; POST refused | **Now yes** (S10) | 1 MiB     | Client secret (POST only, never redirected) |
| Link previews: pages, oEmbed, images    | Any public host a member pasted                           | **A stranger**         | Open-web client                | Yes, every hop     | Re-checked, max 5  | Yes                    | 512 KiB / 256 KiB / 5 MiB | Refused outright (S9, header guard) |
| Object storage (S3-compatible)          | The operator's bucket                                     | Operator               | `fetch`, signed                | No (trusted)       | Platform default   | **Now headers only** (S11) | Streamed | AWS signature       |
| Outgoing mail                           | The operator's SMTP server                                | Operator               | nodemailer                     | No (trusted)       | n/a                | **Now explicit** (S12) | n/a       | SMTP login          |
| Database                                | The operator's Postgres                                   | Operator               | `pg`                           | No (trusted)       | n/a                | Pool defaults          | n/a       | Connection string   |
| Scripts: `oembed:sync`, `dev:all`       | oembed.com; localhost                                     | Developer, at a terminal | `fetch`                      | n/a                | n/a                | 20 s                   | n/a       | None                |

Two rules govern the table. A host that **a stranger can choose** goes only through the open-web client, which holds no credentials and is checked on every hop. A host that **only an operator or administrator can choose** is infrastructure: it is not SSRF-checked, because the operator already decides where the server may reach, but it still needs a timeout and a bound on what it can make the server hold.

### Findings

| #   | Severity | Finding                                                                                                          | Status |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| S10 | Medium   | The allowlisted client's timer stopped once headers arrived, so a provider could drip a body for as long as the size cap allowed, per request | Fixed: one clock for resolve, every redirect and the body (shared `budget.ts`) |
| S11 | Low      | The object store client had no timeout: a bucket that stopped answering held the request and everything behind it | Fixed: 30 s to begin answering, not cut mid-transfer |
| S12 | Low      | Mail used nodemailer's defaults (two minutes to connect, ten of silence), long enough for a dead server to stall the outbox | Fixed: 10 s, 10 s, 30 s |
| S13 | Medium   | The fetch job ran on the main outbox poller: one event at a time, inside the claiming transaction, with a rate-limited fetch counted as a failed attempt. A few slow sites would delay publishing and mail, and a burst of links to one site could dead-letter good work | Fixed: its own lane (leases, bounded parallelism, no held transaction), and "not yet" is not a failure |
| S14 | Medium   | A person could cause an unbounded number of fetches and outbox rows by asking about links, and poll without limit | Fixed: per-person allowances for reads and for new fetches; the rest read as pending and are queued later |
| S15 | Medium   | An anonymous reader's page load must never be able to cause a request to anyone's server; the only read path queued fetches | Fixed: `peekLinkPreviews` reads and never writes |
| S16 | Medium   | Stored pictures had no way to be served, and the obvious one (a route that opens any blob by hash) would let anyone read any stored file whose hash they know, attachments included | Fixed: only a hash a stored preview shows is served, as an inert WebP; everything else is the same not-found |
| S17 | Medium   | The user agent promised a page at `/bot` that did not exist, and fetches were not logged though the ADR requires it | Fixed: `/bot` exists and states exactly what the client enforces; one log line per fetch with the host and outcome |
| S18 | Low      | Image decoding spawned a 73 MiB process per image, up to eight at once | Fixed: a pool of two reusable workers, killed on any failure (see performance) |
| S19 | Low      | A stored preview, once its image was swept, could still be asked for by hash | Fixed with S16: the reference is checked on every request |

Not findings, but worth recording: the S3 client follows redirects by default. `fetch` removes the `Authorization` header when a redirect crosses origins, so a hostile redirect would fail rather than leak the signature, and the endpoint is the operator's own.

### Rules for external requests, and where each is met

| Rule (source)                                                                                   | Met by |
| ----------------------------------------------------------------------------------------------- | ------ |
| One outbound client with an SSRF check, redirects re-checked, timeouts, size caps (ADR-011)     | Both clients; shared address check and clock |
| Open-web instance: no credentials, stricter limits (ADR-011 amendment)                          | `credentials_in_request` guard; 5 redirects, 6 s, 512 KiB, ports 80/443 |
| Rate limits with backoff (AGENTS rule 18)                                                       | Per host, per scope, global; per person for reads, new fetches and refresh; the outbox backs off with jitter |
| Audit without secrets (AGENTS rule 18)                                                          | One log line per fetch: host, purpose, outcome, status, redirects, bytes, duration. Never the path, query or body (tested) |
| A stranger's content is never rendered as received (checklist: rendering, uploads)              | Text cleaned; images re-encoded in an isolated worker with no environment; served from our origin only |
| Honest, contactable user agent; a way to stop it (ADR-042)                                      | `/bot`, generated from the enforced limits |
| Organisation policy on every request (ADR-042)                                                  | Page, each redirect, oEmbed endpoint, each image |
| Failure is cached briefly, never retried in a loop (ADR-042)                                    | One hour; `busy` is the only failure not cached |
| Nothing that holds credentials may use the open-web client (ADR-011 amendment)                  | Enforced by the client refusing credential headers, not by convention |

### Performance, against the plan's budgets

Measured on this machine with `pnpm --filter @quill/server bench:link-preview`, which fails if a budget is exceeded.

| Path                                                          | Before          | After      | Budget  |
| ------------------------------------------------------------- | --------------- | ---------- | ------- |
| Find the link slots in a 225 KB body (50 links)               | 98 ms           | 4 ms       | 40 ms   |
| Find and fill them (a cached document open is 200 ms in all)  | 98 + 88 = 186 ms | 6.5 ms     | 60 ms   |
| A body with no slots                                          | 0.3 ms          | 0.3 ms     | 2 ms    |
| Read a stranger's 450 KB page                                 | 1.8 ms          | 2.6 ms     | 20 ms   |
| The same page, 100 000 elements deep                          | 47 s (S1)       | 0.8 ms     | 50 ms   |
| Decode one 1200x630 image                                     | 528 ms          | 22 ms      | 150 ms  |
| Decode eight at once                                          | 774 ms, 8 processes, about 590 MiB | 396 ms, 2 processes, about 145 MiB | 1500 ms |
| Write the outbox events for a page of fifty new links         | 50 statements   | 1 statement | 1     |
| Look up fifty links                                           | 1 query         | 1 query     | 1     |

Finding the slots by searching for the marker, instead of parsing the body into a tree and writing it out again, is what made the body path twenty times faster. It is sound because of what the body is: the exact text `<a href="…" data-link-slot=""` cannot be produced by anything an author writes, since raw HTML becomes text, text has its `<` escaped and attribute values have their `"` escaped. Tests build bodies with the marker in text and in other attributes to prove it.

The web bundle is unaffected: the web app imports only `@quill/markdown` subpaths, never the barrel the new code is exported from. (The web build as a whole fails on this branch for an unrelated reason, a missing `useRevisionDiff` export, so the bundle check itself could not be run.)

### Left open

- The per-host token buckets are per process, so with several server processes the allowance is per process. A shared store replaces them when there are many.
- Fetch events are logged, not yet counted as metrics.
- Policy storage and the settings screens (step 5) are still to build; the audience is the default for everyone until then.
- `GET /bot` states the limits of the default configuration. If an operator changes them, the page should read them from configuration.

## Addendum: live embeds (2026-10-17)

**Scope:** `packages/domain/src/link-preview/embed-providers.ts` (the allowlist), the resolver's `embed` field, the `embed` drawer in `packages/markdown/src/render/link-slots.ts`, the CSP `frame-src` (`apps/server/src/plugins/security-headers.ts`, `app.ts`), `LINK_EMBEDS_DISABLED` (`infrastructure/link-preview/embed-config.ts`), and the editor's `Embed` choice and placeholder. Checked against every section of `docs/security/checklist.md`, below.

### What this adds, and what it does not

An embed is the one place in Quill where a third party's page is loaded **by the reader's browser** on our page. The server fetches nothing new: the resolver makes no extra request for an embed, and the frame is built from the pasted address. The new risks are therefore in the browser: what the frame can do to our page, what it learns about the reader, and whether the list of what may be framed can be widened by anyone but a reviewer.

### Threats and how each is met

| Threat | Control | Test |
| ------ | ------- | ---- |
| An author or a page chooses where the frame points (open frame, phishing, script URL) | The `src` is built from validated parts (an identifier of fixed alphabet and length) on the provider's own https origin. Open Graph tags and oEmbed `html` are never read for it | `embed-providers.test.ts` (hostile address, query and path injection); `link-preview-provider.test.ts` (a page that names another frame) |
| A stored preview is altered, or outlives a provider being switched off | The renderer asks the registry to recognise the stored frame at draw time: provider on, https, no credentials, an origin of that provider. Otherwise it draws a card | `embed-providers.test.ts` (`recognise`); `link-slots.test.ts`; `fill-links.test.ts` |
| A frame navigates or pops up on our page, or reaches our origin | `sandbox` comes from the provider's entry: `allow-scripts` and `allow-same-origin` (and `allow-presentation` for players) only. No top navigation, popups, forms, modals or downloads. Every frame is on another origin than ours, so `allow-same-origin` gives the provider its own storage and nothing of ours. A stated reason is required wherever the token appears | `embed-providers.test.ts` |
| The CSP is widened for something that is not a frame | Only `frame-src` is generated; `default-src`, `script-src`, `connect-src` and the rest are untouched and tested as unchanged. `frame-ancestors 'none'` stays | `security-headers.test.ts` |
| A frame source exists that no reviewer approved | `frame-src` is exactly the origins of the providers left on (plus the configured draw.io editor). The tests fail if any other source, a wildcard or a scheme-only source appears. With every provider off it is `'none'`. The public site and shared pages carry the same policy | `security-headers.test.ts`; `public-site.integration.test.ts` |
| An organisation that asked for text only, or none, gets a third-party frame | The resolver records a frame only under `rich`; `off` makes no preview at all; the renderer cannot draw what was never recorded | `link-preview-provider.test.ts` |
| An export or a crawler's copy contains a frame | The body holds only a slot (a plain anchor); frames exist only after a page fill, which an export never runs | `link-slots.test.ts` |
| A path crafted to make matching slow | Exact host match, then segments and identifiers checked per character; no regular expression over a path. A 10 000 character path is matched against every entry in a test with a time budget | `embed-providers.test.ts` |
| An operator mistypes the switch that turns a provider off, and it stays on | An unknown id stops the boot | `embed-config.test.ts` |
| A reader's address and browsing leak to the provider when the page loads | Inherent to a live frame, and the reason the feature is chosen per link, limited to `rich`, lazy (a frame below the fold loads nothing) and switchable per provider by the operator. YouTube uses its privacy-enhanced origin. `Referrer-Policy` stays `strict-origin-when-cross-origin`, so only our origin, never a path, is sent | `link-slots.test.ts` |
| An anonymous read causes a request | Unchanged: drawing a frame is part of a response, not a fetch; the public fill never queues anything | `fill-links.test.ts` |

### Checklist

- Headers and transport: strict CSP kept (no `unsafe-inline`); `frame-ancestors` kept; `frame-src` generated and tested. Met.
- Input, output, content: the frame is built by `rehype-stringify` from a tree, so every attribute is escaped; the title is escaped in the `title` attribute and the caption (tested with `<`, `&` and quotes). The caption link has `rel="noopener noreferrer"`. Met.
- Outbound requests: no new server request. Met.
- Bounded matching: met, measured.
- Anything cached: the filled body's validator already names what was drawn (`drawnTag`), so a frame appearing or disappearing changes the tag. Met.
- Authentication, authorisation, abuse, supply chain: unchanged by this work; no dependency was added.

### Findings

- **E1 (Low, accepted, documented).** `allow-same-origin` is on for all eleven entries. Every one needs it for its player or viewer to run, and each states why. A provider whose frame would be on **our** origin must never get the token (it would let the frame remove its own sandbox); the registry only admits third-party https origins, and adding one is a reviewed change.
- **E2 (Low, accepted).** A framed provider hosts third-party content (any Google Doc, any Miro board). The sandbox keeps it from our page; it can still show its own content to the reader. The mitigation is that an author chose it, the organisation allows `rich`, and an operator can switch the provider off.
- **E3 (Info).** Posts from X are not embedded: the supported embed is a script, not a frame, and the plain-frame address is undocumented. They remain cards.
- **E4 (Info).** LinkedIn is admitted on the strength of its documented plain-frame address. It has not been exercised against a live post from this environment, so the first operator to enable it should check one post; `LINK_EMBEDS_DISABLED=linkedin` turns it off.
- **E5 (Open).** Previews stored before this change carry no frame; they gain one when they next refresh (three days), or on "Refresh preview".
## Addendum: the connector layer and the GitHub connector (2026-10-17)

Reviewed as it was built (ADR-042, step 6). The connector is the first code in the link preview path that **holds a credential** and the first that can **see private content**, so the review is about those two things. Findings C1 to C7.

| #   | Severity | Finding                                                                                                                                                | Status |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| C1  | High     | A token that can read private repositories would let a pull request title, a description or source lines reach a reader who cannot open the repository | Designed out: only public content is ever previewed |
| C2  | Medium   | A preview kept from when a repository was public would stay on show after it became private ("last good snapshot" survives failed refreshes)           | Fixed for every refresh; residual window below |
| C3  | Medium   | The credentialed request could be steered by the link (an encoded slash, a dot segment, a look-alike host) to another API path or host                 | Fixed: paths are built from validated pieces; one allowlisted host |
| C4  | Medium   | The failure for a private link would tell any reader that a private repository exists                                                                  | Fixed: stored as `restricted`, always shown as "not a page" |
| C5  | Medium   | Lines of source from a stranger's file are shown on our pages                                                                                          | Fixed: plain text, capped, stripped, escaped, never highlighted by script |
| C6  | Low      | GitHub's rate limit could be spent by one person varying line ranges, or counted as a failure that is then cached for an hour                          | Fixed: a wait, never a failure; bounded by the existing limits |
| C7  | Low      | The token could leak through a log, an error message, a preview or the audit trail                                                                     | Held: tested |

### C1. Private content (the rule, and why)

Three designs were weighed for a preview fetched with credentials of a private resource:

1. **Show it to everyone who sees the link.** Rejected outright: it publishes private titles and code to people GitHub would refuse.
2. **Store it per person and show it to the person who asked.** Correct, but it needs a scope per person in the snapshot store, a per-reader check against GitHub for everyone else who opens the document, and a decision about what the public site does. None of that exists, and a half-built version of it is the kind of thing that leaks.
3. **Do not make it.** Chosen. The first request of every resolution reads the repository; a repository whose `private` is true, or whose `visibility` is anything but `public`, or that does not say, makes no preview and reads no further. A private link is a plain link, which is also what GitHub shows a stranger.

The consequence, stated plainly: **the GitHub connector today raises the quality and the rate limit of previews of public repositories; it does not preview private ones.** The ADR's "the only layer that can see private content" is true of what it *can read*, not of what it *shows*. The recommended token is a fine-grained token limited to **public repositories, read-only**: with it, a defect in this module cannot read private content at all.

Tests: a private, an internal and a visibility-less private repository, and a pull request, an issue and a code permalink in a private repository, each answering `restricted` after exactly one request (the repository's); a response that does not say whether the repository is public is `unavailable`, not guessed; a pull request whose own `base.repo` says private is `restricted` whatever the repository read said.

### C2. After a repository becomes private

`restricted` is the one failure that **drops** a stored preview; every other failure leaves the last good one (ADR-032). A repository that goes private is noticed at the next refresh, which is at most three days away for a link in use (a stale preview is served while it refreshes), or at once if anyone presses "Refresh preview". **Residual risk:** until then the title and description of the repository as it was while public remain visible. They were public; this is the same exposure as any cached copy of a public page. The three-day freshness is the bound.

### C3. Where the credential can go

The token is attached in one function, to a request whose host is the constant `api.github.com` and whose path starts `/repos/<owner>/<repo>`. The owner, repository, number, commit and path come from `github-urls.ts`, which accepts only GitHub's own naming rules, a full commit id (a branch is not a permalink), and path segments that, once decoded, contain no `/`, backslash, control character, `.` or `..`. The client is the allowlisted one, so even a defect that built another host would be refused before any connection (`host_not_allowed`), and its redirects are re-checked against the same list. Tested with encoded slashes, backslashes, control characters, dot segments, look-alike hosts (`github.com.evil.example`), subdomains (`gist.github.com`) and malformed escapes.

The organisation's host policy is checked against the pasted link (as for every layer), not against `api.github.com`: an organisation that allows `github.com` and nothing else still gets previews, and one that blocks it never reaches the connector. The picture the connector names (the owner's avatar) is fetched through the open-web image pipeline, under the policy, and is accepted only from `avatars.githubusercontent.com`.

### C4. Not telling a reader that a repository exists

GitHub answers 404 for a private repository and for one that does not exist. Quill would otherwise answer "restricted" to any member who pasted a guessed name. The failure is stored as `restricted` (it has to be, to drop the old preview) and read as `not_a_page`.

### C5. Source lines

A permalink shows up to 30 lines of at most 240 characters each. The file must be UTF-8 text without NUL bytes (a binary file is not shown) and fit the client's response cap (2 MiB of JSON, which holds files up to about 1.4 MB). Control characters and the invisible and bidirectional formatting characters (which can make code read as something it is not) are removed; tabs are kept. The lines are text nodes in the page, escaped by the serialiser; the snippet adds no script, no `style` attribute and no highlighting markup, and a `language-*` class is added only for a language name that is a plain identifier. The stored reader enforces the same caps again on whatever it reads. Tested with markup, control characters and a hostile language name.

### C6. Rate limits

GitHub's `retry-after` and `x-ratelimit-*` headers are honoured: a 403 or 429 that carries them, or a success that says none remain, becomes a wait (at least one second, at most thirty minutes) and the connector then makes **no request at all** until it is over. The fetch is deferred through the outbox lane's existing mechanism and is not counted as an attempt or stored as a failure; an ordinary 403 (a blocked repository, a bad token) is not mistaken for a limit. The existing per-host bucket (5 in a burst, then one every two seconds) already bounds `github.com` to well under an authenticated token's 5 000 requests an hour, and each person's allowance bounds how many new links they can cause; varying line ranges in one file costs two API calls per range and is bounded by those. **Residual:** an anonymous instance (no token) has GitHub's 60 an hour per address, so it defers often; that is the reason to store a token.

### C7. The token

It is a secret in the secrets store (envelope-encrypted, ADR-034) under `connectors/github/token`, entered on the Secrets screen or with `secrets:set` (value on stdin, never argv). It is decrypted when a fetch needs it and not held: a rotation takes effect on the next request. It is sent as `Authorization: Bearer` to one host and appears in no draft, failure, log line, error message or audit row (the tests serialise every outcome and look for it). A secret that cannot be opened degrades to anonymous requests instead of failing previews. There is no environment-variable fallback, by design: this is a new secret, so there is no deprecation to carry.

### What was checked and held

- The open-web client still refuses credential headers, and the connector does not use it.
- A connector failure never reaches a reader: not found, an API error, a timeout and a connector that throws all hand over to the page layers.
- `restricted` and a rate limit do not hand over: the page layers would answer with a sign-in screen or a different, ungated copy.
- A line range is now part of the preview key (`normaliseUrl` keeps `#L10-L20` and nothing else of a fragment). The pattern is anchored and bounded (`#L` and up to seven digits, an optional `-L` and seven more), so a key cannot be made arbitrarily large or unlike a line range.
## Addendum: links to documents and links to files (2026-10-17)

Two additions to the preview layers, reviewed against `docs/security/checklist.md` (permissions, rendering, outbound requests). One decides who is told what about a document; the other decides what an unfamiliar host can make the server read.

### Internal links must never leak a title

An internal link (`/d/<id>`) is resolved by id when a page is read. The rendered body is cached and shared between readers, so the body carries only the address; every title, description and place is added per reader, by `readInternalLinkPreviews`, after the cache. The places a title could leak, and what closes each:

| Where a title could escape                           | What closes it |
| ---------------------------------------------------- | -------------- |
| The shared render cache                              | The body holds the slot (`/d/<id>` and the author's words) and nothing resolved; a test pins that an unfilled body has no title. |
| A reader who may not view the document               | The authorizer (ADR-012) is asked for `view` on that document, for a member and for a share-link holder alike; a refusal draws the author's own words, else "Document unavailable", in a `span` with no link, no address and no title (`link-unavailable`). |
| The difference between "denied" and "does not exist" | Both are `blocked`, the same view and the same label, in the fill and in the editor's lookup (`POST /api/link-previews/resolve`), so the answer cannot be used to find which ids exist. A test asserts the two are equal. Response timing is not equalised: a missing id skips the permission walk. The ids are UUIDs and the lookup is rate limited, so this is recorded and accepted. |
| The description                                      | It costs a render of the target, and is asked **only for documents the reader may view** and only for links that will show it (a card, with no description of the author's own). A test asserts a denied document is never rendered on the reader's behalf. |
| The place (collection name)                          | Named only if the reader may also view the collection; a grant on the document alone does not reveal the collection's name. |
| The anonymous public site                            | The site's own `pages` decide: a document not published on *this* site is `blocked`, whichever site publishes it, and a published one links to its public page, never to the app's `/d/<id>`. The finished page is cached per site and path, which is safe because everything on it is public to every anonymous reader of that site. |
| The conditional-request tag                          | The tag hashes the filled body, so a reader with different access has a different tag; the response stays `private, no-cache`. |
| A fetch started on an anonymous reader's behalf      | Internal links never fetch and never queue; they are not counted as pending, and the publish-time warming skips them. |
| Markup                                               | The title is text in a hast `text` node (escaped on output), never HTML; the slot's `href` is rebuilt from a pattern that admits only letters, digits, `%`, `_` and `-` after `/d/`; the one new attribute (`data-link-internal`) is an empty marker in the sanitiser's allowlist. |

Cost is bounded: a body's links are capped at 50 per fill, the target rows are found in at most two queries, and the authorizer memoises the scope chain, so documents under one collection share the walk. That is one permission check per distinct document, which is the price of the answer being per reader.

An export keeps the plain `/d/<id>` link, as it keeps every link, so nothing resolved can leave through it.

### File links: what an unfamiliar host can make the server read

A file is recognised in the **same request** that would have fetched a page, from the response headers, and the body is never read.

| Concern                                 | Bound |
| --------------------------------------- | ----- |
| Downloading a large file to describe it | None of it is read: the transfer is cancelled as soon as the headers are in (`headersOnly`), so the bytes read are zero and a 4 GiB video costs one round trip. A test serves a body that never ends. |
| Which types                             | A fixed allowlist (`FILE_MEDIA_TYPE_PATTERNS`: images, video, audio, PDF, office and OpenDocument files, CSV, plain text and Markdown, common archives). `application/octet-stream` and executables stay `content_type_not_allowed`. |
| Every existing limit                    | Unchanged and applied to this path: the address check on every hop, 5 redirects, the 6 s total budget, ports 80 and 443, no credentials, and the organisation's policy asked on every hop. |
| A thumbnail                             | Only for PNG, JPEG, GIF or WebP, through the existing image pipeline with every cap it has (5 MiB, sniffed from bytes, isolated decode, re-encode, stored by hash). If the host declares a size over the cap the second request is not made. `text` mode makes none. |
| SVG                                     | Inert: it is a file card with an icon, never fetched for a thumbnail, never drawn, never served. |
| The declared size                       | Read only if it is 1 to 15 digits; anything else is "unknown". It is a label, not a limit anything relies on. |
| The file name                           | A stranger's text: taken from `filename*` or `filename`, cut to its last path segment (so `../../x` and `C:\x` cannot imply a path), cleaned of control and direction characters, and capped at 120 characters. It is displayed, never used to write anywhere. |
| The media type                          | The host's claim, shown as a label and an icon; a host can say a thing is a PDF that is not. Nothing is opened, rendered or served from it, and the link is followed by the reader like any other external link, with `rel="noopener noreferrer"`. |

### Left open

- The permission check is per distinct linked document; a page of 50 links to 50 documents in 50 collections costs 50 chains. A batched authorizer would replace it if that ever shows in the budgets.
- A share-link reader's internal links point at the app's `/d/<id>`, which they cannot open; they see the title only for a document their link reaches. A share-link-aware address is a later improvement.

## Open items

1. ~~Rate limits and de-duplication~~ Done (step 3, extended 2026-10-17).
2. ~~Read-time policy enforcement and cache scoping~~ Done (step 3).
3. **Audit of policy changes**, which waits for the settings screens (step 5). Fetch logging is done.
4. ~~The `/bot` page~~ Done.
5. ~~Serving stored images~~ Done, with the reference check.
6. **The operator layer**: an instance-level denylist no organisation can override, and the deployment guide's egress firewall and unprivileged-container recommendations (see S5).
7. **A stored preview key can contain a secret** (a signed or token-bearing URL). It is already in the document body, so nothing new is exposed, but the snapshot store's classification (ADR-034) should say so, and logs must record the host only.
8. ~~**A `connector` layer must never use this client**~~ Done: the GitHub connector uses the allowlisted client (see the addendum above). The credential-header refusal remains the backstop.
9. **Private content shown to those who may open it** (a per-person scope and a per-reader check with the service). Not built; until it is, a connector previews only public content.

## Gate

```
vitest (whole repository)               6 285 tests; 4 failures, all in code this work did not touch
                                        (markdown merge timing, emoji rendering, the reader bundle
                                        check, one merge-required journey), and the same 4 before it
… coverage over infrastructure/http, infrastructure/link-preview
                                        statements, branches, functions, lines 100%
                                        (the worker entry runs in a child process and is ignored by name)
@quill/domain (whole package)           246 tests; link-preview 100% on all four measures
tsc (server, domain)                    no errors in the new code
oxlint                                  no errors in the new code
```

The repository-wide `pnpm check` is red for reasons that predate this work (committed scratch files in `e2e/`, type errors in `packages/markdown`, lint in `packages/ui`).

## Addendum: step 5 (the organisation's settings, S10)

**Date:** 2026-10-17. **Scope:** `packages/application/src/settings/link-previews.ts`, `apps/server/src/application/link-settings.ts`, `apps/server/src/infrastructure/link-preview/audiences.ts`, `packages/application/src/use-cases/link-previews.ts`, the settings screen.

### S10. A restrictive policy must never show a preview fetched under a looser one (Medium, fixed)

The first design let an audience under a restrictive policy read the shared `public` scope as well as its own, on the reasoning that a preview fetched under the default policy is the same for everyone. It is not. A fetch under the default policy may have followed a redirect to a host a restrictive policy blocks (a page on an allowed host that redirects to a blocked one; the preview then describes the blocked host), or kept a thumbnail a `text`-only policy forbids, and the public site, which read the shared scope, would have drawn it for an organisation that had since turned previews off or restricted them.

Fixed, and held by tests across scopes (`use-cases/link-previews.test.ts`, `routes/link-settings.integration.test.ts`):
- **An audience reads only its own scope.** There is no fallback to `public` for a restrictive audience.
- **The public site and share links read the organisation's scope**, not the shared one: `forPublic` is the organisation's policy, or a policy that permits nothing when it has turned previews off there.
- **A fetch is stored under the scope of the policy in force when it ran**, not the scope written on the queued event, so a policy changed while a fetch waited cannot put a looser result in a stricter scope (or the reverse).
- **An unreadable settings file fails closed**: previews off everywhere, public site included.
- **A policy that does not compile fails closed** (previews off, in a scope of its own), as before; and the settings API refuses a pattern that does not parse, naming it, so a mistyped block entry is never silently skipped.

The integration test saves settings through the real API and fetches through the real audiences: a preview fetched under the loose policy is drawn for members and the public site; after the policy is tightened (text only, a block list, or off) neither draws it, a new fetch runs under the tighter policy and is stored where only that policy reads, and loosening again finds the earlier loose preview still there, fresh, with no new fetch.

### Other checks

- **Who may change it.** `PUT /api/settings/organisation` is instance administration (a test pins a `403` for an editor); reading it needs only a session, and it carries no secret.
- **Audit.** `settings.link_previews.changed` records the mode, the two switches and the number of patterns in each list, never a pattern; the revision beside it holds the whole before and after.
- **Input.** At most 500 patterns of at most 300 characters each, parsed by the grammar that has no regular expressions (no backtracking), unknown fields refused.
- **No new outbound path.** The settings change what the existing open-web client is asked to fetch; it adds no request of its own.
