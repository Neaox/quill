# Documentation design survey: what reads as sleek, and three Quill base themes

**Question.** What do the best documentation and long-form reading sites do, measured rather than remembered, and what exact parameters should Quill's three base themes use to reach that bar?

**Method.** On 2026-10-11 we opened each site in a browser at 1440 × 900 (desktop) and 375 × 812 (mobile), in light and dark where the site offers both. We read computed styles with a script over the live DOM: font stacks, sizes, line heights, weights, tracking, colours, borders, radii, shadows, and the current item in the sidebar and table of contents. We took screenshots where layout mattered. Values are rounded. Colours are reported as the site serves them.

**The bar.** The owner ranked the references, best first:

1. lockstay's portal
2. Linear
3. Fumadocs
4. PlanetScale
5. Vercel
6. Raycast and Stripe, as secondary references

Docusaurus, Starlight and Furo (Read the Docs) are **counter-examples**: popular, but generic. The recommendations are judged against the top tier only. Popularity is not evidence of quality.

---

## One-page summary

**What the best share**

1. **One sans family carries the whole interface, and type size does the work.** lockstay uses Figtree, Linear and Raycast use Inter, Fumadocs and Vercel use Geist, and PlanetScale uses Inter. None of the top five uses monospace or uppercase for chrome. Hierarchy comes from size, weight (510 to 650, rarely 700) and ink level, not from changing typeface.
2. **The interface is small and the prose is a step larger.** Navigation and the table of contents sit at 13 to 14 px. Body text is 15 to 16 px with line heights of 24 to 28 px. The lede is 17 to 18 px. Headings are modest: h1 is 28 to 36 px and h2 is 21 to 24 px, with negative tracking of about −0.02 em on h1 and −0.005 to −0.01 em on h2.
3. **Three or four ink levels, each with a job.** Linear defines exactly four (`#f7f8f8`, `#d0d6e0`, `#8a8f98`, `#62666d`). lockstay defines three (`ink`, `ink-2`, `ink-3`). Body text is the second level, not the strongest: headings are the only text at full ink. This one decision makes a page feel calm.
4. **Surfaces barely differ, and hairlines draw the edges.** The page, sidebar and cards differ by 1 to 4 % of lightness. Borders are 1 px at very low contrast, about 1.2 to 1.5:1 against the page, often drawn as alpha (`#6663`, `rgba(255,255,255,.06)`, `oklab(... / .1)`). There are almost no shadows at rest. In dark mode, depth comes from a lighter surface plus a hairline, never from a shadow.
5. **Accent is scarce, and you can tell it is deliberate.** It appears on the current item (tinted wash plus accent or ink text), the active table-of-contents entry, link underlines, focus rings, one eyebrow, and the callout bar. It never fills toolbar buttons, never colours headings, and never colours body links in bulk.
6. **The current item is a soft wash, not a slab.** Examples:
   - lockstay: `oklch(0.96 0.03 190)` in light and `oklch(0.30 0.05 190)` in dark, with weight 600 and a 6 px radius.
   - Fumadocs: accent at 10 % alpha with accent text.
   - Vercel: `#1f1f1f`, with no accent at all.

   Counter-example: Starlight fills the current item with solid accent and white text, which reads as a default.
7. **The table of contents is quiet: 13 px, third ink level, and a thin rail.** The active entry gets ink or accent colour. Fumadocs and PlanetScale draw the rail as a 1 px line, and Fumadocs bends it to show nesting. The "On this page" label is a normal-case 13 to 14 px label in ink-3 or ink. Nobody admired uses uppercase there except Tailwind.
8. **Code and callouts are cards with large radii.** Code blocks use 12 to 16 px radii (Fumadocs 12, PlanetScale and Resend 16, Clerk figure 16, Apple 15) on a surface one step off the page, with a 1 px hairline and a 13 to 14 px mono.

   Callouts are tinted or neutral cards. lockstay draws the tone as a 3 px *inset shadow bar* plus a 1 px inset ring. Fumadocs uses a 2 px rounded bar inside a neutral card. PlanetScale and Raycast use a 10 to 20 % tint with a matching 1 px border. Nobody admired uses a 4 to 5 px solid left border with a drop shadow, which is what Docusaurus does.
9. **The header is short and translucent where it is sticky.** It is 52 to 64 px tall. lockstay uses `page / 0.88` with `blur(10px)` and a hairline bottom border. Linear and Vercel use an opaque page colour with a hairline.
10. **Links carry the accent in the underline, not in the text.** Fumadocs, GitBook and Linear keep ink-coloured text with a coloured or low-contrast underline: Fumadocs uses a 1.5 px underline at a 3.5 px offset, and Linear uses `#62666d` at a 2.6 px offset. lockstay uses an ink-3 underline. On a page dense with links, this keeps the prose calm.

**Verdicts on Quill's current default theme**

| Current choice | Survey says | Evidence |
| --- | --- | --- |
| Monospace uppercase labels throughout the chrome | **Argues against.** | Not one of lockstay, Linear, Fumadocs, PlanetScale or Vercel does it. Tailwind uses 12 px Plex Mono uppercase with +0.1 em tracking, but only for sidebar section heads, the table-of-contents title and the page eyebrow, and Tailwind's whole brand is code. lockstay uses *one* sans uppercase eyebrow per page (13 px, 600, +0.08 em, in the accent ink) and a sans uppercase callout title. If Quill keeps one, keep it to the page eyebrow in Theme A and use it as a system signature only in Theme C. |
| Serif body face | **Argues against for the default; supports it for an editorial theme.** | Every top-tier documentation site sets body text in sans. Serif body text is where long-form reading lives: Increment sets Tiempos Text at 18 / 31.5. The Claude Platform docs go the other way, with serif headings over sans body. So serif belongs in Theme B, not in the default. |
| Filled orange primary button in the toolbar | **Argues against.** | The top tier keeps chrome monochrome. Vercel's only filled button is ink-on-page (`#171717`, "Sign up"), and Linear's is a light neutral pill. Accent fill is reserved for the one primary action in a dialog or form, never for persistent toolbar chrome. Orange can survive as Quill's *signal* hue (see Theme C), used for indicators, not fills. |
| "#" hashes before h2 | **Argues against.** | Linear, Fumadocs, Vercel, PlanetScale and lockstay all hide the anchor until hover or focus, or show a small icon after the heading. Furo's always-visible pilcrows and Docusaurus's hash anchors are among the things that make those sites read as generic. Reveal a link icon *after* the heading on `:hover` and `:focus-visible`, in ink-3. |

**Three base themes**

