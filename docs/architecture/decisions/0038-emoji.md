# ADR-038: Emoji shortcodes and custom emoji

**Status:** Accepted
**Date:** 2026-10-11
**Related:** ADR-047 (image pipeline: types, animation, stills), ADR-002 (Markdown is canonical), ADR-011 (security baseline, amended by this ADR), ADR-028 (themes), ADR-031 (render caching), ADR-034 (settings), ADR-036 (diagrams and reading blocks), ADR-037 (tenant labels), ADR-039 (Markdown extensions)

## Context

GitHub draws `:+1:` as 👍 and `:tada:` as 🎉, and documentation written for GitHub uses them; Quill showed the shortcode. Organisations also mark things their documents name often — partners, channels, teams — with a logo, for example leading each row of a comparison table with one. ADR-037 gave organisations named colours (`:acme[Acme]`), but not pictures.

The owner asked for both: GitHub's shortcodes, including the `:+1:` family, and an organisation's own emoji such as `:acme:` and `:globex_logo:`, so a table can show each partner's logo. They also asked that emoji come on top of labels, not instead of them: `:acme[Acme]` stays a label, and `:acme:` is an emoji.

## Decision

**Emoji are a declarative Markdown extension in ADR-039's sense.** One module, `packages/markdown/src/emoji/emoji.ts`, owns the syntax, the rendering (`emojiMarkup`, `emojiElement`), the sanitiser grant (`EMOJI_SANITIZE_GRANT`, `guardEmojiImages`) and the scan the editor draws from (`findShortcodes`). The editor binding is `packages/editor/src/document/emoji.ts`. Today they are wired by hand, like every built-in; when the registry lands, this module becomes one `MarkdownExtension` without a rewrite.

**The syntax is a name closed by a colon, and it is text.** `remark-directive` refuses a text directive whose name is followed by `:` (`afterName` in `micromark-extension-directive`), so `:smile:` reaches the tree as plain text, never as a directive. That makes the parsing problem small:

- The syntax decides, never the name. `:acme[Acme]` is a label (ADR-037), because it has a label in brackets. `:acme:` is an emoji, because it is a bare name closed by a colon. A label and an emoji may share a name, and documents may use both in one paragraph.
- `:+1:`, `:-1:`, `:100:` and `:1st_place_medal:` are not directive names either, and are found by the same text pass.
- The pass is `:([a-z0-9_+-]+)(?=:)`, scanned left to right. An unknown name does not consume the colon that closes it, so `:note:smile:` finds `:smile:`. Times (`10:30:00`), `a:b:c`, `status:ok` and URLs stay as written: either no name between colons is an emoji, or the colons belong to a directive or a link.
- Code is never touched: inline code and fenced code are not text nodes. An autolink's text is its address and is left alone; a link with words (`[ship it :tada:](…)`) draws its emoji.
- An emoji stays a text node whose value is its shortcode, carrying the element it is drawn as in `data`. The outline, heading slugs and search text therefore read what the author wrote. Directive round trips are unchanged.
- Saving writes shortcodes back byte for byte. `mdast-util-directive` escapes every `:` before a letter, which rewrote `:smile:` as `\:smile:` and `a:b:c` as `a\:b:c` on every save. `to-markdown-extensions.ts` removes that rule and escapes a colon only where it would open a directive when read back: before a name, unless the name is closed by a colon that is itself left bare. `:smile:c` still escapes both colons, because its closing colon opens `:c`. The corpus document `22-colons-and-emoji.md` is byte-identical through the editor, and a test re-parses every corpus line with a colon to the same tree.

**Standard shortcodes are GitHub's list, from `gemoji`.** `gemoji` (MIT, wooorm) is GitHub's own emoji data published as a package: 1,870 emoji and 1,913 names. It is a **development dependency** of `@quill/markdown` only. `pnpm --filter @quill/markdown generate:emoji` writes `src/emoji/shortcodes.gen.ts`, a table of one line per emoji (character, description, names), about 60 KB of text and 22 KB gzipped. A test regenerates it in memory and fails if the file is stale. Nothing of `gemoji` ships at runtime. The renderer imports the table on the server. The editor imports it lazily (`@quill/markdown/emoji-shortcodes`) the first time an editor opens. The reading route never loads it.

