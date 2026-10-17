# ADR-054: Template library and authoring

**Status:** Accepted
**Date:** 2026-10-17
**Related:** amends ADR-029 (template model); ADR-005 (front matter schema), ADR-012 (permissions), ADR-052 (publish capability and review requests), ADR-015 (publish), ADR-033 (compatibility), ADR-034 (configuration), ADR-039 (Markdown extensions), ADR-045 (access requests), ADR-046 (deletion), ADR-055 (authorship and ownership); research [`2026-10-17-templates-and-edit-permissions.md`](../../research/2026-10-17-templates-and-edit-permissions.md); design rules [`docs/design/templates.md`](../../design/templates.md)

## Context

ADR-029 decided what a template *is*. It is Markdown with a `template:` declaration of questions, sections and metadata, and it has template-only blocks that shape the writing surface and never reach a published revision. That layer is built:

- `resolveTemplate` and `stripAuthoringBlocks` in `packages/markdown`;
- the required markers, placeholder typing and directive views in `packages/editor/src/template`;
- `createDocument` with a template and answers;
- a "Start from" select in the New document dialog.

ADR-029 left the product around the format undecided:

- **Templates are not their own thing.** A template is a document in a collection whose slug is `templates`. So it sits in the reading tree, is found by search, can be published to the web, and opens in the same editor as any page, with nothing on the screen to say that what you change here changes every document made from it.
- **Who may make, change and share a template is undecided.** Today any editor can change the template the whole workspace uses.
- **How someone knows they are editing a template rather than a document is undecided.**
- **Most of ADR-029's lifecycle is not built:**
  - the gallery;
  - the template panel (`useTemplateProgress` has no consumer);
  - the publish summary of unfinished required sections (the server returns it and the web ignores it);
  - re-answering, "template updated", "Save as template";
  - template validation.

The research write-up finds:
- Teams expect templates to start personal and be shared when ready.
- A shared template's users and its editors are different sets of people.
- Template edits never reach existing documents.
- Template editing is marked in the content area, not by a colour scheme.
- Title patterns and sequence numbers are open ground.

## Decision

### Who templates are for

| Person | What they do with templates |
| --- | --- |
| Writer | Starts a document from a gallery and answers a few questions in one step. Lands in the editor with the cursor in the first placeholder and a checklist of required sections. Adds optional and repeated sections, changes an answer later, publishes with unfinished required sections (the summary names them and does not block), and is offered sections the template has gained since. Can apply a template to a document that is still empty. |
| Template author (any editor) | Makes a template from scratch, from a document ("Save as template") or by duplicating a built-in. Writes placeholders and guidance, marks sections required, optional, repeated or conditional, writes the questions in a form, and sets the metadata stamped on new documents, a title pattern and a sequence. Tries the template before releasing it, publishes versions, shares it when it is ready, sees how many documents use which version, and retires it. |
| Workspace lead | Curates the library, sets a default template per collection, hides built-ins the team does not use, and edits or retires any template shared with the workspace. |
| Unit administrator | Shares a template with every workspace below the unit: a postmortem, a security review. |
| Occasional contributor | Never asked about templates. Blank stays the default, and `c` makes a blank document. |
| Reader | Never sees template machinery. A document's `type` may appear as a quiet label above its title. |

### A template is a kind of its own, kept in a library

- **The kind.** `documents.kind` is `'document' | 'template'`, an extensible string union like status, added by an expand-only migration.
  - The canonical marker is still the `template:` declaration in front matter, and the column is an index rebuilt from the content store (ADR-034).
  - `isTemplateDeclaration` decides it, as it does today.
- **Where a template is stored.** At `.quill/templates/<slug>.md` in its home workspace's content store. So it travels with the workspace, has history, diffs and restore, and is synced to Git like everything else (ADR-029, ADR-034).
- **What a template is never part of:** a collection, the reading tree, document search, the public site, presentation mode, share links or export of documents. It appears in the library, the gallery and its own routes.
- **The two kinds never cross.**
  - Template services and routes (`/api/workspaces/:id/templates`, `/api/templates/:id`) are separate from document ones.
  - Each service refuses the other kind with a `Result` failure.
  - A document address given a template's key redirects to the template's own route, and the reverse also redirects.