| Theme | Faces | Feel | References |
| --- | --- | --- | --- |
| **A. Calm** (default) | Inter Variable + JetBrains Mono | Cool, tinted neutral; quiet chrome; wash-style current item | lockstay, Linear, Fumadocs, PlanetScale |
| **B. Editorial** | Source Serif 4 (optical sizes) for prose and headings; Inter for chrome; JetBrains Mono | Warm paper, 18 px serif at a 66-character measure, accent in the underlines | Increment, Claude Platform docs, Apple's abstract |
| **C. Grid** | Geist + Geist Mono | Pure neutral, true-black dark mode, hairline grid, 4 to 8 px radii, mono labels as the signature, orange as the signal hue | Vercel, Fumadocs on Better Auth, Tailwind's hairline grid |

Theme C fills the gap the survey exposes. A and B are both soft reading themes. Nothing in the set serves dense reference material (API pages, runbooks, specifications, wide tables), or the organisation that wants a stark, engineered identity. The sites that do this best (Vercel, Better Auth, Tailwind) share a vocabulary: zero-chroma greys, alpha hairlines, small radii, and monospace used *structurally*. That is also the only honest home for the monospace labels Quill already has.

---

## Per-site notes

### Top tier

#### lockstay portal

Studied: <http://localhost:4320/overview/sync-map.html>, desktop and mobile, light and dark.

| Aspect | Observed |
| --- | --- |
| Faces | Figtree Variable → Figtree → `ui-sans-serif`, `system-ui`. Mono: `ui-monospace`, "SF Mono", Consolas. |
| Body | 15 / 24 in `ink-2`. Lede 17 / 27.2 in `ink-2`. Measure 736 px, about 85 to 90 characters (wide, but it reads well at 15 px). |
| Headings | h1: 34 / 40, weight 700, −0.68 px (−0.02 em), `ink`. h2: 21 / 27, weight 650, −0.005 em, 48 px above. |
| Eyebrow | 13 / 18, weight 600, +0.08 em, uppercase, in the accent ink: light `oklch(0.40 0.08 190)`, dark `oklch(0.84 0.08 190)`. One per page. |
| Ink, light | `ink oklch(0.22 0.02 220)` 15.9:1 · `ink-2 0.38` 9.2:1 · `ink-3 0.52` 5.1:1, all against `page oklch(0.972 0.005 200)`. |
| Ink, dark | `ink oklch(0.97 0.005 200)` 16.9:1 · `ink-2 0.83` 11.0:1 · `ink-3 0.69` 6.7:1, all against `page oklch(0.19 0.01 220)`. |
| Surfaces | Light: `page 0.972`, `surface #fff`, `surface-2 0.985`, `well 0.94`, `rule 0.94`, `edge 0.90`, and a separate `edge-control` for inputs. Dark: `page 0.19`, `surface 0.23`, `surface-2 0.215`, `well 0.20`, `rule 0.29`, `edge 0.34`, `edge-control 0.44`. |
| Accent | A brand hue variable (`--brand-h: 190`). Chroma is automatically capped at 0.05 for hues 13–85, 145–175 and 315–345, so a garish brand colour cannot spoil the palette. The accent lightness is 0.43 in light and 0.78 in dark. |
| Navigation | 264 px wide. Sections are `<details>` with 13 px / 600 summaries and **counts** in `ink-3` ("Overview 5"). Items are 13 / 17.55 with 4 × 8 padding and a 6 px radius. The current item is an accent wash (`oklch(0.96 0.03 190)` light, `0.30 0.05 190` dark) with ink text at weight 600. No borders. |
| Table of contents | 220 px wide. Title "On this page" at 13 px / 600 in `ink`. Links at 13 px in `ink-3` with 3 px vertical padding. |
| Header | Sticky, 62 px, `page / 0.88` with `backdrop-filter: blur(10px)`, hairline `rule` bottom border. The theme switch is a segmented control (System, Light, Dark). |
| Code, tables, figures | The table sits in a `surface` card with a 12 px radius and a 1 px `rule` border. Header cells are 13 px / 500 in `ink-3` on `surface-2`. Rows are 13.5 px with 9 × 12 padding. Figures are the same card at a 12 px radius, with captions at 13 / 19.5 in `ink-3`. |
| Callouts | A `surface` card with a 10 px radius. The tone is drawn as a **3 px inset box-shadow bar** plus a 1 px inset ring, so there are no border-width layout shifts. The title is 13 px / 600 uppercase with +0.06 em tracking in the accent ink. |
| Badges | Pill (`999px`), 12 / 14, weight 600, 3 × 8 padding, on a tone wash: `ok-bg` with `ok-ink`. |
| Shadows | Light: `panel` is three layers (0 1 2 at 5 %, a 1 px ring at 6 %, 0 8 24 −12 at 12 %). Dark: shadows become a 1 px ring plus a deep, soft drop. |
| Mobile | The navigation collapses to a "Documents" sheet above the title. The eyebrow, h1 and lede stack tightly. |
| Exceptional | Tokens named for their role (`ink-2`, `well`, `edge-control`), the chroma guard, counts in the navigation, the inset-bar callout, and restraint throughout. |
| Dated | Nothing. |

#### Linear docs and changelog

Studied: <https://linear.app/docs/conceptual-model> and <https://linear.app/changelog>. The site is dark only.

| Aspect | Observed |
| --- | --- |
| Faces | "Inter Variable", "SF Pro Display", system stack. |
| Weights | Non-standard variable weights: **510** (medium) and **590** (semibold). These are just short of 500 and 600, and that is a large part of why Linear looks crisp rather than heavy. |
| Body | 15 / 24, −0.011 em, in `#d0d6e0` (the second ink level). Measure 650 px. |
| Headings | h1: 32 / 36, weight 590, −0.022 em. h2: 24 / 32, weight 590, −0.012 em. h3: 20 / 32. h4: 17 / 23.8. All in `#f7f8f8`. |
| Ink levels | Four: `#f7f8f8`, `#d0d6e0`, `#8a8f98`, `#62666d`, on `#08090a`. Surfaces are `#1c1c1f` and `#232326`. Borders are `#23252a` and `#34343a`. |
| Accent | `#7170ff`, with brand `#5e6ad2`. It is almost absent from the documentation pages. |
| Links | Ink text with a `#62666d` underline at a 2.6 px offset. |
| Navigation | 280 px wide. Items are 14 / 21, weight 510, 32 px tall, 8 px radius. Groups are collapsible with icons. The current item is a subtle wash. |
| Table of contents | 13 / 19.5 in `#8a8f98`, 28 px rows, a thin left rail with the active entry in ink. |
| Header | 64 px, opaque, 1 px `#23252a` bottom border. |
| Changelog | A date rail on the left and the entry column at 624 px. Body is 17 / 27.2. The entry h2 is 32 / 36 with −0.022 em tracking. Media has an 8 px radius. Long-form rhythm, quietly done. |
| Exceptional | The ink ladder, the weights just under the round numbers, tight negative tracking on display sizes only, and media framed with nothing but a radius. |
| Dated | Nothing. |

#### Fumadocs and a Fumadocs site

