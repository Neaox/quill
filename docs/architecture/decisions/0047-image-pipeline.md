# ADR-047: Image pipeline and format negotiation

**Status:** Accepted
**Date:** 2026-10-11
**Related:** ADR-011 (security baseline: uploads, metadata stripping), ADR-031 (render caching), ADR-036 (diagrams), ADR-038 (emoji), ADR-042 (link previews), ADR-043 (Figma and draw.io), quill-plan.md section 31 (performance budgets)

## Context

Quill serves images from several places:
- attachments in documents;
- custom emoji;
- organisation logos;
- link-preview thumbnails and favicons;
- Figma snapshots;
- Open Graph images for the public site.

Today each is stored and served exactly as uploaded, after its metadata is stripped at the container level (`image-metadata.ts`). There is no image codec on the server.

The owner wants:
- **animated GIFs** for emoji;
- the **best format for each browser**: AVIF or WebP, chosen from the original and from what the browser accepts, using content negotiation;
- this for **every** image, not just emoji.

Animation also has to respect readers who ask for reduced motion.

## Decision

### Keep the original; derive variants

**The original.** Every raster upload is kept as its original, stripped of metadata as today. It is never modified and is always servable.

**Variants.** A **variant job** (an outbox consumer, plan section 22) derives variants after upload. Upload never waits for them, and the original is served until they exist.
- **Formats:**
  - AVIF and WebP for everything;
  - a PNG or JPEG baseline if the original is in neither, for example an AVIF upload.
- **Sizes:** the original's size, plus widths from a fixed ladder (320, 640, 960, 1280, 1920, 2560, never upscaled) for images shown large. Emoji get 1×, 2× and 3× of their display size.
- **Animation:** preserved as animated AVIF and animated WebP. Every animated image also gets a **still** variant (its first frame, or a chosen poster frame) in every format.
- **Quality:** a format is kept for an image only if it is smaller than the next format down at comparable perceptual quality (measured with SSIMULACRA2 or butteraugli on a sample, with fixed per-format targets). A format that doesn't win is not stored. This avoids serving AVIF that is larger than the WebP.

**SVG** is never rasterised for display. It stays SVG, served as an image (ADR-036, ADR-038). A raster fallback is generated only where SVG is not accepted, for example Open Graph images.

Variants are addressed by **content hash and parameters** (`/i/<hash>/<width>.<format>`) and served `immutable`.

### Choosing the format: `<picture>` first, `Accept` second

**Where Quill writes the markup** (the reader, the public site, the editor, emoji), it uses `<picture>`:

```html
<picture>
  <source media="(prefers-reduced-motion: reduce)" type="image/avif" srcset="…/still.avif">
  <source media="(prefers-reduced-motion: reduce)" type="image/webp" srcset="…/still.webp">
  <source type="image/avif" srcset="… 640w, … 1280w" sizes="…">
  <source type="image/webp" srcset="… 640w, … 1280w" sizes="…">
  <img src="…/original" alt="…" width="…" height="…" loading="lazy" decoding="async">
</picture>
```

- **Why `<picture>`:** it is the only way to honour **reduced motion**. `Accept` can't carry it, and a media query can.
- **Caching:** every URL it uses is immutable, with no `Vary` (see "Caching, including under negotiation").
- **Layout:** `width` and `height` are always set, so nothing shifts.
- **Freshness:** the renderer reads the variant manifest for each image, as it reads drawings (ADR-036). The manifest's hash joins the render cache key, so a body re-renders once when its images' variants finish. Until then it shows the original.

**Where Quill can't write the markup**, it negotiates. This covers Open Graph images, an image URL pasted elsewhere, API clients and email. The **canonical address** of an image (`/i/<hash>`) chooses the best format from the request's `Accept` header:
- the order is AVIF, WebP, then the baseline, restricted to formats this image actually has;
- the response is cached as described under "Caching, including under negotiation";
- the variant URLs it chooses from stay immutable.

`Save image as` gets a sensible format either way.

### Caching, including under negotiation