- **Reading existing templates (ADR-033).** A document in a collection with the slug `templates` that carries a declaration is read as a template. A one-off migration moves it into the library and leaves a redirect from its old address. The development seeds and the demo content move with it.
- **Built-in templates.**
  - They ship as Markdown in a new package, `packages/templates`: architecture decision record, technical design, runbook, postmortem, RFC.
  - Each has a stable UUID and a version, and a format-corpus fixture.
  - They are read-only, and offered in the gallery under "Built in" and in the library with **Duplicate to customise**.
  - A workspace can hide any of them in its settings.

### Templates start personal and are shared on purpose

A template has an **audience**:

| Audience | Who sees it in the gallery | Default |
| --- | --- | --- |
| Only me | Its owner | Yes |
| Workspace | Everyone who can create documents in the workspace | |
| Unit | Everyone who can create documents in any workspace below the unit | |

- **Where the audience is recorded.** The audience is a **registration** in the settings documents: `.quill/workspaces/<id>.yaml` for a workspace and the unit's settings for a unit. That is where the plan (§25) already puts "template registration". It is not in the template's own front matter, so a Git push to the template cannot widen who sees it. Registrations are read through the versioned settings reader, and the registry the gallery queries is an index rebuilt from them.
- **One owner per template.** A template's owner is its `owner_id` (ADR-055), which starts as the person who made it.
- **Who may do what:**

  | Action | Who may do it |
  | --- | --- |
  | Make a template, Save as template, Duplicate, draft changes | `edit` on the workspace, so a contributor can too |
  | Publish a version | `publish` on the workspace, as for any revision (ADR-052). A contributor's template is published by asking for a review |
  | Use a template | `edit` on the workspace, and the template's audience includes you |
  | Change a private template | Its owner |
  | Change a shared template | Its owner, the maintainers its owner names, and anyone with `manage` on the workspace. A maintainer is a document-scope `editor` grant on the template, written through `createGrant` like any grant |
  | Share with the workspace | The owner, while they hold `publish` |
  | Share with a unit | `manage` on the unit. A workspace lead may offer a template to the unit, which the unit's administrators accept or decline. This reuses the request shape of ADR-045 and comes after sharing within a workspace |
  | Unshare or retire | The owner or `manage` on the workspace. A retired template leaves the gallery; the documents made from it are untouched |
  | Change the owner | The owner or `manage` on the workspace |

- **A workspace may tighten sharing later.** Its settings may set `templateSharing: open | moderated`, the default being `open`. Moderated sharing turns "Share with workspace" into a request a lead approves. It is not built first.
- **Why templates are stricter than documents.** ADR-055 keeps the wiki default for documents: every editor edits every page. A shared template is different. It is copied into every document made from it from then on, so one careless change reaches people who never opened it. That is the complaint against ClickUp's and Coda's open templates. Confluence's admin-only templates draw the opposite complaint. The answer is that anyone may make and share a template, and only the people accountable for a shared one may change it. Everyone else can duplicate it and make their own.

### Two verbs: publish a version, and share

- **Publish version N** releases what the author has drafted.
  - It is the publish path every document uses (draft in Postgres, one write to the content store, ADR-015), and it needs the `publish` capability like any revision (ADR-052). A contributor's template goes through a review request.
  - The version number increments.
  - **The template is validated first:** every `when` names a declared question; every declared section has a heading in the body; every question has a usable default or is optional; every `{{ answers.id }}` names a declared question; a title pattern refers only to declared answers and `sequence`.
  - A template that fails validation does not publish, and each failure is named and jumped to. This is the one place a template is enforced: a broken template harms everyone who uses it.
- **Share** sets the audience and is a separate action. A private template can have many published versions before anyone else sees it, and sharing does not publish.

The words stay apart in the interface: the template's button says **Publish v4**, and sharing lives in a **Share** dialog of its own.

### Editing a template looks and behaves unlike editing a document

Five cues carry the mode. Each works without the others, and colour is never the only one. The rules are in `docs/design/templates.md`.

1. **The address and the breadcrumb.** The library is `/w/<workspace>/templates`. A template's overview is `/w/<workspace>/templates/<template>`, showing a preview, versions, documents made from it, audience and maintainers. Its editor is `/w/<workspace>/templates/<template>/edit`. The breadcrumb reads *Workspace › Templates › Architecture decision record*.
2. **The template band.** A strip above the writing surface that cannot be dismissed. It is an inline status, not a toast or a dialog (`docs/design/feedback.md`), and is announced once as a landmark label. It contains:
   - a template icon and the word **Template**;
   - the state: "Editing v4 draft · v3 in use · Shared with Platform · Used by 41 documents";
   - **Try it** and **Publish v4**.