Studied: <https://www.fumadocs.dev/docs/markdown> and <https://www.fumadocs.dev/docs>, light, dark and mobile. Fumadocs site: <https://better-auth.com/docs/concepts/session-management>.

| Aspect | Observed |
| --- | --- |
| Faces | Geist + JetBrains Mono. |
| Body | 16 / 28 at **90 % alpha ink** (`oklab(… / .9)`). Measure 750 px. Lede 18 / 28 in `muted-foreground` (`#b3b3b3cc` dark, `#737373` light). |
| Headings | h1: 28 / 42, weight 600 (small, confident). h2: 24 / 32, weight 600. h3: 20 / 32, 32 px above. No negative tracking. |
| Surfaces, dark | `background #121212`, `card #191919`, `popover #1e1e1e`, `muted #212121`, `border #6663` (alpha). |
| Surfaces, light | `background #f5f5f5` (*not white*), `card #f1f1f1`, `popover #fafafa`, `border #cccccc80`. On mobile the article sits on a raised, rounded `popover` card over the grey page. |
| Accent | Yellow in dark (`#fff383`), amber in light (`rgb(204 139 0)`). It appears only on the current navigation item (10 % alpha wash plus accent text), the active table-of-contents entry, and **link underlines** (ink text, 1.5 px accent underline at a 3.5 px offset). |
| Navigation | 268 px wide. Items are 14 / 20 with 8 × 10 padding, 36 px tall, 8 px radius, in `#b8b8b8`. Section heads are 12 / 16, weight 500, in `#b8b8b8`, normal case. Folders carry icons and collapse with chevrons. |
| Table of contents | Title 14 px in `muted-foreground`, normal case. Links 13 / 20, 28 px rows. A 1 px rail that **bends inward for nested levels** (SVG). The active entry is accent-coloured. |
| Mobile | The table of contents collapses to a sticky "current section" bar under the header with a progress ring. Very good. |
| Code | `figure` card: 12 px radius, `card` background, 1 px alpha border, title bar, 13 px mono. Inline code: 13 px, `muted` background, 1 px alpha border, 5 px radius, 3 px padding. |
| Callouts | A neutral `card` with a 12 px radius and a 1 px border. Inside, a **2 px rounded bar** in the tone colour at 50 % alpha, plus an icon. The text is 14 / 20. |
| Better Auth | The same skeleton re-themed to pure black (`#000`), with a `#050505` code surface, `rgba(255,255,255,.06)` hairlines, **square corners**, and no accent: the current navigation item is a 6 % white wash. Proof that the skeleton carries very different identities. |
| Exceptional | An alpha-based border and ink system that holds up on any surface, a light-mode page that is grey rather than white, the bending table-of-contents rail, the mobile progress ring, small headings. |
| Dated | Nothing. |

#### PlanetScale docs

Studied: <https://planetscale.com/docs/vitess/schema-changes/deploy-requests>, light and dark. The site is built on Mintlify and heavily themed.

| Aspect | Observed |
| --- | --- |
| Faces | Inter + "Paper Mono" (proprietary, Mintlify). |
| Body | 16 / 28. Measure 736 px. Lede 18 / 28 (`#c1c1c1` dark, `#3e4244` light). |
| Eyebrow | The section name above the h1, in the accent orange (`#f15817`) at 14 px / 600, **sentence case**. |
| Headings | h1: 36 / 40, weight 600, −0.025 em. h3: 20 / 28, weight 600, −0.025 em. |
| Ink | A neutral grey scale with a faint cool tint, from `#f3f6f9` through `#0a0d10`. Dark ink is `#dee2e4`, secondary `#9ea2a4`, the table-of-contents heading `#505356`. |
| Surfaces | Light page `#fafafa`, dark `#111`. The code card is `#0b0c0e` in dark, with a 16 px radius. |
| Accent | Two hues with clear roles. Orange (`#f15817`) is for *where you are*: eyebrow, active table-of-contents entry. Blue (`#0e73cc` / `#47b7f8`) is for *links*: text plus a 1 px bottom border. |
| Navigation | 288 px wide, hairline right border at 10 % white. Items are 14 / 24 in `#9ea2a4`. The current item is a 10 % white wash with a 12 px radius. **Nested items hang from vertical tree guide lines.** |
| Table of contents | "On this page" in 14 px `ink-3`. Links 14 / 24, weight 500, 1 px left rail; the active entry is orange. |
| Header | Two rows, 96 px: logo and search, then product tabs. Heavier than lockstay or Linear, but justified by multiple products. |
| Steps | Numbered circles joined by a vertical line. |
| Callouts | Blue 20 % tint, 1 px `#1e3a8a` border, 16 px radius (dark). `#eff6ff` with `#bfdbfe` (light). |
| Exceptional | Two accents with distinct jobs, tree guides in the navigation, generous radii without softness, the step component. |
| Dated | Nothing. Slightly busy with two accent hues on one screen. |

#### Vercel docs

Studied: <https://vercel.com/docs/functions> (dark) and <https://vercel.com/docs/functions/runtimes> (light).

| Aspect | Observed |
| --- | --- |
| Faces | Geist + Geist Mono. |
| Body | 16 / 27.2 (1.7). Measure 768 px. Light ink `#171717` on `#fafafa`; dark `#ededed` on `#000`. |
| Headings | h1: 40 / 48, weight 600, **−0.06 em** (−2.4 px). h2: 24 / 32, weight 600, −0.04 em. h3: 20 / 26, weight 600, −0.02 em. The aggressive tracking is Geist's signature. |
| Ink | Gray scale `--ds-gray-100` to `-1000`: `#171717`, `#4d4d4d`, `#7d7d7d` (table-of-contents title), `#8f8f8f`. Alpha border `#00000014`. |
| Navigation | 280 px wide. Items are 14 / 21, 36 px tall, 6 px radius, in `#a1a1a1`. The current item is `#1f1f1f` on black (neutral, no accent). Section heads are 13 px `#7d7d7d`, normal case. |
| Table of contents | Title "On this page" in 14 px `#7d7d7d`. Links are 14 px `#4d4d4d`; the active entry is ink at weight 500. |
| Tables | Header cells are 14 px / 400 in `#4d4d4d` on `#fafafa`, with radius on the outer corners. Rows have 1 px alpha bottom borders and 12 × 10 padding. |
| Code | `#0a0a0a` card with an 8 px radius and a `#2e2e2e` border. Inline code is 14 px / 500 on `#333`, 4 px radius, 1 px border. |
| Focus | `0 0 0 2px var(--bg), 0 0 0 4px oklch(57.6% .25 258)`. A ring offset by the background colour is the gold standard. |
| Exceptional | Monochrome discipline, the focus ring, tables. |
| Dated | Nothing. The 56 px h1 on overview pages is marketing scale. |

### Secondary references

#### Raycast manual

Studied: <https://manual.raycast.com/command-aliases-and-hotkeys>. The site is dark.

