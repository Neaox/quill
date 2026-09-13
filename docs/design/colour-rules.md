# Colour rules for generated themes

The quantifiable rules the palette generator and the theme doctor (ADR-028) implement. Every rule is stated in OKLCH, where L is lightness 0 to 100, C is chroma (0 is grey, 0.37 is the most saturated sRGB can show), and H is hue in degrees. Rules are grouped by how much confidence they deserve.

## 1. Legibility (measured, non-negotiable)

| Rule | Value | Why |
|---|---|---|
| Body text contrast (ink on paper) | WCAG 2.2 AA at 4.5:1 minimum, and APCA Lc 75 or more | WCAG is the compliance floor; APCA tracks perceived readability far better, especially in dark mode and for thin fonts |
| Secondary text (muted, accent, syntax tokens) | WCAG 4.5:1 minimum, and APCA Lc 45 or more | The lightness bands in section 3 cap what muted text on dark paper can reach; Lc 45 is what those bands make achievable while AA holds in full. The implementation proved a Lc 75 floor here unsatisfiable |
| Large text and UI boundaries | 3:1 and APCA Lc 60 (large text) or Lc 45 (non-text) | Focus rings, borders on inputs, icons |
| Placeholder and decorative text | APCA Lc 30 to 45 | Readable when you look, quiet when you don't |
| Text on the accent | Whichever of white or ink scores higher; both must pass 4.5:1, else nudge the accent's L until one does | The tenant's exact hex may be a mark colour, not a text colour |
| Dark-mode ink | L 90 to 95, never 100 | Pure white on dark halates and tires the eye |
| Dark-mode paper | L 15 to 22, never 0 | Pure black kills depth cues and makes shadows meaningless |

## 2. Perceptual uniformity (measured)

- Build every ramp in OKLCH so equal steps look equal. HSL and hex-lightening produce hue drift and uneven steps; that is where muddy greys and neon blues come from.
- Keep hue constant along a ramp. Lightening a colour must not turn a teal into a mint.
- Gamut-map, never clip. High-chroma blues (H 250 to 290) and greens (H 130 to 160) leave sRGB at moderate L; reduce C until in gamut, keeping L and H.
- The same C reads more saturated in yellow-greens (H 90 to 150) and less in blues; when matching a set of hues, allow a hue-dependent C adjustment of up to 15 percent so they feel equal.

## 3. Lightness bands per role (a committed system)

These bands are what make every generated theme sit in the same tonal register.

| Role | Light mode L | Dark mode L |
|---|---|---|
| Paper (page) | 96 to 99 | 15 to 22 |
| Surface (panels, code) | 93 to 97, at least 1.5 below paper | 19 to 26, at least 2.5 above paper |
| Raised surface | 100 or paper + 1 | surface + 3 |
| Borders, hairlines | 85 to 92 | 28 to 35 |
| Muted text | 45 to 55 | 65 to 75 |
| Ink (text) | 18 to 28 | 90 to 95 |
| Accent as text and controls | 40 to 55 | 65 to 78 |

## 4. Chroma budget (strong regularity: the area effect)

A colour looks more saturated the more area it covers, so allowed chroma falls as area rises.

| Element | Maximum C |
|---|---|
| Paper and large surfaces | 0.012 (warm or cool tint is C 0.004 to 0.012, never zero if a tone was chosen) |
| Panels, sidebars | 0.02 |
| Borders | 0.015 |
| Muted text | 0.02 |
| Accent in small areas (links, buttons, marks) | 0.08 to 0.18 in light mode; reduce by 20 to 30 percent in dark mode for the same felt saturation |
| Accent as a subtle background tint | mix of accent at 8 to 14 percent into paper, never the accent's own C |

One saturated thing at a time: at most one element class above C 0.05 in any view apart from status colours and syntax tokens.

## 5. Hue relationships (empirical, encodable)

- **Neutrals and accent must agree.** If the neutral tint has C above 0.006, its hue must be within 60 degrees of the accent (analogous, calm) or 150 to 210 degrees away (complementary, lively). Hue gaps of 60 to 150 at visible chroma read as a mismatch. Below C 0.006 the neutral is effectively grey and any accent works.
- **Two accents share L and C and differ only in hue.** Keep ΔL at most 5 and ΔC at most 0.02. Hue separation either at most 30 degrees or 150 to 210 degrees.
- **Status colours are a fixed set** at matched L and C: success H 145 to 155, warning H 75 to 85, danger H 25 to 30, info takes the accent. If the tenant's accent is within 40 degrees of a status hue, the status hue is shifted away by the difference to keep them distinguishable, and status never relies on colour alone.
- **Preference follows two measurable things**: people rate pairs higher when hues are similar (harmony) and when lightness contrast between figure and ground is high. That is why a tinted-grey page with one accent at strong lightness contrast reads as considered, and a mid-lightness page with three saturated hues reads as cheap. (Schloss and Palmer's harmony studies; Cohen-Or's hue-template harmonisation is the algorithmic form.)

## 6. Proportion (convention, but measurable)

About 60 percent of the viewport in paper, 30 percent in surfaces and text, 10 percent or less in accent. The theme doctor measures accent coverage in the preview and warns above 12 percent.

## 7. Dark mode is a re-derivation, not an inversion

- Same hue seeds, lightness bands from the dark column, chroma reduced 20 to 30 percent.
- Elevation flips: in light mode raised surfaces are lighter; in dark mode they are lighter too, which means further from the paper, not inverted.
- Shadows lose meaning on dark paper; use border and lightness steps for depth instead.
- Re-check every contrast pair; passing in light mode says nothing about dark.

## 8. Colour vision deficiency (measured)

Simulate protan, deutan, and tritan vision (Machado 2009 matrices) and measure separation as ΔE in OKLab. Two honest findings from the implementation shape how this rule is graded:

- A status set at matched lightness in the narrow hue bands of section 5 **cannot** reach ΔE 20 under deuteranopia; measured separation is 1 to 2. Sections 5 and 8 are structurally in tension, and section 5 wins because a coherent set matters to everyone while colour is never the only signal for anyone. The doctor therefore reports `adjusted` with the remedy already stated, a shape or a label, when the shortfall is structural, and reports `warn` only when a tenant's override made separation worse than the seeds alone would have given.
- Accent versus muted text is held to ΔE 10.

Status always carries an icon or a label; colour alone is never the signal.

## What the theme doctor reports

For a candidate theme: every rule above as pass, adjusted, or warn, with the adjustment named ("accent lightened from L 62 to 48 for text; kept at L 62 for the logo mark"). Tenants get the exact colours they asked for wherever those colours are safe, and a derived colour with a reason wherever they are not.