A standard emoji renders as `<span class="emoji" role="img" aria-label="thumbs up">👍</span>`, named by its description. An unknown name stays literal.

**Custom emoji are the organisation's settings, not its theme.** ADR-037 put labels in the theme because a label is identity. An emoji is vocabulary documents are written in. It also must survive the theme being replaced: choosing another built-in replaces the theme whole. So `OrganisationSettings.emoji` is an optional list (at most 100) of `{ name, hash, mediaType, still?, width, height }`:

- `name` is the label's shape with `_`: `^[a-z][a-z0-9_-]{0,31}$`. It is held to the renderer's `EMOJI_NAME` by a test in the server. Two emoji may not share a name.
- `hash` is the SHA-256 of the image in the blob store. `mediaType` is PNG, JPEG, GIF, WebP, AVIF or SVG, decided by the bytes (ADR-011; amended below). `still` is the hash of an animation's first frame, when one could be cut (amended below). `width` and `height` are the image's own size, for its proportions.
- The settings file holds no bytes (ADR-034). The field is optional, so every file written before it reads unchanged (AGENTS.md rule 17).

They are edited in **Settings → Labels and emoji** (`/admin/settings/labels`), beside the labels that lead with them, and saved with that page; the screen was split out of Theme on 2026-10-11 (amended below). There, each emoji is previewed at text size in a neutral sentence, in light and in dark.

**An image is uploaded, then named.** `POST /api/settings/organisation/emoji-images` (instance administration, 256 KB cap) stores the image and answers with its hash. A raster's metadata is stripped on the way in, as an attachment's is. The image is published only when the settings that name it are saved.

**Served same-origin, immutable, and only when named.** `GET /api/emoji/<name>.<16 hex of hash>.<ext>` serves an image that the saved settings list, to anybody, under the public site's rate budget. Emoji appear on public pages and share links, which have no session, as the theme's fonts do. The address changes when the bytes do, so the answer is `public, max-age=31536000, immutable`. A hash alone never reads a blob: the blob store is shared with attachments.

**Rendering.** `RenderInput` gains `emoji` (name to address and size) and `labelEmoji` (label name to emoji name). A custom emoji renders as `<img class="emoji" src="/api/emoji/…" alt=":acme:" title=":acme:" width height>`, declared 20 pixels high in proportion. The reading stylesheet sets it at `1.2em` on the text's baseline. **A custom name wins over a GitHub name only where the two collide**; every other GitHub name keeps working. Both inputs join the render cache key (ADR-031), sorted, and only when non-empty, so bodies rendered before emoji keep their keys. Each custom emoji is keyed by name and address, so replacing an image re-renders the bodies. `RENDER_VERSION` is 5, because standard shortcodes change existing output.

**Labels lead with an emoji.** A label (ADR-037) gains an optional `emoji` field naming the emoji its pill leads with: a custom emoji's name or one of GitHub's. Absent, the pill leads with the organisation's custom emoji **of the label's own name**, when there is one. So defining `:acme:` beside the `acme` label is enough, and `globex` can name `globex_logo`. The emoji takes the colour dot's place: `<span class="badge" data-label="acme"><img class="emoji" … alt="">Acme</span>`. It is decorative (`alt=""`, or `aria-hidden` for a character) because the label's words already say what it is. The explicit field was chosen over name-matching alone because label names cannot contain `_`, and a channel's label and its logo are not always spelled alike.

**The sanitiser.** The emoji grant admits `span.emoji` with `role="img"`, `aria-label` or `aria-hidden="true"`, and `img.emoji`. The schema cannot tie one attribute's value to another's. So after sanitising, `guardEmojiImages` removes the `emoji` class from any image whose `src` is not an emoji address (`EMOJI_ASSET_URL`). Only the renderer emits the class, because an author's raw HTML is escaped long before.

**The editor draws emoji with decorations, as the unknown-label warning does.** Nothing is written into the document. Each shortcode's text is hidden behind its emoji and shows again while the selection touches it, so it can be edited as text. A label's leading emoji is drawn inside its pill. Custom emoji come from the theme summary (`GET /api/settings/organisation/theme` gains `emoji` and `labelEmoji`), which the edit route already loads.