| Aspect | Observed |
| --- | --- |
| Type and ink | Inter at 15 / 27 (1.8) at `rgba(255,255,255,.8)`. Ink is alpha white at 1, .8, .6 and .4 on `#151515`. |
| Headings | h1: 36 / 45, weight 700, −0.02 em. h2: 28 / 35, weight 600. h3: 24 / 30. These are large steps for a manual. |
| Accent | Raycast red `#ff6363` carries links *and* the current item. Too many red words on a page. |
| Details | `kbd`: Geist Mono 12.6 px with a tactile inset highlight and shadow. Callouts: tint at 10 % plus a 20 % border with a 12 px radius. Images: 8 px radius plus a 1 px white-10 % ring. |
| Exceptional | The `kbd` component, image framing. |
| Weaker | Red overused, large heading steps. |

#### Stripe docs

Studied: <https://docs.stripe.com/webhooks> and <https://docs.stripe.com/payments/checkout>. Light only: the dark preference is ignored.

| Aspect | Observed |
| --- | --- |
| Type | System stack. Body 16 / 26 in `#3c4257`. h1: 32 / 40, weight 700. h2: 24 / 32 at **weight 400**, an unusual and elegant choice. h3: 16, weight 700. Lede in grey at a large size. |
| Navigation and table of contents | Uppercase section heads in the navigation and an uppercase table-of-contents title. Indigo `#533afd` fills "Code quickstart" in the table of contents. Numbered step headings. |
| Tables | Uppercase 13 px headers, 16 px cell padding, `#ecf1f6` borders. |
| Code | Dark code panels inside a light page (Menlo 13 / 19). |
| Header | 112 px, two rows. |
| Exceptional | Numbered integration steps, light h2 weight, information density. |
| Weaker than Linear | Uppercase chrome, a filled accent button in the table of contents, heavy header, no dark mode. These are exactly the traits the owner ranks below Linear. |

#### Other polished sites

