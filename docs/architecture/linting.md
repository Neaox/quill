# What is enforced, and by what

A standard that only lives in a document decays. This is the map from every rule the project states to the mechanism that enforces it, so that "we do X" always has a "checked by Y". The order of preference for a new rule: a built-in oxlint rule, then a custom oxlint rule (an ESLint-style plugin in `tools/oxlint-plugin`), then the type checker, then dependency-cruiser for whole-graph rules, then a test, then a script. Scripts are the last resort because they run only in the gate; lint rules also run in the editor and can auto-fix.

## Enforced by oxlint built-in rules

| Rule | Mechanism |
|---|---|
| No `any`, no non-null assertions in production code, type-only imports | `typescript/no-explicit-any`, `typescript/no-non-null-assertion`, `typescript/consistent-type-imports` |
| No console output in application code | `no-console` (allowed in `scripts/`) |
| No import cycles | `import/no-cycle` |
| lodash, underscore, ramda, moment are rejected | `no-restricted-imports` |
| No I/O modules in the domain package | `no-restricted-imports` scoped to `packages/domain`: `node:fs`, `node:http`, `node:net`, `node:child_process`, `pg`, `fastify`, `react` |
| Kebab-case file names, PascalCase allowed for React components | `unicorn/filename-case` |
| React hooks discipline | `react/rules-of-hooks`, `react/exhaustive-deps` |
| Accessibility of JSX | the `jsx-a11y` plugin, plus scoped overrides where a role is deliberate |
| No focused or skipped tests reach the gate | `vitest/no-focused-tests`, `vitest/no-disabled-tests`, `vitest/expect-expect` |
| Side-effect imports only for stylesheets and test setup | `import/no-unassigned-import` |
| Node built-ins imported with the `node:` prefix | `unicorn/prefer-node-protocol` |
| Correctness and suspicious categories | enabled as errors; performance category as warnings |

## Enforced by custom oxlint rules (`tools/oxlint-plugin`)

Rules that express this project's own standards. Each has fixture-based tests.

| Rule | What it enforces | Source |
|---|---|---|
| `quill/no-brand-literal` | the code name never appears as a literal outside `packages/brand`; import `BRAND` instead | plan section 6 |
| `quill/tailwind-v4` | class strings in JSX, `tv()`, and `cx()` use Tailwind 4 spellings and bare forms; no arbitrary lengths on spacing, size, or text utilities; layout widths by variable | `styling.md` section 4 |
| `quill/classname-discipline` | a `className` (or `class`) attribute is a string literal, a `tv()` result, or `cx(...)` of string literals; no ternaries, logical expressions, or template interpolation that select classes from state | `styling.md` sections 1 and 2 |
| `quill/prefer-variant-classname` | `cx(variantCall(), className)` is redundant — a `tv()` variant or slot function merges `className` itself; call it as `variantCall({ className })` instead. Fixable | `styling.md` section 2 |
| `quill/no-style-prop` | the JSX `style` attribute is allowed only when every key is a CSS custom property (`--x`), which is how genuinely dynamic values such as positions reach CSS | `styling.md` |
| `quill/effect-needs-reason` | every `useEffect` and `useLayoutEffect` is immediately preceded by a comment naming the external system it synchronises | ADR-013, AGENTS rule 6 |
| `quill/no-set-state-in-effect` | no synchronous `setX(...)` call in the body of an effect (state used as a command bus); calls inside subscriptions and event callbacks are fine | ADR-013 |
| `quill/inject-system-dependencies` | `Date.now()`, `new Date()` without arguments, `crypto.randomUUID()`, and `Math.random()` — including `globalThis.`-prefixed access and `randomUUID`/`webcrypto` reached through a `node:crypto` import (aliases included) — only in the infrastructure adapters that implement `Clock` and `IdGenerator`, and in tests | ADR-021, `ports/system.ts` |
| `quill/no-pattern-suffix` | no type-level or PascalCase identifier ends in `Port`, `Strategy`, `Impl`, `Manager`, or `Helper`; no file named `utils`, `helpers`, or `misc` | `patterns.md` |
| `quill/tagged-todo` | a `TODO` or `FIXME` comment carries a tag in parentheses naming the milestone, ADR, or issue (`TODO(M5)`, `TODO(ADR-032)`) so nothing is left untracked | plan section 34 |
| `quill/no-secret-in-log` | a call on a logger with an argument, property, or template variable whose name contains `password`, `secret`, `token`, `cookie`, or `authorization` is an error | ADR-011 |
| `quill/no-relative-import-without-extension` | relative imports carry their `.ts` or `.tsx` extension, which native type stripping requires | ADR-025 |
| `quill/no-inert-control` | in `apps/web/**` only (`.oxlintrc.json` override; `packages/ui` is exempt), a `Button`/`button` with none of `onClick`, `type="submit"`, `disabled`, `loading`, `asChild`, or a spread, or an `a`/`Link` with no `href`/`to`, is an error | `docs/design/feedback.md`, "Nothing interactive is inert" |

## Enforced by the type checker

| Rule | Mechanism |
|---|---|
| Erasable syntax only: no enums, namespaces, parameter properties | `erasableSyntaxOnly` |
| Strictness: unchecked index access, exact optional properties, implicit override | the shared `tsconfig.base.json` |
| API additivity | the generated client's `paths` type in every feature that uses it; a non-additive route change fails to compile (ADR-033) |

## Enforced by dependency-cruiser (whole-graph rules)

| Rule | Mechanism |
|---|---|
| Layering: domain depends on nothing; application on domain and its ports; web never on infrastructure; server and web never on each other | `.dependency-cruiser.cjs` |
| No orphan modules | `no-orphans` |

## Enforced by tests and the gate

| Rule | Mechanism |
|---|---|
| Coverage thresholds that only rise | `vitest.config.ts` |
| Generated files are up to date (tokens, API client) | regenerate-and-compare tests |
| Every syntax token class a grammar can emit is themed | the coverage test in `packages/ui` |
| Persisted formats readable forever | the format corpus (ADR-033) |
| Journeys never regress | the Playwright suite on every pull request |
| OpenAPI is additive within a version | the OpenAPI diff step in CI (ADR-033) |
| Migrations are expand and contract | the migration lint step in CI (ADR-033) |
| Rendered Markdown never executes | the adversarial corpus in `packages/markdown` |

## Enforced by scripts (last resort)

| Rule | Mechanism |
|---|---|
| Tailwind 4 conventions in CSS files (`@tailwind`, `theme()`, `@layer utilities`, `@apply` contents) | `scripts/check-tailwind.ts`, CSS part only; the TypeScript part moved to `quill/tailwind-v4` |

## Deliberately not enforced by tooling

Some standards are judgement and stay in review: the rule of three before a pattern or utility is introduced, whether a novel approach earns its cost, whether a component boundary is meaningful, whether a comment explains why rather than what, and whether a name is honest. A lint rule for these would produce false confidence. They are in `CONTRIBUTING.md` and in the code review heuristics in the plan.