Negotiation is only worth having if it caches well, and `Vary: Accept` caches badly when done naively: a cache keyed on the raw `Accept` string stores one copy per browser version. So:

- **Variant URLs are the unit of caching.** `/i/<hash>/<width>.<format>` never changes for its content, so it is served with:
  - `Cache-Control: public, max-age=31536000, immutable`;
  - a strong `ETag` (the variant's hash);
  - `Content-Type` and `nosniff`.

  Browsers, CDNs and the server's own blob reads all cache it forever. Every `<picture>` source points at these, so most image traffic never touches negotiation.
- **Negotiation is on a normalised key.** At the canonical address, the server maps `Accept` to one of a few **format buckets** (`avif`, `webp`, `base`), restricted to the formats this image has. The answer is a pure function of (image hash, bucket), memoised in-process and computed without touching image bytes.
- **The negotiated response is cache-friendly too.**
  - It carries `Vary: Accept`, `Content-Location` set to the immutable variant URL it chose, the variant's `ETag`, and `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`.
  - A day is enough to absorb repeat requests, and short enough that a newly finished, better variant reaches people.
  - Conditional requests get `304`.
- **For CDNs and reverse proxies,** the operations guide documents normalising `Accept` into the same buckets at the edge, so the edge caches a handful of copies per image rather than one per user agent. Examples: a Cloudflare cache rule, Fastly VCL, an nginx `map`, a Caddy matcher.
- **Where an edge cannot normalise,** a setting switches the canonical address to **redirect mode**. It answers `302` to the chosen immutable variant URL, with `Cache-Control: private, max-age=86400` and `Vary: Accept`. The image bytes are then only ever cached under immutable URLs, at the cost of one extra round trip.
- **Before variants exist,** the canonical address serves the original with `Cache-Control: public, max-age=60`. It is upgraded to the long policy once the manifest is complete, so a cache never pins the unoptimised original for a day.
- **Server side,** the variant manifest is cached with the render cache (ADR-031), keyed by image hash. Variant bytes are read from the blob store through the existing streaming path, never buffered whole.

### Codecs, run safely

**Decoding untrusted images is a known attack surface.**
- **Isolated decoding:** the variant job decodes and encodes in a **separate worker process** with a memory cap and a time limit. A codec crash kills that job, never the server.
- **Input limits:** pixel area, frame count, animation duration, and declared-versus-actual dimensions.
- **Retries:** a failure is recorded and the original keeps being served; a failure is never retried in a loop.

**The library is `sharp` (libvips).** This is a new runtime dependency of the server, justified here (AGENTS.md rule 11). It:
- covers AVIF, WebP, JPEG, PNG and GIF, including animation;
- is the de facto Node standard;
- is fast, and prebuilt for the platforms we ship.

**JPEG XL is out of scope.** Browser support has stalled: only Safari decodes it, and Chrome removed it. The bucket model adds a format without touching the markup or the URL scheme, so it can be revisited if support returns.

The existing pure-TypeScript metadata stripping stays as the first step on upload: the original is kept stripped, before any codec sees it.

### Animation: brief, stoppable, and never for those who ask for none

This applies to every animated image Quill shows: emoji, GIF attachments, animated logos.

- **Reduced motion.** Readers who prefer reduced motion (`prefers-reduced-motion: reduce`) never see an animation. They get the still, through `<picture>`'s media source. No script is needed, so it holds without JavaScript.
- **Everyone else: play briefly, then rest.**
  - An animated image plays when it first comes into view, for **at most 5 seconds or 3 loops, whichever is shorter**. It then rests on its still. This meets WCAG 2.2.2 (Pause, Stop, Hide), which applies to anything moving for longer than 5 seconds alongside other content.
  - It plays again on hover, on keyboard focus of its container, or on tap. Each replay has the same limit.
  - It is paused while off-screen (IntersectionObserver) and while the page is hidden.
  - This is done by the reader's enhancer, swapping the `<picture>` between the animated source and the still. Loop length and frame count are recorded at upload, so the timer needs no decoding in the browser. Without JavaScript the browser plays the animation as the file says, and reduced motion still gives the still.
- **Bounded in the file too.** Every animated variant the pipeline writes has a **finite loop count** encoded in the format's own field, so it stops even with no script running (the public site with JavaScript off, an image opened on its own, email). The fields are:
  - GIF: the `NETSCAPE2.0` application extension (0 means forever, so it is rewritten to 3);
  - APNG: `acTL.num_plays`;
  - animated WebP: the `ANIM` loop count;
  - AVIF sequences: the repetition count, where browsers honour it.

  The original stays untouched. Browsers stop such a file on its *last* frame, which is why the script still swaps to the poster still: the file's own count is only the safety net.
- **Large animations become video.** An animated attachment over 1 MiB, or over 300 frames, also gets a muted H.264 or AV1 `<video>` variant: `muted playsinline`, a `poster` set to the still, the loop count enforced with the `ended` event, played and paused by the same rules. This is the Twitter/Giphy approach. It is typically 5–10× smaller than the GIF and fully controllable. Emoji stay images.
- **The resting frame is the still: a poster frame, never the last frame.**
  - It defaults to the first frame. The uploader can choose another in the upload preview, for an animation whose first frame is blank or unrepresentative.
  - It is the same still that reduced-motion readers see, so everyone shares one resting picture and nothing jumps.
  - The last frame is not used: loops commonly end on a fade, a blank or mid-motion.
- **A personal setting.** "Animated images: play briefly (default) · play on hover only · never". It is stored with the person's settings and applied by the same enhancer. Reduced motion always wins.
- **The editor** follows the same rules, so writing next to an animated emoji is not distracting.

### Animated emoji (ADR-038)

GIF, APNG, animated WebP and animated AVIF emoji are accepted.
- **Rendering:** they render through `<picture>` with the brief-play rules above.
- **Previews:** the settings preview shows the animation playing and its still, labelled, with the poster-frame choice.
- **Limits:** at most 300 frames, 10 seconds and 256 KiB. Over the limit, the upload is refused with the reason.
- **Stills:** GIF and APNG stills are cut without a codec at upload today. Animated WebP and AVIF get theirs from the pipeline.

### Budgets and storage

- Variants are bounded per image by the ladder, and per organisation by a storage quota that settings show.
- When an image is purged with its document (ADR-046) or replaced, its variants go with it. A periodic job collects variants no image references any more. This also closes ADR-038's "emoji images never collected" gap.
- **Performance:** the reading route's image bytes are reported in `pnpm check:bundle`'s page-weight check for the corpus pages, and must go down, not up, once this ships.

## Alternatives considered

- **Content negotiation only, with one URL per image.** Simple markup, but it can't honour reduced motion and needs `Vary: Accept`, which many caches handle poorly. Kept for contexts where markup is not ours.
- **Transcode on request, then cache.** It puts a codec on the request path for untrusted input, which is slow, a denial-of-service lever, and a crash risk. Variants are made off the request path, in an isolated worker.
- **A hosted image service.** It sends every image to a third party, which a self-hosted product can't do by default. It could be an optional provider later.
- **WASM codecs only.** No native dependency, but several times slower for AVIF encoding.
- **JPEG XL.** Smaller files than AVIF at some qualities, but too little browser support to be worth a third encode per image. Revisit if support returns.

## Consequences

- One pipeline serves every image surface. Emoji, attachments, previews and snapshots all get modern formats, responsive sizes and reduced-motion stills.
- It adds a native dependency (sharp) and a worker process to the deployment, which the operations docs must cover (container image, health and resource limits).
- The renderer gains a variant manifest input, and the cache key gains its hash.
- The security checklist gains image decoding in isolation, with limits.

## Delivery

1. The variant job, the worker isolation and limits, and the manifest; AVIF and WebP; the stills for animated images.
2. `<picture>` in the renderer, the public site and emoji, the brief-play enhancer, the poster-frame choice and the personal animation setting. Animated emoji go live here.
3. Content negotiation at canonical image addresses, with format buckets, `Content-Location`, conditional requests, redirect mode, and the operations guide's edge configurations.
4. Responsive widths for large images; storage quota and collection.
