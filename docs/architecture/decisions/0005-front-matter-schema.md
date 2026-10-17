# ADR-005: Front matter schema

**Status:** Proposed, pending research R2
**Date:** 2026-09-12
**Related:** quill-plan.md section 16; ADR-002; decision D17

## Context

Document metadata (identity, title, owners, status, tags, review cycle, template-specific fields) must live with the document so Git sync and export carry it, while remaining validated and evolvable.

## Decision

- Metadata is YAML front matter validated by JSON Schema.
- A core schema is owned by Quill. Workspaces and templates may add fields under their own schemas. Schemas carry a version.
- The core schema includes `id` (UUID, required, never changed), `title`, `status`, `owners`, `tags`, `order`, and `review` (interval and last reviewed date). The exact list is settled in R2.
- Unknown fields are preserved and passed through untouched; validation warns but never discards.
- Schema forms in the UI are generated from the schema.

## Alternatives considered

- **Metadata only in Postgres.** Rejected: Git sync and export would lose it, and files would be meaningless outside Quill.
- **TOML or JSON front matter.** Rejected: YAML is the ecosystem convention (Jekyll, Hugo, Docusaurus, Obsidian).

## Consequences

- The identity rule of D17 has a concrete home.
- Externally synced files that lack an `id` are assigned one on import, which is a write back to the repository; R4 covers how that is done without surprising the author.

### Amendment (17 October 2026): publication, lifecycle and freshness are three questions

`status` used to hold `draft`, `published` or `archived`. Those are publication words, and publication is not something an author should state: the system knows whether a document has a published revision and whether its draft is ahead of it, and an author who forgets to change a word cannot make it wrong. Meanwhile the thing authors and owners do need to say, whether a page can be relied on, had no home. Three questions shared one field, and the answers come from different places:

| Question | Values | Set by | Shown as |
| --- | --- | --- | --- |
| Publication | Never published · Published · Published, with unpublished changes | The system, always, from the head revision and the draft | The header's state pill |
| Lifecycle (optional) | In review · Verified · Deprecated | The author or an owner | A lozenge in the byline; nothing when unset |
| Freshness | Review due · Review overdue | Computed from `review` | The byline, beside "Reviewed 3 months ago" |

**The lifecycle is front matter's `status`.** Its values are `in-review`, `verified` and `deprecated`, read by `documentFacts` in `@quill/domain` (its `lifecycle`; the vocabulary is `document-lifecycle.ts`), and it is optional: most documents never carry one. What a state carries sits beside it:

```yaml
status: verified
verified:
  by: ada@example.com   # an address, as owners are; stamped from the session, never typed
  at: 2026-10-02
```

```yaml
status: deprecated
supersededBy: 0b9c4f1e-…  # the replacement's id (decision D17, AGENTS.md rule 8); optional
```

- **Verified records who and when.** Choosing it stamps the signed-in person and today, and counts as a review: when the document has a review cycle, `review.lastReviewed` is set to today in the same change, so a page is never verified and lapsed in the same moment.
- **Verification lapses on its own.** When the review it promised falls overdue, every surface says "Verification lapsed" instead of "Verified" (`verificationLapsed`). Nothing is rewritten: the file still says `verified` and who and when, and a review brings it back.
- **Deprecated changes the page.** Readers get a notice under the byline, "This page is deprecated.", with a link to the replacement when they may open it; search ranks it lower (`RankingProfile.deprecatedPenalty`, ADR-010); and it cannot go straight to Verified (`canMoveLifecycle`), which is offered disabled with the reason.
- **"Needs update" is freshness, not a value.** It is computed from `review`: "Review due" in the fortnight before the date (`REVIEW_DUE_SOON_DAYS`), "Review overdue" after it.
- **Each change is one edit.** Choosing a lifecycle writes `status` and what it carries, and removes what the previous state carried, as one change of the front matter block, so one undo step (`writeLifecycle`).

**Back compatibility (rule 7, ADR-033).** A `status` an earlier release wrote (`draft`, `published`, `archived`), or a word nobody defined, survives every round trip byte for byte. It is never read as a lifecycle and never shown to a reader; the editor shows it read-only under "All properties" with a note that choosing a lifecycle replaces it, and clearing the lifecycle leaves it alone. The core schema accepts both vocabularies, so nothing an earlier release wrote starts warning. The API keeps the legacy `status` in `facts` (additive change only) and adds `lifecycle`; the envelope adds `unpublishedChanges`.

**No version bump.** Front matter has no format version of its own: it is an open record whose readers dispatch on the values they find, and every key here is new and optional. A file written before this amendment means exactly what it meant, except that a legacy `status` is no longer displayed. The search projection gains an optional `lifecycle` under the same rule its `summary` and `icon` followed, so `INDEXABLE_DOCUMENT_VERSION` stays 1; rows indexed before it rank as they did until the document is next published or reindexed. The cached body is unaffected: the byline and the notice are assembled per request (ADR-057).

**Out of scope, and where it will go.** Who may verify, review requests and approval workflows are a later milestone. The extension point is `canMoveLifecycle` and its caller in the properties editor: today any editor of the document may set any state but deprecated-to-verified; a policy that consults roles, or that turns "Verified" into "Request verification", replaces that one decision without changing the format.
