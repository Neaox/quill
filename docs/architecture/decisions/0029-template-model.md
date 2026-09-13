# ADR-029: Template model

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md section 16 and milestone M5; ADR-002, ADR-005, ADR-006

## Context

Templates are first-class in the product vision, but the plan described them as scaffolds without saying how they are created, how optional and conditional content works, or how a template can shape a document's behaviour. They must stay Markdown so they are portable and Git-synced, and they must not leak authoring scaffolding into published documents.

## Decision

### A template is a starting point

A template exists to get an author to a good document quickly, and most documents created from one work as they are. It never constrains what the author does next: every section can be renamed, reordered, or deleted, every block edited or removed, and content added anywhere. Questions can be skipped if they are optional, and re-answered later. Nothing in a document remembers the template except the `template: { id, version }` record, which exists only so the author can be offered later improvements.

**"Required" is a business rule, visually indicated, not enforced.** A section marked required in a template usually reflects a real expectation of the team: an ADR without a Decision is not an ADR. The platform records that meaning and shows it, but does not police it for now:

- In the editor, a required section carries a small marker beside its heading, and the template panel's checklist shows which required sections still hold only a placeholder.
- At publish, the summary states plainly what is incomplete ("2 required sections are still placeholders: Decision, Security considerations") and publishes anyway.
- In the reading view and in document health signals, a published document with an unfilled required section shows it as a quiet quality indicator, the same family as "no owner" or "review overdue", never as an error.

The `required` flag keeps its semantics in the template schema and in the document's front matter, so a later option to enforce it, per template or per workspace, most likely alongside the review workflow, needs no migration.

### A template is a document

A template is a Markdown document with front matter, stored in a Templates collection, versioned like any document, edited in the same editor with template-only blocks enabled. It is scoped to a workspace or shared at an organisational unit. Built-in templates ship for ADR, technical design, runbook, postmortem, and RFC.

### Front matter declares questions, sections, and metadata

```yaml
template:
  name: Architecture decision record
  category: Engineering
  version: 3
  questions:
    - id: status
      label: Initial status
      type: choice
      options: [proposed, accepted]
      default: proposed
    - id: supersedes
      label: Does this supersede an earlier decision?
      type: document
      optional: true
    - id: securityReview
      label: Does this decision touch authentication, data access, or secrets?
      type: boolean
      help: Adds a Security considerations section that the security team reviews.
  sections:
    - heading: Context
      required: true
    - heading: Decision
      required: true
    - heading: Security considerations
      when: securityReview
      required: true
    - heading: Alternatives considered
      optional: true
  metadata:
    type: adr
    review:
      interval: 365d
```

- **Questions** have an id, label, type (`boolean`, `choice`, `text`, `date`, `document`, `user`), default, `optional`, and `help`. Answers become front matter fields on the created document and are validated by the document schema (ADR-005).
- **`{{ answers.id }}` substitutes into text, inline code, and code blocks, and nowhere else.** Not into a link's url or title, not into a directive's attributes, not into raw or unmodelled nodes. An answer is data a person typed into a form, and this is the boundary that keeps it data: into a text or code node it can only ever be the characters it is, whereas substituting into a url would let an answer choose where a link points and into an attribute would let it choose what a block does. The surface is deliberately narrow and widening it is a decision, not a detail.
- **Sections** are declared by heading, with `required`, `optional`, and `when` (a question id, or a small expression over answers).
- **Metadata** is stamped onto the created document: type, review interval, owners, layout, status, and any workspace field.

Questions control behaviour in four ways: which sections exist, which metadata is set, which defaults apply, and which capabilities are scaffolded (a runbook template's "is this for incidents?" adds a decision block from ADR-006).

### Template-only blocks

Directives that render as visible text outside Quill and are handled specially in the editor:

| Block | In the editor | At publish |
|---|---|---|
| `:placeholder[...]` inline, `:::placeholder` block | Muted prompt the author overwrites | Warning if any remain; removed |
| `:::guidance` | Dismissible hint for the author | Removed |
| `:::optional{title="..."}` | A ghosted "Add section" affordance, not content | Never published unless added |
| `:::when{question=...}` | Resolved at creation and on re-answer | Never present in a document |
| `:::repeat{title="..."}` | An "add another" section | Instances published as ordinary sections |
| `{{ answers.id }}` | Substituted at creation only | Never present in a document |

Required sections are marked beside their heading and tracked in the template panel's checklist. Publishing with a required section still at placeholder states what is incomplete, with a one-click jump to each, and proceeds; it is indicated, not enforced.

**Which step handles which block.** Creation (`resolveTemplate`) evaluates `:::when` and substitutes `{{ answers.id }}`, and touches nothing else — in particular it leaves `:::optional` exactly where it is, because the offer stands for as long as the author is drafting and resolving it at creation would withdraw it before it was ever made. Publish (`stripAuthoringBlocks`) is where the draft becomes a document: guidance and presenter notes are removed, placeholders are removed and reported, an optional section is unwrapped if it was added and removed if not, a `:::repeat` is unwrapped so its instances publish as ordinary sections, and a `:::when` that somehow survived is removed with a warning — a condition nobody ever decided must not show every reader content meant for one of them.

### Lifecycle

- **Create**: the "New document" gallery shows blank, recently used, and templates by category, with a preview. Choosing a template asks its questions in one form, then opens the scaffolded draft with the template panel showing the checklist, optional sections, and guidance.
- **Re-answer**: any question can be changed later from the template panel; affected `when` sections are added or removed without touching authored content, and removed content is kept in the draft's history for undo.
- **Evolve**: documents record `template: { id, version }`. When a template's required sections change, documents made from it show a non-blocking "template updated" notice with an offer to adopt the new sections.
- **Author templates**: "Save as template" from any document, or a new document in Templates. The template editor is the normal editor with template blocks enabled and a form editor for the questions. Templates are validated on publish: every `when` refers to a declared question, every declared section has a heading in the body, every question has a usable default or is optional.

## Alternatives considered

- **A separate template format (JSON or a builder UI).** Rejected: breaks portability and Git sync, and forces a second editor.
- **Runtime conditionals in published documents.** Rejected: readers would see machinery, and export would have to evaluate them. Conditions resolve at creation and re-answer.
- **A full templating language.** Rejected: `{{ answers.id }}` substitution and `when` expressions cover the need without turning documents into programs.

## Consequences

- The template blocks and the `template:` front matter schema are implemented in `packages/markdown` in M2 alongside the other directives, so the writing surface is designed with them from the start. The gallery, built-in templates, and template editor ship in M5.
- Guidance and placeholders are author-facing scaffolding and never reach a published revision, the public site, presentation mode, or export.
- Interactive capabilities (ADR-006) are scaffolded by templates rather than configured by hand.
