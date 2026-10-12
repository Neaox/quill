# ADR-037: Tenant labels

**Status:** Accepted
**Date:** 2026-10-11
**Related:** ADR-002 (Markdown is canonical), ADR-028 (themes), ADR-031 (render caching), ADR-036 (diagrams and reading blocks)

## Context

ADR-036 gave documents status badges whose tone is one of the interface's five (`:ok[Built]`, `:warn[Partial]`). Real documentation also names things that belong to the organisation rather than to a status: an organisation's documents may mark every row and every diagram arrow with the partner or team it concerns, `:acme[Acme]`, `:globex[Globex]`, each in its own colour, and the same colour runs through their SVG diagrams. Quill renders those as written, because a theme has no colours beyond the accent, the neutrals and the status set, and the renderer has no names beyond its own directives.

The owner asked for tenants to be able to define these.

## Decision

**A label is a name and a colour, defined in the organisation's theme.** `ThemeDocument.labels` is an optional list of `{ name, title, hue, chroma? }`, at most 24 entries:

- `name` is the directive name and the class name: `^[a-z][a-z0-9-]{0,31}$`. It must not be the name of a built-in directive (`badge`, the badge shorthands, `small`, `figure`, `cards`, the callout types, …) or of a drawing vocabulary class (`zone`, `box`, `send`, …). Validation refuses a collision rather than letting the tenant shadow a built-in.
- `title` is what settings show; the document's text is still the label's meaning.
- `hue` and `chroma` are seeds, exactly like `collections` and the status overrides. The generator settles each label's foreground, background and stroke in light and dark against the same contrast floors as the status tones, and the theme doctor checks them. A tenant cannot state an unreadable label.

Labels live in the theme because a label is identity (the theme is the organisation's identity, ADR-028); they are organisation-wide, so a name means the same in every workspace and on the public site.

**The theme stylesheet colours them.** For each label it emits `--label-<name>-ink`, `--label-<name>-fill` and `--label-<name>-stroke` per scheme, and rules for `.badge[data-label="<name>"]` and, inside drawings, for the class `<name>` (stroke and fill of shapes, fill of text), so one name colours a pill in a table and an arrow in a diagram. Names are validated before they reach CSS, so they need no escaping beyond that.

**The renderer knows the names, not the colours.** `RenderInput.labels` is the set of label names. A text directive whose name is in the set renders as a badge: `<span class="badge" data-label="acme">Acme</span>`. A directive whose name is not in the set is unchanged: it renders as written, as every unknown directive does (ADR-002, AGENTS.md rule 7). The sorted names are part of the render cache key (ADR-031), so adding or removing a label re-renders the bodies; changing a label's colour changes only the stylesheet and re-renders nothing. The sanitiser admits `data-label` on `span` only with the name pattern.

Labels are Markdown's own `:name[text]` text directives, so outside Quill they read as the literal source, which names the thing. A label has no tone attribute and no shorthand of its own: the name is the whole syntax.

**The editor draws labels as it draws badges**, from the same theme it already loads, so a label looks the same while it is written as when it is read. Validation warns, in the editor, about a labelled text directive whose name is neither built in nor a label, which is how a typo (`:acm[Acme]`) is noticed.

**Settings.** The theme settings page gains a Labels section beside collection colours: name, title and colour, with a preview pill in both schemes and the doctor's verdict. Removing a label that documents use is allowed; those documents fall back to the literal text, which is the degradation every directive has.

## Alternatives considered

- **Render every unknown labelled text directive as a pill and colour it from the stylesheet.** No renderer input and no cache key change, but it erases the difference between a label and a typo, and turns every unrecognised directive into styled markup instead of the source an author can see is wrong.
- **Labels as workspace settings.** A channel means the same thing across an organisation, and the public site and exports are rendered per organisation theme; per-workspace names would make one document render differently by where it is moved.
- **Arbitrary CSS colours.** Breaks the theme's guarantee that every pair it ships passes the contrast floors in both schemes (ADR-028). Seeds keep that guarantee.
- **A generic `:label[Acme]{name=acme}` syntax only.** Longer to write in a table cell, and not what existing documents use. The short form is the point; nothing stops a generic form being added later.

## Consequences

- An organisation's existing labels and label-coloured diagrams render in Quill without rewriting the documents.
- `RenderInput` grows one field and the cache key one component; a renderer that is given no labels behaves exactly as before.
- The theme schema grows one optional field; a theme without it is unchanged (AGENTS.md rule 17).
- Collisions with future built-in directive names are possible: adding a built-in directive must check stored themes' labels and say which tenants it shadows, and a stored label that collides is shadowed by the built-in, flagged by the theme doctor, until it is renamed.

## Amendment, 2026-10-11: where labels are edited

Labels are edited in **Settings → Labels and emoji** (`/admin/settings/labels`), beside the custom emoji a pill can lead with (ADR-038), rather than on Theme. They stay in the theme document: that screen edits the theme's `labels` with the same draft, revision and conflict handling as Theme, and the first label added forks a built-in as any lever does. The theme doctor, on Theme, still checks that every label reads.