| Site | Studied | Notes worth taking |
| --- | --- | --- |
| Clerk | <https://clerk.com/docs/guides/how-clerk-works/overview> (dark) | Navigation and table-of-contents weight **450**. Body 15 / 28 in `#9394a1` on `#131316` (6.2:1, on the low side). Figures are `#212126` cards with a 16 px radius. Callouts use a 1 px inset ring and a tone bar. h1 32 / 40, weight 600, −0.015 em. |
| Resend (Mintlify) | <https://resend.com/docs/send-with-nodejs> | Lede 18 / 28 in `#3e3e3e`. Measure 576 px, the narrowest of the top sites, and comfortable. Code card radius 14 px. Current item: black at 10 % with a 12 px radius. Table-of-contents rail at 5 % black. |
| Claude Platform docs | <https://platform.claude.com/docs/en/build-with-claude/prompt-caching> | **Serif headings** (`anthropicSerif`, h1 26 / 33, h2 20.6, weight 600) over sans body (16.9 / 25.3 lede, 15 / 22 body). Warm off-white `#fcfcfb`, ink `#0b0b0b`, secondary `#52514e`, tertiary `#898781`. Links: `#184f95` with a 40 % underline at a 3 px offset. Callout radius 11 px. |
| Tailwind CSS docs | <https://tailwindcss.com/docs/font-size> | Inter for prose, IBM Plex Mono 12 px / 500 uppercase +0.1 em for eyebrow, section h2s, navigation group heads and the table-of-contents title. Prose is 14 / 28. The current navigation item is ink at weight 600 with a 1 px ink left border on a rail. A **hairline grid** frames the page. Links are ink text with an accent underline at a 3 px offset. Code panels are dark with a 1 px inset ring and an 8 px radius. This is the reference for using monospace labels well. |
| Apple Developer | <https://developer.apple.com/documentation/swiftui/view> | SF Pro Text 17 / 25, −0.022 em. A **21 px / 500 abstract** under the h1: the clearest lede pattern surveyed. A 21 px grey eyebrow ("Protocol"). h1 40 / 44, weight 700. h2 32 / 36, weight 600. Declaration blocks have a 15 px radius. Dark mode is pure black. The navigator is 416 px wide with symbol-kind icons. |
| Increment (Stripe's magazine, archived) | <https://increment.com/documentation/why-investing-in-internal-docs-is-worth-it/> | Long-form reference: **Tiempos Text 18 / 31.5 (1.75)**, black on `#f2f2f2`. Baton Turbo sans for display, pull quotes (30 / 40.5 in the accent coral) and an uppercase +0.15 em byline. Shows that serif body and sans chrome pair best when the sans is the display voice. |

### Counter-examples, and what makes each feel generic

| Site | Studied | What reads as generic |
| --- | --- | --- |
| Docusaurus | <https://docusaurus.io/docs/markdown-features/admonitions> | System font with no tracking. **h1 48 / h2 32 / h3 24, all weight 700**: shouting steps. Admonitions have a 5 px solid left border *plus* a drop shadow *plus* an uppercase 14 px bold title. Navigation links are 16 px / 500 (as large as body text). The header is separated by a drop shadow rather than a hairline. The current item is a 5 % black wash with green text. Every block looks as important as the text around it. |
| Starlight | <https://starlight.astro.build/guides/authoring-content/> | **h2 35 px / h3 29 px**, weight 600: the scale is too steep for documentation. The current navigation item is a solid accent fill with white text. Every table-of-contents link is accent blue. Asides are a saturated `#cfd4fc` tint with a 4 px accent border and an 18 px title. The navigation header bar is a different grey (`#f6f7f9`). Accent everywhere means accent nowhere. |
| Furo (Read the Docs) | <https://pradyunsg.me/furo/reference/admonitions/> | **Every navigation link is blue**, with the current item grey and bold. Always-visible ¶ pilcrows on headings. h1 40 / h2 32, weight 700. Admonition titles sit on a 20 % tint band with a 3 px left border and a drop shadow. The table-of-contents title is 10 px uppercase. Tiny sidebar captions (11.4 px uppercase bold). |
| GitBook | <https://gitbook.com/docs/create-content/blocks> | Better than the three above, and there is a good idea in it: ink links with an accent-coloured underline at a 4 px offset. But orange appears on the current navigation item, the table-of-contents highlight and the brand, a "New" badge sits in the navigation, and the uppercase 12 px section heads make it busy. |
| MDN | <https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap> | Utilitarian. h1 40 / 50 and h2 24 at **weight 400**. Pure white body text on dark. The "In this article" title is 24 px. It works, but it is not a polish reference. |

Not studied in depth: Notion's published pages, Arc's help centre and Nextra. The owner's steer moved the time to Fumadocs and PlanetScale.

---

## Synthesis

### Common traits of the best

- **Small, flat type scale.** The ratio from h1 to body is 1.9 to 2.3× (Fumadocs 1.75×, Linear 2.1×, lockstay 2.3×). The counter-examples sit at 2.6 to 3×.
- **Weights between 500 and 650 for headings.** Bold 700 is used only for an h1 when the face is light (lockstay, Raycast).
- **Body text at the second ink level, headings at the first.**
- **Line height of 1.6 to 1.75 for prose and 1.4 to 1.5 for chrome.** Prose spacing is generous; interface spacing is tight.
- **A measure of about 65 to 85 characters.** The best are at the narrow end: Resend 576 px, Linear 650 px, Linear changelog 624 px.
- **Hairlines at about 1.2 to 1.5:1 contrast, often alpha so they work on any surface.**
- **Radii scale with size.** Interface items use 6 to 8 px, cards and code 10 to 16 px, badges are pills.
- **No resting shadows in content.** Shadows are kept for floating layers (menus, dialogs). In dark mode, a floating layer gets a 1 px ring.
- **Navigation is denser than the prose.** Items are 26 to 36 px tall. Groups collapse. Counts or icons are optional extras, never decoration.
- **The table of contents is ink-3, 13 px, with a 1 px rail.** The active entry is ink or accent. The title is normal case.
- **Accent covers less than 2 % of the pixels on a page.**

### Where the best differ, and which choice reads as more polished

| Decision | Options seen | Reads more polished | Why |
| --- | --- | --- | --- |
| Light-mode page | White (Vercel `#fafafa` is close; Stripe), tinted off-white (lockstay `0.972 / h200`, Claude `#fcfcfb`), grey (Fumadocs `#f5f5f5`) | **Tinted off-white page with white surfaces for cards.** | It gives cards somewhere to sit without shadows, and pure white glares at reading length. |
| Dark-mode page | Pure black (Vercel, Apple, Better Auth), near-black neutral (Linear `#08090a`, Fumadocs `#121212`), tinted charcoal (lockstay `0.19 / h220`) | **Tinted charcoal for reading themes; true black only for a deliberately stark theme.** | Pure black with `#ededed` text haloes at length. A charcoal page lets the surface step *up* to show depth. |
| Current navigation item | Accent wash with accent text (Fumadocs), accent wash with ink text at weight 600 (lockstay), neutral wash (Vercel, PlanetScale, Resend), rail plus weight (Tailwind) | **Accent wash with ink text (lockstay).** | It shows the accent's identity while keeping the text at full contrast. Accent-coloured text at 14 px is often near the contrast limit. |
| Link styling | Accent text (Stripe, Apple, PlanetScale), ink text with an accent underline (Fumadocs, GitBook, Tailwind), ink text with a grey underline (Linear, lockstay) | **Ink text with a coloured underline, 1 to 1.5 px thick, 3 to 3.5 px offset.** | The prose stays calm and links stay unmistakable. |
| Eyebrow | None (Linear, Fumadocs), sentence-case accent (PlanetScale), uppercase sans accent (lockstay), mono uppercase (Tailwind), large grey (Apple) | **One eyebrow per page, small, in the accent ink.** Case is a theme decision. | It is the one place accent identity sits in the reading column. |
| Code-block surface in light mode | Dark panel on a light page (Stripe, Tailwind), light card (Fumadocs, Vercel light, PlanetScale) | **A light card that matches the theme.** | Dark panels on a light page read as embedded marketing. Matching cards read as one system. |
| Heading anchors | Visible "#" or ¶ (Docusaurus, Furo), revealed on hover (most), "Copy anchor" icon after the heading (Fumadocs) | **Revealed on hover and focus, after the heading text.** | It is invisible until wanted and does not disturb the heading's left edge. |
| Header | Opaque with a hairline (Linear, Vercel), translucent with blur (lockstay), none on desktop with the brand in the sidebar (Fumadocs) | **Translucent, about 88 % page colour, 10 to 12 px blur, hairline.** | Content scrolling under it gives a sense of place without weight. |

### Anti-patterns to avoid

1. Monospace or uppercase as the default voice of the chrome. Keep it for one signature element per theme at most, except in Theme C, where it is the system.
2. A filled accent button as persistent toolbar chrome.
3. Visible "#" or ¶ glyphs before or after headings.
4. A heading scale above 2.4× body, or every heading at weight 700.
5. Accent-coloured navigation links or table-of-contents links in bulk. Starlight and Furo both do this.
6. Callouts with a thick solid left border plus a drop shadow plus an uppercase bold title (Docusaurus, Furo).
7. Resting drop shadows on content blocks. Headers separated by shadows rather than hairlines.
8. Pure white body text on pure black (MDN, Apple), or body text below 6:1 on dark (Clerk is at 6.2:1, the floor).
9. Navigation text the same size as body text (Docusaurus 16 px).
10. Ten-pixel labels: Furo's table-of-contents title, Tailwind's 12 px mono is the floor.

---

## Recommendations: three Quill base themes

**Shared contract for all three themes.** Tokens are named by role, as in lockstay:

- surfaces: `page`, `surface`, `surface-2`, `well`
- lines: `rule`, `edge`, `edge-control`
- text: `ink`, `ink-2`, `ink-3`
- accent: `accent`, `accent-ink`, `accent-wash`, `on-accent`
- other: `focus`, and the tone families `ok`, `warn`, `bad`, `info`

Every theme defines light and dark under `:root` and `.dark` (or `[data-theme]`), as ADR-027 and R13 require. Themes differ only in token values and a small number of component variants, never in markup.

**Contrast targets** (WCAG 2.2; ratios computed from the OKLCH values below with an OKLab → sRGB conversion):

- body ink (`ink-2`) ≥ 7:1 on `page`, `surface` and `well`
- `ink-3` ≥ 4.5:1 on all three surfaces
- `accent-ink` used as text ≥ 4.5:1
- `edge-control` (input borders) and `focus` ≥ 3:1 against the page (SC 1.4.11)
- `rule` and `edge` are decorative, about 1.2 to 1.5:1

**Shared behaviour**

- **Focus:** `0 0 0 2px var(--page), 0 0 0 4px var(--focus)`, where `focus = accent`.
- **Heading anchors:** an icon after the text, `ink-3`, shown on `:hover` or `:focus-within`.
- **Motion:** 120 to 160 ms `ease-out` for hover and press, 200 ms for disclosure, none under `prefers-reduced-motion`. The table-of-contents indicator slides at 200 ms.
- **Navigation:** sections are `<details>` groups with optional counts in `ink-3`.
- **Table of contents:** on mobile, it collapses to a sticky "current section" bar (Fumadocs pattern).

### Theme A: Calm (the default)

*lockstay, Linear, Fumadocs and PlanetScale. Cool tinted neutral, quiet chrome, one sans.*

**Faces.** All are already dependencies per R13.

| Role | Face | Licence and source | Fallback | Settings |
| --- | --- | --- | --- | --- |
| Interface and prose | Inter Variable | OFL-1.1, `@fontsource-variable/inter` | `ui-sans-serif, system-ui, sans-serif` | `font-feature-settings: "cv11", "ss01"`; `tnum` in tables. Use `opsz` where available. |
| Code | JetBrains Mono Variable | OFL-1.1 | `ui-monospace, "SF Mono", Consolas, monospace` | |

Alternative: Figtree (OFL-1.1) if the owner wants lockstay's slightly softer geometry.

**Type scale** (px; line height; weight; tracking)

| Role | Size / line height | Weight | Tracking | Ink |
| --- | --- | --- | --- | --- |
| Body | 16 / 26 | 400 | −0.006 em | `ink-2` |
| Lede | 18 / 28 | 400 | | `ink-2` |
| Small and caption | 13 / 20 | | | `ink-3` |
| Interface | 14 / 20 | 450 | | |
| Navigation and table of contents | 13.5 / 20 | | | |
| h1 | 32 / 38 | 640 | −0.022 em | `ink` |
| h2 | 22 / 28 | 620 | −0.012 em | `ink` |
| h3 | 17.5 / 26 | 600 | −0.006 em | `ink` |
| h4 | 15 / 22 | 600 | | `ink-2` |
| Eyebrow | 12.5 / 16 | 600 | +0.07 em, uppercase | `accent-ink` |
| Inline code | 0.875 em | | | |
| Block code | 13.5 / 22 | | | |

- **Measure:** `max-width: 68ch`, about 690 px.
- **Rhythm:** a 4 px base. Paragraph gap 16 px. 48 px above h2, 32 px above h3, 12 px below headings.
- **Eyebrow:** one per page, sans (never mono).

**Colour, light**

| Token | OKLCH | Contrast and notes |
| --- | --- | --- |
| `page` | `0.985 0.002 255` | |
| `surface` | `1 0 0` | |
| `surface-2` | `0.975 0.003 255` | |
| `well` | `0.965 0.003 255` | |
| `rule` | `0.925 0.004 255` | 1.2:1 |
| `edge` | `0.885 0.005 255` | 1.35:1 |
| `edge-control` | `0.62 0.01 255` | 3.5:1 |
| `ink` | `0.22 0.012 255` | 16.6:1 |
| `ink-2` | `0.40 0.012 255` | 8.8:1 (8.3:1 on `well`) |
| `ink-3` | `0.52 0.010 255` | 5.3:1 (5.0:1 on `well`) |
| `accent` | `0.53 0.15 262` | 5.2:1; white on accent 5.4:1 |
| `accent-ink` | `0.48 0.15 262` | 6.4:1 |
| `accent-wash` | `0.955 0.025 262` | `accent-ink` on wash 5.9:1 |

**Colour, dark**

| Token | OKLCH | Contrast and notes |
| --- | --- | --- |
| `page` | `0.17 0.006 255` | |
| `surface` | `0.205 0.007 255` | |
| `surface-2` | `0.19 0.007 255` | |
| `well` | `0.15 0.006 255` | |
| `rule` | `0.265 0.007 255` | |
| `edge` | `0.32 0.008 255` | 1.5:1 |
| `edge-control` | `0.50 0.01 255` | 3.2:1 |
| `ink` | `0.965 0.004 255` | 17.3:1 |
| `ink-2` | `0.82 0.008 255` | 11.0:1 |
| `ink-3` | `0.68 0.010 255` | 6.6:1 |
| `accent` | `0.72 0.13 262` | |
| `accent-ink` | `0.80 0.10 262` | 10.2:1 |
| `accent-wash` | `0.27 0.05 262` | |
| `on-accent` | `0.17 0.006 255` | 7.6:1 |

**Accent.** Hue 262 (Linear-like indigo blue) is the default. The organisation's theme supplies the hue, and the lockstay chroma guard applies: cap chroma at 0.05 for hues 13–85, 145–175 and 315–345.

| Accent appears on | Accent never appears on |
| --- | --- |
| Current navigation item (`accent-wash` with `ink` text at weight 600) | Headings |
| Active table-of-contents entry (`accent-ink` plus a 2 px rail segment) | Toolbar buttons |
| Link underlines (`accent` at 1.25 px, 3 px offset; text stays `ink`) | Body text |
| Eyebrow | Bulk navigation links |
| Callout bar | |
| Focus ring | |
| The single primary button in a form or dialog | |

**Radii.** Interface 6 px. Controls 8 px. Cards, code, tables and callouts 12 px. Dialogs 16 px. Badges are pills.

**Borders and shadows**

- Content: hairline `rule` borders. No shadows on content.
- Floating layers, light: `0 1px 2px oklch(0.3 0.02 255 / .05), 0 0 0 1px oklch(0.3 0.02 255 / .06), 0 12px 32px -12px oklch(0.3 0.02 255 / .18)`.
- Floating layers, dark: `0 0 0 1px var(--edge), 0 16px 40px -16px oklch(0 0 0 / .6)`.

**Components**

- **Code block:** a `surface` card with a 1 px `rule` border and a 12 px radius. An optional title bar on `surface-2` with a bottom border. The copy button is ghost style, shown on hover or focus.
- **Inline code:** `well` background, 1 px `rule` border, 5 px radius, 0.15 em × 0.35 em padding.
- **Tables:** a `surface` card wrapper with a 12 px radius. `th` at 13 px / 550 in `ink-3` on `surface-2`. Rows have 1 px `rule` borders, 10 × 12 padding, `tnum`.
- **Callouts:** lockstay's pattern. A `surface` card with a 12 px radius, `inset 3px 0 0 var(--tone), inset 0 0 0 1px var(--rule)`. The title is 13 px / 600 in the tone ink, sentence case. An icon is optional.
- **Badges:** pills, 12 / 16, weight 550, 2 × 8 padding, on a tone wash.
- **Figures:** a `surface` card with a 12 px radius and a 1 px `rule` border. Captions are 13 / 20 in `ink-3`.

**Navigation**

- 264 px wide, transparent over `page` (no separate sidebar colour), with a hairline right border.
- Section headings: 13 px / 600 in `ink`, sentence case, with a count in `ink-3`, collapsible.
- Items: 13.5 / 20, 30 px tall, 4 × 8 padding, 6 px radius, `ink-2`. Hover is a `well` background.
- Nested levels hang from a 1 px `rule` guide (PlanetScale).

**Table of contents**

- 220 px wide. Title "On this page" at 13 px / 600 in `ink`.
- Links at 13 / 18 in `ink-3` with 4 px vertical padding.
- A 1 px `rule` rail. The active entry turns `ink` with a 2 px `accent` segment on the rail that slides between entries.

**Header**

- 56 px, sticky.
- Background `page / 0.86` with `backdrop-filter: blur(12px) saturate(1.4)`, and a 1 px `rule` bottom border.
- Toolbar buttons are ghost or `surface` with an `edge` border. The theme switch is a segmented control.

### Theme B: Editorial

*Long-form reading: handbooks, essays, policy, public publications. Warm paper, refined serif.*

**Faces**

| Role | Face | Licence and source | Fallback | Settings |
| --- | --- | --- | --- | --- |
| Prose and headings | Source Serif 4 Variable with the **`opsz`** axis | OFL-1.1, `@fontsource-variable/source-serif-4/opsz.css`, already in R13 | `"Iowan Old Style", Charter, Georgia, serif` | `font-optical-sizing: auto` so headings get the display cut and body the text cut. `onum` in prose, `lnum tnum` in tables. |
| Chrome (navigation, table of contents, captions, labels, buttons) | Inter Variable | | | Kept small, so the serif owns the column. |
| Code | JetBrains Mono | | | |

Alternative serif: Newsreader (OFL-1.1, also optical sizes), which is more literary.

**Type scale**

| Role | Size / line height | Weight | Notes | Ink |
| --- | --- | --- | --- | --- |
| Body | 18.5 / 31 (1.68) | 400 | serif | `ink` (strong, as in print) |
| Lede (dek) | 22 / 32 | 400 | serif | `ink-2` |
| Caption | 13.5 / 20 | | Inter | `ink-3` |
| Interface | 14 / 20 | | Inter | |
| Navigation | 14 / 22 | | Inter | |
| h1 | 40 / 46 | 560 | serif display `opsz`, −0.015 em | |
| h2 | 27 / 34 | 560 | serif, −0.01 em, 56 px above | |
| h3 | 21 / 28 | 600 | serif | |
| h4 | 14 / 20 | 600 | Inter, +0.02 em, sentence case | `ink-2` |
| Eyebrow | 13 / 18 | 550 | Inter, small caps (`font-variant-caps: all-small-caps`, +0.04 em) rather than uppercase | `accent-ink` |
| Pull quote | 26 / 36 | | serif italic | `ink` |
| Block code | 14 / 23 | | | |

- **Measure:** `max-width: 66ch`, about 640 px. Table of contents to the right on wide screens; the navigation collapses by default on article pages.
- **Rhythm:** paragraph gap 0.9 em, no indents (screen convention).
- **Drop cap:** optional, behind a front-matter flag.

**Colour, light**

| Token | OKLCH | Contrast and notes |
| --- | --- | --- |
| `page` | `0.975 0.008 85` | warm paper |
| `surface` | `0.99 0.005 85` | |
| `well` | `0.955 0.010 80` | |
| `rule` | `0.915 0.010 75` | |
| `edge` | `0.87 0.012 75` | |
| `edge-control` | `0.62 0.012 70` | 3.4:1 |
| `ink` | `0.24 0.015 60` | 15.3:1 |
| `ink-2` | `0.40 0.016 60` | 8.6:1 |
| `ink-3` | `0.52 0.014 65` | 5.1:1 (4.8:1 on `well`) |
| `accent` | `0.50 0.13 32` (oxblood or rust) | 5.9:1 |
| `accent-ink` | `0.46 0.13 32` | 7.1:1 |
| `accent-wash` | `0.95 0.025 40` | |

**Colour, dark** (warm charcoal, never black)

| Token | OKLCH | Contrast and notes |
| --- | --- | --- |
| `page` | `0.185 0.008 60` | |
| `surface` | `0.215 0.009 60` | |
| `well` | `0.165 0.008 60` | |
| `rule` | `0.28 0.010 60` | |
| `edge` | `0.34 0.010 60` | |
| `edge-control` | `0.52 0.012 60` | 3.4:1 |
| `ink` | `0.93 0.012 85` | 15.2:1, deliberately below pure white to avoid halo |
| `ink-2` | `0.80 0.014 80` | 10.0:1 |
| `ink-3` | `0.67 0.014 75` | 6.2:1 |
| `accent` | `0.72 0.11 40` | |
| `accent-ink` | `0.78 0.09 45` | 9.1:1 |
| `accent-wash` | `0.27 0.04 40` | |

**Accent.** Hue 32 to 40, earthy.

| Accent appears on | Accent never appears on |
| --- | --- |
| Link underlines (`accent` at 1 px, 3.5 px offset, `text-decoration-skip-ink: auto`) | Headings |
| Eyebrow | Chrome |
| Pull-quote rule | Code |
| Active table-of-contents entry | |
| Focus | |

The current navigation item uses `well` with `ink` at weight 600. The accent stays out of the navigation entirely, so the reading column carries the colour.

**Radii.** Smaller and quieter than Theme A: interface 4 px, cards and code 8 px, badges 4 px (not pills).

**Borders and shadows.** Hairline rules only. Section breaks use a centred 1 px `rule` at 30 % of the measure, or three spaced dots.

**Components**

- **Code:** a `well` card with a 1 px `rule` border and an 8 px radius, 14 px mono.
- **Callouts:** no card. A 2 px `tone` rule on the left and a 13 px Inter small-caps title. The prose continues in the serif inside.
- **Tables:** open, with no outer card. A top and bottom `ink-3` rule at 1 px, row rules in `rule`, Inter 14 px, `th` at 600 in `ink`. Book table style.
- **Figures:** full measure or wider. Optionally bleeds to 820 px. Caption below in Inter 13.5 `ink-3` with a figure number in `ink-2`.

**Navigation**

- Inter 14 / 22 in `ink-2`, 28 px rows. Section headings 14 px / 600 in `ink`. No icons.
- The table of contents is a numbered list in Inter 13 / 20 `ink-3`, with a 1 px rail.

**Header**

- 52 px, translucent `page / 0.9`, blur 10 px, hairline. Byline and date in the header row on articles.
- An optional reading-progress hairline in `accent` at 2 px under the header.

### Theme C: Grid (stark technical)

*Dense reference material and an engineered identity. Pure neutral, hairline grid, monospace as structure.*

**Why this theme.** A and B are both soft reading themes. The survey shows a third, distinct register used by Vercel, Better Auth on Fumadocs, and Tailwind: zero-chroma neutrals, alpha hairlines, small radii, a true-black dark mode, and monospace labels *as the system's voice*. It suits API references, specifications, runbooks and wide tables, and organisations that want precision over warmth. It is also where Quill's current monospace labels and orange belong, in the right roles:

- mono uppercase for structure: navigation group heads, the table-of-contents title, the eyebrow, table headers
- orange as a *signal*: indicators, focus and the current item, never fills

**Faces**

| Role | Face | Licence and source | Fallback |
| --- | --- | --- | --- |
| Interface and prose | Geist | OFL-1.1, via the `geist` package or Fontsource | `ui-sans-serif, system-ui` |
| Code and labels | Geist Mono | OFL-1.1 | `ui-monospace, monospace` |

**Type scale**

| Role | Size / line height | Weight | Tracking | Ink |
| --- | --- | --- | --- | --- |
| Body | 15 / 25 | 400 | | `ink-2` |
| Lede | 17 / 26 | | | `ink-2` |
| Interface | 13.5 / 20 | | | |
| Navigation | 13.5 / 20 | | | |
| h1 | 36 / 40 | 600 | **−0.045 em** (Geist's display tracking) | |
| h2 | 22 / 28 | 600 | −0.025 em | |
| h3 | 17 / 24 | 600 | −0.01 em | |
| h4 | 15 / 22 | 600 | | |
| Labels: navigation group heads, table-of-contents title, eyebrow, table headers, callout titles | 11.5 / 16 Geist Mono | 500 | uppercase, +0.08 em | `ink-3` |
| Block code | 13 / 20 | | | |

- **Labels:** the mono label is *only* a label, never a heading and never a button.
- **Measure:** 72ch for prose. Tables and code may span the full content width, about 960 px.

**Colour, light** (chroma 0 throughout)

| Token | OKLCH | Contrast and notes |
| --- | --- | --- |
| `page` | `1 0 0` | |
| `surface` | `0.985 0 0` | |
| `well` | `0.97 0 0` | |
| `rule` | `0.93 0 0` | can be drawn as `oklch(0 0 0 / .08)` |
| `edge` | `0.88 0 0` | |
| `edge-control` | `0.60 0 0` | 4.0:1 |
| `ink` | `0.16 0 0` | 19.4:1 |
| `ink-2` | `0.38 0 0` | 10.0:1 |
| `ink-3` | `0.50 0 0` | 6.0:1 |
| `accent` (signal orange) | `0.64 0.19 42` | 3.6:1, so indicators and focus only, never text |
| `accent-ink` | `0.53 0.17 40` | 5.7:1, used for links and text |
| `accent-wash` | `0.96 0.03 50` | |

**Colour, dark** (true black is allowed here; it is this theme's identity)

| Token | OKLCH | Contrast and notes |
| --- | --- | --- |
| `page` | `0.13 0 0` | about `#0a0a0a` |
| `surface` | `0.17 0 0` | |
| `well` | `0.11 0 0` | |
| `rule` | `0.24 0 0` | or `oklch(1 0 0 / .08)` |
| `edge` | `0.30 0 0` | |
| `edge-control` | `0.48 0 0` | 3.1:1 |
| `ink` | `0.97 0 0` | 18.4:1 |
| `ink-2` | `0.80 0 0` | 10.8:1, which keeps body text off pure white |
| `ink-3` | `0.66 0 0` | 6.5:1 |
| `accent` | `0.70 0.18 45` | |
| `accent-ink` | `0.76 0.14 50` | 9.0:1 |
| `accent-wash` | `0.24 0.05 45` | |

**Accent.** Orange (hue 42 to 45) as the signal colour.

- The current navigation item: a 2 px `accent` bar at the left edge of the item, with `ink` text at weight 550 on a `well` background.
- The active table-of-contents rail segment, focus rings, the step-number fill, and link underlines (`accent-ink` text in references).
- Nowhere else.
- The primary button is `ink` on `page` (Vercel), not orange.

**Radii.** 4 px for interface, 6 px for code and cards, 4 px for badges. Square table cards.

**Borders and shadows**

- Hairlines carry everything. An optional page grid: the content column and sidebars are framed by 1 px `rule` lines that run the full viewport height (Tailwind). No shadows except floating layers, which get a 1 px `edge` ring plus `0 8px 24px -8px oklch(0 0 0 / .25)`.

**Components**

- **Code:** a `well` card with a 1 px `rule` border and a 6 px radius. The title bar holds the file name in a mono label. Line numbers are in `ink-3`.
- **Tables:** first-class. Sticky `th` (mono label) with a 1 px `rule` grid, 8 × 12 padding, `tnum`, zebra rows off by default. Wide tables scroll inside the card with an edge fade.
- **Callouts:** a 1 px `edge` box with a 6 px radius. A mono label title in the tone colour. A 2 px tone bar on the left inside the box.
- **Badges:** square-ish (4 px radius), mono 11 px uppercase, 1 px tone border, no fill.
- **`kbd`:** mono 12 px with a 1 px `edge` border and an `inset 0 -1px 0 var(--edge)` key shadow.

**Navigation**

- 256 px wide, with a hairline right border.
- Group heads are mono labels. Items are 13.5 / 20, 28 px rows, 4 px radius, `ink-2`.
- Nested levels use a 1 px guide. Optional HTTP-method badges for API pages.

**Table of contents**

- A mono label title. Links at 13 px in `ink-3`, a 1 px `rule` rail, and the active entry in `ink` with an `accent` segment.

**Header**

- 52 px, opaque `page`, 1 px `rule` bottom border. Square search field with a `kbd` hint.

---

## Consequences

- Themes A and B use only faces already in R13. Theme C adds Geist and Geist Mono (OFL-1.1), one new runtime dependency to justify in its pull request.
- The token names follow lockstay's role names. Quill's current token set should map onto `page`, `surface`, `surface-2`, `well`, `rule`, `edge`, `edge-control`, `ink`, `ink-2`, `ink-3` and the accent family before any theme work, so a theme is only values.
- Removing the visible "#" anchors, the monospace chrome labels and the filled toolbar button from the default theme is a component change (anchor reveal, label variant, button variant), not just a token change.
- What would change these recommendations: if the owner wants serif body text in the *default* theme, swap A and B's roles and keep B's numbers. If the organisation's brand hue falls in the guarded ranges, A's accent chroma is capped, which is intended.

## Sources

- lockstay portal: <http://localhost:4320/overview/sync-map.html>
- Linear: <https://linear.app/docs/conceptual-model>, <https://linear.app/changelog>
- Fumadocs: <https://www.fumadocs.dev/docs>, <https://www.fumadocs.dev/docs/markdown>
- Better Auth (Fumadocs): <https://better-auth.com/docs/concepts/session-management>
- PlanetScale: <https://planetscale.com/docs/vitess/schema-changes/deploy-requests>
- Vercel: <https://vercel.com/docs/functions>, <https://vercel.com/docs/functions/runtimes>
- Raycast: <https://manual.raycast.com/command-aliases-and-hotkeys>
- Stripe: <https://docs.stripe.com/webhooks>, <https://docs.stripe.com/payments/checkout>
- Clerk: <https://clerk.com/docs/guides/how-clerk-works/overview>
- Resend: <https://resend.com/docs/introduction>, <https://resend.com/docs/send-with-nodejs>
- Claude Platform docs: <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- Tailwind CSS: <https://tailwindcss.com/docs/font-size>
- Apple Developer: <https://developer.apple.com/documentation/swiftui/view>
- MDN: <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-wrap>
- GitBook: <https://gitbook.com/docs/create-content/blocks>
- Increment: <https://increment.com/documentation/why-investing-in-internal-docs-is-worth-it/>
- Docusaurus: <https://docusaurus.io/docs/markdown-features/admonitions>
- Starlight: <https://starlight.astro.build/guides/authoring-content/>
- Furo: <https://pradyunsg.me/furo/reference/admonitions/>
