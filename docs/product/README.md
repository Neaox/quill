# Product

This folder is the product owner's side of the plan. `quill-plan.md` says what
will be built and in what order; these documents say what a person is trying to
do, and how we will know they can do it.

Everything here is written from outside the code. A use case names a person, a
situation, and a job. It does not name a package, a table, or a component.

## The documents

| Document | What it holds |
| --- | --- |
| [`personas.md`](personas.md) | The actors: their goals, what they must never be able to do, and the surfaces they meet |
| [`use-cases.md`](use-cases.md) | Every use case, with acceptance criteria, milestone, and the journey that proves it |
| [`surfaces.md`](surfaces.md) | The places the product exists: who reaches each one, and what must never appear there |

## How a feature gets built

Every feature starts as a use case here. It is not ready to build until four
things are written down.

1. **The job.** One sentence, in the person's words, saying what they are
   trying to achieve. If it cannot be said in one sentence, it is two use
   cases.
2. **The flow.** Numbered steps as the person experiences them. Clicks and
   screens, not calls and queries.
3. **Acceptance criteria.** Given/When/Then, phrased so an end-to-end journey
   can assert them. A criterion nobody can automate is a criterion nobody will
   check.
4. **The trace.** The milestone that ships it, and the journey spec in `e2e/`
   that proves it. Where the spec does not exist yet, the use case names the
   file it will be, so the gap is visible.

The journey suite is the regression suite (ADR-033). A journey is added or
deliberately retired; it is never weakened so that a change can pass. So the
trace is not paperwork: it is the thing that stops a shipped use case from
quietly stopping working.

## How acceptance is phrased

Acceptance is asked of the running product, and answered only by doing the
thing through the interface. The model is M2's question, from the plan:

> Can I add new workspaces, add new docs, nest them, move things around,
> create folders, update documents, all in a clean and intuitive way?

Three properties make that a good acceptance question, and they are what to
copy.

- **It is asked of a person, not of a system.** "Can I", not "does the API
  support".
- **It is answered yes or no.** Not a score, not a percentage of tests
  passing.
- **It includes the quality bar in the question.** "In a clean and intuitive
  way" is part of what is being asked, so a technically complete but awkward
  flow is a no.

Every milestone gets one such question. The use cases underneath it are how the
question is decomposed; the journey spec is how the answer is kept true after
the day it was first given.

## Honesty about status

Each use case carries its milestone. The plan's Delivery status table is the
single source of truth for what actually exists today, and the use cases here
mark built, in progress, or planned against it. Nothing in this folder should
read as though a planned thing already works.

When the plan's status table and a use case here disagree, the plan wins, and
the use case is wrong and should be corrected.
