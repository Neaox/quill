# ADR-026: Licence and naming

**Status:** Accepted for licence; naming open
**Date:** 2026-09-12
**Related:** quill-plan.md section 6 and Part VII; decision D1

## Context

The project must choose a licence before the repository is public, and the name "Quill" collides with Quill.js, an established rich-text editor.

## Decision

- The whole codebase is licensed under the **MIT License**. There is no open-core split; enterprise features ship under the same licence.
- The copyright line reads "Quill contributors".
- **Naming is open.** Because Quill.js is not the editor used (ADR-003), the collision is a product naming and trademark matter. It must be settled before the repository is made public; renaming after that point has real cost.

## Alternatives considered

- **AGPL.** Rejected: discourages adoption by the organisations most likely to contribute, and the project does not need copyleft to protect a hosted business it does not plan.
- **Apache 2.0.** Viable; MIT chosen for simplicity and consistency with the JavaScript ecosystem.
- **Open core with a commercial licence for enterprise features.** Rejected by decision D1.

## Consequences

- Contributions are accepted under MIT without a contributor licence agreement.
- A name decision is tracked as open question 1 in the plan. Until then, "Quill" is a working name and the package scope `@quill/*` is internal.