3. **The page.** A token family, `--template-*`, gives the writing surface a dashed edge and a faint tint in light and dark. It is checked for contrast like every token (`colour-rules.md`). It is applied by `data-kind="template"` on the editor root and never by a condition in a component (AGENTS rule 15).
4. **The fields and the panel.**
   - The title field is labelled **Template name**.
   - Below it, **Title for new documents** holds the title pattern.
   - The side panel is **Template setup** in place of the document's properties: questions (a form that writes the YAML), sections, stamped metadata, sequence, collection defaults and audience.
   - The YAML is still the source and still editable as Markdown, so nothing is locked into the form (ADR-029 rejected a builder format, and this is not one).
5. **The blocks.** Template machinery is drawn as what it is:

   | Block | In a template | In a document made from it |
   | --- | --- | --- |
   | `:placeholder[…]` | A labelled chip with a dashed edge; you are editing the prompt | A muted prompt your typing replaces |
   | `{{ answers.id }}` | A token naming the question | Already the answer |
   | `:::when{question=…}` | A dashed frame labelled "Only when *Touches security* = Yes", with a question picker | Never present: resolved at creation |
   | `:::repeat` | A dashed frame labelled "Repeats" | An "Add another" control after the last instance |
   | `:::optional` | A dashed frame labelled "Optional · offered as Add section" | An "Add section" control |
   | `:::guidance` | Editable text in a frame labelled "Guidance · shown to writers, removed at publish" | A hint the writer can dismiss |
   | Slash menu | Offers Placeholder, Guidance, Optional, Repeat, **Only when** and **Answer** | Offers none of them, so machinery cannot be added to a document by accident |

**Publishing a template states its effect.** For example: "New documents will start from v4. The 41 documents made from v1 to v3 will not change. Their authors will be offered *Rollback plan*, which v4 adds."

**Try it** asks the template's questions in a sheet and shows the draft they would produce, read-only, by running `resolveTemplate` in the browser. Nothing is created. The questions can be changed to see conditional sections come and go.

**On a document made from a template:**
- The bar reads "From template: ADR v4".
- The template panel holds the required-section checklist, the optional sections still on offer, the answers with **Change** beside each, and the line "Guidance and placeholders are removed when you publish".
- **Edit template** appears only to someone who may change it, and goes to the template's own route. A document never becomes a template editor in place.

### What the template declaration gains

Each addition below is additive under ADR-033: the declaration's readers accept every earlier shape.

- **`title`: a title pattern for new documents,** for example `"ADR-{{ sequence }}: {{ answers.subject }}"`. A title is text, so substituting into it stays inside ADR-029's boundary ("text, inline code, and code blocks"), which this ADR names explicitly: **the title is a text sink.**
- **`sequence`: a numbered series,** for example `{ key: adr, pad: 3 }`.
  - The number comes from a Postgres counter `template_sequences (workspace_id, key, next_value)`, taken in the same transaction that creates the document. Two templates that name the same key share a series.
  - Numbers are unique within the workspace and never reused. A draft that is deleted keeps its number, and the series has a gap.
  - The counter is operational state: it is rebuilt from the highest number found in the content store if lost (ADR-034).
- **`when` on a question,** so a follow-up ("Security reviewer") is asked only when an earlier answer makes it relevant. It uses the same expression as `when` on a section.
- **`$creator` as a default for a `user` question,** so "Decision owner" starts as the person creating the document.
- **`derivedFrom: { id, version }` on a template duplicated from another.** It is a record of where the template came from and carries no behaviour.

Unchanged: a document still records only `template: { id, version }` and its answers. A template's own `id` is never copied into a document.

### Choosing a template, and the defaults around it

- **The New document dialog becomes a two-step gallery.**
  - **Pick:** search, Blank, Recently used, the collection's default, then templates by category. The workspace's come first, then the unit's, then built-ins. Each shows a preview of its sections.
  - **Answer:** the questions in one form beside a live "You'll get" list of the sections and metadata the answers produce.
  - **Create and start writing** opens the editor, not the reading page, with the cursor in the first placeholder. Skipping the questions is always allowed: optional answers wait in the template panel.
- **A collection may name a default template** in the workspace settings document. The collection's **New** opens the gallery with that template chosen, and Blank stays one step away. `c` still makes a blank document.
- **Recently used templates** are kept per person in `person_preferences`, which is versioned.
- **A document that is still empty** offers **Start from a template** in its empty state, and the same two steps fill it.

