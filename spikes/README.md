# Spikes

Throw-away prototypes that de-risk a decision before it is made.

Rules:

- One directory per spike, named after its research item, for example `r4-content-store/`.
- A spike may have its own `package.json` and dependencies. It is not a workspace package and nothing in `apps/` or `packages/` may import it.
- Spikes are excluded from lint, format, coverage, and CI.
- Each spike has a `README.md` recording the question, what was tried, and the finding.
- When the related ADR is accepted, the finding moves into the ADR or a research write-up and the spike directory is deleted.