**ADR-011 amendment.** An emoji image may be `image/svg+xml`, and unlike an SVG attachment it is served as an image, because it is only ever shown through `<img>`, where an SVG runs no script and loads nothing. Anybody who opens its address directly gets it behind `Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox` and `X-Content-Type-Options: nosniff`. The sandbox gives it an opaque origin with no script, so it is never a document on Quill's origin.

## Alternatives considered

- **Handle `:smile:` as a labelless directive followed by `:`.** That is how an older `remark-directive` parsed it. The current one refuses the directive, and a corpus test pins that, so a text pass is the whole of the parsing. If an upgrade changes it, the test fails before any document does.
- **Ship `gemoji` at runtime, or `node-emoji`.** 350 KB of JavaScript (tags, categories, skin tones) to answer one lookup. The generated table keeps what rendering needs.
- **Custom emoji in the theme.** One document, like labels, but a theme reset would delete a vocabulary documents depend on, and the theme doctor has nothing to say about pictures.
- **Custom emoji as document attachments.** An emoji belongs to the organisation and is used across workspaces and on the public site. An attachment is authorised against one document.
- **Inline `data:` images in the rendered body.** No route to serve, but every body would carry every logo it shows, the cache would hold the bytes many times over, and the sanitiser deliberately refuses `data:image/svg+xml`.
- **Name-matching only between labels and emoji.** Simpler, but `globex` and `globex_logo` cannot match, and label names cannot contain `_`.

## Consequences

- Documents written for GitHub show their emoji, and a table of partners can show each one's logo in its label.
- The reading route pays nothing for standard emoji: they render on the server, as characters. The editor chunk pays nothing either: the 22 KB table arrives as its own lazy chunk when an editor opens.
- The theme summary and `RenderInput` each grow two fields, the organisation settings one optional field and a label one optional field. All are additive (rule 17).
- Emoji images are uploaded once and never garbage-collected when an emoji is removed. The blob store's collection (M4 export work) has to treat an emoji hash as a reference.
- A tenant's custom name can shadow a GitHub name for that tenant only. Search, the outline and a heading's anchor still read the shortcode.

## Amendment, 2026-10-11: more image types, animation, and a screen of its own

**A screen of its own.** Labels and emoji moved out of Settings → Theme into **Settings → Labels and emoji**, listed after Theme. Labels stay in the theme document (ADR-037): the new screen edits that part of the theme with the same draft, revision and conflict handling as Theme, and the first label added forks a built-in exactly as a lever on Theme does. The theme doctor stays on Theme and still checks every label.

**Every image the web draws.** An emoji may be PNG, JPEG, GIF, WebP, AVIF or SVG, still sniffed from its bytes and refused when the bytes and the declared type disagree. SVG remains the way to upload a real logo as the vector a brand guide ships; Quill's development data uses placeholder shapes only because it does not copy trademarks. JPEG is served as `.jpg`.

**Animation, to ADR-047's shape.** GIF, APNG, animated WebP and AVIF sequences are accepted within ADR-047's limits: at most 300 frames, at most 10 seconds, at most 256 KiB. Past them the upload is refused with the frame count and the running time. They are read from the container without a codec (`packages/application/src/use-cases/animation.ts`):

- For a **GIF** and an **APNG**, a still of the first frame is cut from the container at upload (the first image block; the PNG without its animation chunks), stored as a blob of its own and recorded as `still`. It is served beside the animation at `/api/emoji/<name>.<16 hex of the still's hash>.<ext>`, only while a saved emoji names it.
- An **animated WebP** or **AVIF sequence** has no still yet: cutting one needs a codec, which ADR-047's image pipeline brings. Until then it is shown as uploaded. An AVIF sequence whose metadata cannot be taken out without re-encoding it (track-level `udta` or `meta`, or items whose removal would move its samples) is refused with that reason.

An emoji with a still renders through `<picture class="emoji">` whose one `<source media="(prefers-reduced-motion: reduce)" srcset="…still…">` offers the still to readers who ask for less motion, with the animation as the `<img>` — the shape ADR-047's variants will fill in with more sources. The editor and the settings previews draw the same markup; the settings preview shows an animation moving and still, labelled. The sanitiser admits `picture.emoji` and a `source` whose `srcset` is an emoji address and whose `media` is that query, replacing the default schema's `source: ['srcSet']`, which admitted any address.

**Left for ADR-047.** Modern-format variants, stills for animated WebP and AVIF, and collection of unused emoji images are the image pipeline's.