### What happens after creation

These parts of ADR-029's lifecycle become concrete.

- **Changing an answer.** Sections controlled by `when` are added or removed only if the writer has not touched them since creation. Untouched is judged by a fingerprint of each resolved section, kept in the draft. That is a new field, so `DraftContent` moves to version 2 with a reader for version 1. A touched section is never removed. The writer is told it was left in place and can delete it themselves. Every change is one undo step.
- **A template gaining sections.** When a template publishes a version whose required or optional sections a document does not have, the document's template panel offers them ("ADR v4 adds *Rollback plan*. Add section"). Nothing is changed until the writer accepts, and accepting inserts the section with its placeholders where the template puts it.
- **Usage.** A template's overview lists the documents made from it, grouped by version, from `documents.template_id` and `template_version`. Search gains a `template:` filter.

### Worked example

**A template, as stored and as its author writes it** (`.quill/templates/architecture-decision-record.md`):

```markdown
---
id: 7f3c9a52-0d4e-4b6a-9a51-6c1f0f2e8b11
template:
  name: Architecture decision record
  category: Engineering
  version: 4
  title: "ADR-{{ sequence }}: {{ answers.subject }}"
  sequence: { key: adr, pad: 3 }
  questions:
    - { id: subject, label: What is being decided?, type: text }
    - { id: decisionOwner, label: Decision owner, type: user, default: $creator }
    - id: status
      label: Initial status
      type: choice
      options: [proposed, accepted]
      default: proposed
    - id: securityReview
      label: Does this touch authentication, data access, or secrets?
      type: boolean
      help: Adds a Security considerations section that the security team reviews.
    - { id: securityReviewer, label: Security reviewer, type: user, when: securityReview }
  sections:
    - { heading: Context, required: true }
    - { heading: Decision, required: true }
    - { heading: Security considerations, when: securityReview, required: true }
    - { heading: Consequences, optional: true }
  metadata:
    type: adr
    review: { interval: 365d }
---

## Context

:::guidance
Describe the forces at play: technical, political, and project constraints.
Link the incident or ticket that prompted this.
:::

:placeholder[What problem are we solving, and why now?]

## Decision

We will :placeholder[the change we're making], owned by {{ answers.decisionOwner }}.

:::when{question=securityReview}
## Security considerations

Reviewed by {{ answers.securityReviewer }}. :placeholder[Data touched, threats, mitigations]
:::

:::repeat{title="Add another option"}
## Option: :placeholder[name]

:placeholder[Pros, cons, cost]
:::

:::optional{title="Consequences"}
## Consequences

:placeholder[What becomes easier or harder]
:::
```

**In the template editor** the band reads "Template · Architecture decision record · Editing v4 draft · v3 in use · Shared with Platform · Used by 41 documents".
- Each placeholder is a dashed chip whose prompt is being edited.
- `{{ answers.decisionOwner }}` is a token labelled *Decision owner*.
- *Security considerations* sits in a frame labelled "Only when *Touches security* = Yes".
- The option and *Consequences* sit in frames labelled "Repeats" and "Optional".

**The draft created from it,** with the answers "Adopt RustFS for object storage", Chris Dyson, proposed, yes, Sam Lee, and sequence 42:

```markdown
---
id: 2b91c4de-5f63-4a8e-b0d7-3e9a1c6f4a20
title: "ADR-042: Adopt RustFS for object storage"
type: adr
status: proposed
owners: [chris]
review: { interval: 365d }
subject: Adopt RustFS for object storage
decisionOwner: chris
securityReview: true
securityReviewer: sam
requiredSections: [Context, Decision, Security considerations]
template: { id: 7f3c9a52-0d4e-4b6a-9a51-6c1f0f2e8b11, version: 4 }
---

## Context

:::guidance
Describe the forces at play: technical, political, and project constraints.
Link the incident or ticket that prompted this.
:::

:placeholder[What problem are we solving, and why now?]

## Decision

We will :placeholder[the change we're making], owned by Chris Dyson.

## Security considerations

Reviewed by Sam Lee. :placeholder[Data touched, threats, mitigations]

:::repeat{title="Add another option"}
## Option: :placeholder[name]

:placeholder[Pros, cons, cost]
:::

:::optional{title="Consequences"}
## Consequences

:placeholder[What becomes easier or harder]
:::
```

