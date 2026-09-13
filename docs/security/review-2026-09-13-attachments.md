# Security review: attachments (2026-09-13)

The upload, storage and serving path added in M2 (`POST /api/documents/:id/attachments`, `GET /api/attachments/:id`, `DELETE /api/attachments/:id`), reviewed against ADR-011 and `docs/security/checklist.md`.

Scope: `packages/application/src/use-cases/attachments.ts`, `media-types.ts`, `image-metadata.ts`, `image-metadata-avif.ts`, `image-container.ts`; `apps/server/src/routes/attachments.ts`, `content-disposition.ts`, `infrastructure/blob/`; the editor's image dialog and the document's attachments panel.

## What the path does

| Stage | Control |
| --- | --- |
| Arrival | `@fastify/multipart`, one file, the cap plus one byte, the field name `file` enforced |
| Size | Counted as the bytes arrive; the upload is abandoned at the byte that crosses `ATTACHMENT_MAX_BYTES`, which is itself capped at 256 MiB |
| Type | Sniffed from the first 512 bytes; an allowlist of PNG, JPEG, GIF, WebP, AVIF and PDF; the declared type must match what the bytes say |
| Content | PNG, JPEG, GIF, WebP and AVIF walked at the container level and stored without their metadata, before the hash; an unreadable container refused |
| Naming | Control characters, separators and leading dots removed; truncated by code point; never used as a path |
| Storage | Content-addressed by SHA-256 of the stored bytes; filesystem writes through a temporary file and renames |
| Authorisation | `edit` to upload or delete, `view` to read, all through the one resolver against the owning document |
| Serving | Sniffed `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; …; sandbox`, RFC 6266 `Content-Disposition`, `private, max-age=300, must-revalidate` |
| Abuse | 60 uploads per person per minute, flat, consumed only by accepted uploads; audit rows on upload and delete |

## Deviations from ADR-011, and what compensates for them

### 1. SVG is refused rather than sanitised

**The clause said:** "SVG sanitised".

**What is built:** an SVG upload is refused with `422 file_type_not_allowed`, `details.sniffed` of `image/svg+xml`, and a message that says an SVG is a document that can carry scripts and suggests exporting a PNG. SVG is recognised by shape (a prologue then `<svg`) rather than dropped as unknown, precisely so the refusal can explain itself.

**Why:** sanitising an SVG is a bet that an allowlist covers every element, attribute and parser difference between the sanitiser and every browser, for a format whose purpose is to be a document. The renderer already declines that bet — `sanitize-schema.ts` excludes `image/svg+xml` from the `data:` image types it admits — and accepting one on upload would make the same bet in a worse place, because the file is then served from this origin under a session.

**Compensating controls:** none are needed for the refused case; refusing is the stronger position.

**Residual risk:** this is *narrower* than the ADR asked for, and the cost falls on authors: vector drawings cannot be attached. If that becomes a real need the answer is a sanitiser reviewed on its own terms, with its own threat model — not a widened allowlist.

### 2. Images are not re-encoded; they are stripped at the container level

**The clause said:** "images re-encoded".

**What is built:** each format is walked at the level of its container — PNG chunks, JPEG segments, GIF blocks, WebP chunks, AVIF items — and only the parts a decoder needs to show the picture are kept: pixels, palette, colour profile, transparency, dimensions, animation control and frames. EXIF, XMP, IPTC, comments, text and time stamps are dropped, and so is anything following the end-of-image marker, which is where a second file hides when one is hidden. Nothing is decoded. The walk runs **before the hash**, so the content address is the address of what is served and the same photograph uploaded with and without its metadata is one object. A picture whose container cannot be read is refused with `422 file_malformed` rather than stored unread.

**Why:** the full analysis — the three risks re-encoding addresses, which of them the rest of this path already covers, and why running a decoder on the server moves the decoder risk rather than removing it — is in ADR-011's amendment of 2026-09-13. It is the decision record; this review does not restate it.

**Compensating controls:** sniffing on the allowlist; `nosniff`; the sandboxing CSP; `Content-Disposition` by sniffed type; a blob store that executes nothing; the size cap. A polyglot upload and its serving headers are held by a test (`attachments.integration.test.ts`, "a file that is two things at once").

**Residual risks, stated plainly:**

- **The walkers are parsers of untrusted input**, which is attack surface of its own. They are bounds-checked TypeScript over framed formats with no decoder behind them, they run in the process that already parses the multipart body, and `image-metadata.test.ts` drives them through every chunking, truncation and overrun its author could think of. A file they cannot read is refused, never guessed at.
- **A malformed file is not stored at all**, which is a change in behaviour rather than a risk: a picture a browser would have rendered but the walker cannot frame is now refused. The refusal names the format and what stopped the reader.
- **A decoder bug in the reader's own browser is not addressed by anything here**, and would not have been by re-encoding either — the renderer already admits `data:image/*` URIs, so anyone who can edit a document can hand a reader's decoder arbitrary bytes without an upload at all.

**When to revisit:** ADR-011's amendment names the triggers — a server-side decoder adopted for another reason, a format added that cannot be walked, or the sanitiser ceasing to admit `data:` images.

## Checklist findings

- **Content-Disposition was not RFC 6266.** A filename in any non-ASCII script would have reached the header as raw bytes. Now both parameters are emitted always — an ASCII fallback with the quote, backslash and semicolon removed, and `filename*=UTF-8''…` — and the header is proved across a real socket with a CJK name and an emoji name, because a `Buffer` will hold a header a wire will not.
- **Filename truncation could split a surrogate pair**, leaving a lone surrogate that `encodeURIComponent` refuses. Truncation is by code point.
- **The in-use check was instance-wide.** A document in a workspace the caller cannot see could block a delete and be named in the refusal. It is scoped to the attachment's own workspace by a join, and the refusal names only documents the caller may `view`, with a count of the rest.
- **Caching was immutable for a year.** The bytes behind an id never change, but the permission to see them does; a withdrawn reader would have kept a cached copy for a year. Now `private, max-age=300, must-revalidate` with the hash as the `ETag`, and the conditional is answered **after** the authorizer runs, so a reader whose grant has gone gets the refusal rather than a `304`.
- **Uploads shared the auth rate limiter's backoff.** Uploading a picture is ordinary work; a budget that doubles while somebody adds screenshots to a runbook is a penalty for working. Uploads now have a flat budget of their own, spent only by accepted uploads.

## Not in scope

- Share links and the public principal reaching `GET /api/attachments/:id` (M3, ADR-012). The route already authorises through the one resolver, so there is no second answer for them to disagree with.
- Export rewriting `/api/attachments/<id>` into a bundle (M4), tagged in `attachments.ts`.
- Collecting blob-store objects that no live attachment points at. Nothing removes an object today, which is the safe direction (ADR-034); a sweep is a separate decision with its own review.