**In the document editor:**
- The chrome is the ordinary document's, with "From template: ADR v4" in the bar.
- Placeholders are muted prompts that typing replaces.
- The guidance is a hint with a close button.
- After the option is an "Add another option" control, and below it "Optional · Add section: Consequences".
- The template panel reads "1 of 3 required started" once Context has text.

**At publish**, if Decision and Security considerations still hold only placeholders, the summary says "2 required sections are still placeholders: Decision, Security considerations", with a link to each, and publishes when asked.

**The published Markdown** has no guidance and no placeholders. The option is an ordinary section, and Consequences is gone unless it was added. The front matter keeps `template`, the answers and `requiredSections`. Any other Markdown tool sees an ordinary ADR.

## Alternatives considered

- **Keep templates in a Templates collection (ADR-029 as written).** Rejected. A template would be readable as a page, found by search and published to the web, and its editing would look like any document's. The collection slug is a convention that a rename breaks.
- **Templates only in workspace settings, made by administrators** (Confluence). Rejected. Templates stop being made, and it is the complaint teams raise most.
- **Any editor changes any shared template** (ClickUp, Coda). Rejected. A typo reaches every future document, and nobody is accountable for it.
- **The audience in the template's front matter.** Rejected. A push to the template's file would widen who sees it, without the permission check that sharing needs. Who may see something belongs with grants and settings, never in content.
- **A separate template editor with its own format, or a builder.** Rejected again for ADR-029's reasons. The same editor in a distinct mode, with a form that writes the same YAML, gives the clarity without a second format.
- **Pushing template changes into existing documents.** Rejected. No product does it, and a writer's document is theirs. An offer that the writer accepts is the bounded version.
- **Colour alone to mark template editing.** Rejected. It is not accessible and does not survive a theme change. The band, the address, the fields, the panel and the blocks each say it in words.

## Consequences

- Templates leave the reading tree, search and the public site. The existing three seeded templates and five demo templates move to the library through the migration, and the old addresses redirect.
- `documents` gains `kind` (and, from ADR-055, `owner_id`; `created_by` exists from ADR-053). A new `template_sequences` table and a rebuildable template registry are added.
- `DraftContent` moves to version 2 for the section fingerprints.
- The editor gains:
  - a mode (`data-kind`);
  - node views for answer tokens and `when` frames;
  - mode-aware views for placeholders, guidance, optional and repeat;
  - two slash items, "Only when" and "Answer";
  - the Template setup panel.
- The template editor, the gallery and Try it are their own chunks. The reading route, at about 217 KB of its 250 KB budget, gains nothing.
- The template-only directives get their editor bindings declared through ADR-039's extension contract, so the conformance kit covers them.
- Phase 2 and phase 5 touch permissions, so each runs `docs/security/checklist.md`.

## Delivery

Layered, in M5. The first phase closes gaps in what is built and may land earlier as M3 or M4 polish.

1. **Make what exists visible.**
   - Creation opens the editor at the first placeholder.
   - The template panel uses `useTemplateProgress`.
   - The bar reads "From template".
   - The publish summary names unfinished required sections with a link to each.
   - The template slash group is hidden in documents.
   - A template fixture joins the format corpus.
   - `e2e/templates.spec.ts` proves use case 12.
2. **Kind, library and ownership.**
   - `documents.kind` and `owner_id`.
   - The `.quill/templates/` path.
   - Reading and moving the old Templates collection.
   - Templates left out of the tree, search and the public site.
   - Template services and routes.
   - ADR-055's owner rights.
3. **The template editor.**
   - Routes and breadcrumb, the band, the `--template-*` tokens and `data-kind`.
   - Template setup with the question form.
   - Mode-aware blocks.
   - `validateTemplate` and Publish vN with its effect stated.
   - Try it, and Save as template.
   - `e2e/template-authoring.spec.ts`.
4. **Gallery and defaults.**
   - The two-step gallery.
   - Recently used, collection defaults, and starting an empty document from a template.
   - `packages/templates` with Duplicate and hiding.
   - Title patterns and sequences.
5. **Sharing.**
   - Registrations and the Share dialog for templates.
   - Maintainers.
   - Unit audiences, which lift `createDocument`'s same-workspace read behind the audience check.
   - Retiring.
   - `e2e/template-sharing.spec.ts`.
   - Moderated sharing and offering to a unit follow.
6. **Evolve.**
   - Changing an answer with fingerprints.
   - Offering sections a template has gained.
   - The usage list and the `template:` search filter.
