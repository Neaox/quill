# Guidance for AI coding agents

This file is read by AI agents working in this repository. Humans should read [CONTRIBUTING.md](CONTRIBUTING.md); everything there applies to agents too.

## Orientation

- The plan, decisions, and milestone order are in `quill-plan.md`. Part II is the decision register. Do not reverse a registered decision; propose an ADR instead.
- Layering rules are in `ARCHITECTURE.md` and enforced by `pnpm lint:deps`.
- ADRs are in `docs/architecture/decisions`. Research write-ups are in `docs/research`.

## Commands

```bash
pnpm check          # full quality gate; must be green before you say you are done
pnpm test:watch     # while iterating
pnpm test:e2e       # Playwright; needs `pnpm exec playwright install` once
pnpm dev            # server :3000, web :5173
```

## Rules

1. **Write the test first.** Then the implementation. Then refactor.
2. **Keep the domain pure.** `packages/domain` imports nothing from React, Fastify, Drizzle, or providers.
3. **Routes call application services.** Never storage.
4. **No `any`, no non-null assertions in production code, no type assertions to silence errors.**
5. **Erasable TypeScript only.** No enums, namespaces, or parameter properties; the runtime strips types natively. Use explicit `.ts` extensions in relative imports.
6. **`useEffect` synchronises with external systems.** If you are setting state from an effect to trigger other logic, stop and use an event handler or derived value.
7. **Every Markdown extension degrades.** Unknown front matter and directives survive round trips.
8. **Documents are addressed by ID, never by path.**
9. **Nothing above `ContentStore` knows about Git.** No repositories, trees, refs, or commits outside `packages/content-store`.
10. **Do not touch `spikes/` from package code.** Spikes are throw-away by design.
11. **Do not add dependencies casually.** Each new runtime dependency needs a reason in the pull request description.
11a. **Generated files are named `<name>.gen.<ext>`** (`schema.gen.d.ts`, `instrument.gen.css`, `routeTree.gen.ts`), carry a header naming the command that regenerates them, are never edited by hand, and are excluded from lint, format, and coverage by that pattern. The one exception is database migrations, which drizzle-kit names and journals itself and which are reviewed and owned once generated.
12. **Clean, DRY, idiomatic, self-documenting.** Native language features first: array methods, iterator helpers (`Iterator.prototype.map/filter/take` are native on Node 24), `structuredClone`, `Object.groupBy`, `Temporal` when stable. Reach for `remeda` when native code would be clumsy, and `rotery` for iterable and async-iterable pipelines. Write a small owned utility only when the same shape appears three times, and put it where the domain reads naturally, not in a `utils` dumping ground. lodash, underscore, and ramda are rejected by lint. Names carry meaning so comments explain *why*, not *what*.
13. **Performance is a requirement, not a follow-up.** Prefer lazy iteration over materialising arrays for large trees and result sets, stream large exports and imports, batch database access (never N+1), virtualise long lists, keep the initial web bundle within budget, and measure with the budgets in `quill-plan.md` section 31 before and after any change that touches a hot path.
14. **Semantic HTML and accessibility throughout.** Every rendered surface uses the right element for the job (`main`, `nav`, `article`, `section` with headings, `table` with `th` scope, `button` for actions, `a` for navigation, `figure` and `figcaption`, `kbd`, `time`), labelled controls, keyboard operability, visible focus, and no information carried by colour alone. Test with axe in component tests; it is part of done, not a later pass.
15. **Styling state and variation** (`docs/architecture/styling.md`). Interaction and accessibility states are real attributes (`disabled`, `aria-invalid`, `aria-busy`, `data-state`) styled with Tailwind variants (`disabled:`, `aria-invalid:`, `data-[state=open]:`); design variation (`variant`, `size`) is declared with `tailwind-variants` (`tv`, the `cva` API plus slots for multi-part components) and typed by `VariantProps`; `cx` is its `cn`; theme and identity are tokens and data attributes, never component logic. No conditional class strings in JSX for states that have an attribute, no `style` props for what a token can express.
16. **Reusable components, not one-off markup.** UI is composed from `packages/ui` primitives and feature components with clear props; if you find yourself copying markup, extract it. The same applies to server-rendered HTML: one template per concept, shared between the app, the public site, presentation mode, and export.
17. **No regressions after M2; full backward compatibility after version 1 (ADR-033).** Never weaken an end-to-end journey to make a change pass. Every bug fix adds its test. Every persisted format carries a version and every reader dispatches on it. Migrations are expand and contract. API changes within a version are additive only.
18. **Security to current standards (ADR-011).** OWASP ASVS and Cheat Sheets, NIST 800-63B, WebAuthn. Argon2id at the OWASP minimum, hashed tokens and session ids, `__Host-` cookies, `SameSite=Lax` plus fetch-metadata and origin checks, strict CSP with nonces, schema-validated input, server-side sanitised Markdown, an SSRF-safe outbound client, rate limits with backoff, audit without secrets. Any change touching auth, sessions, permissions, rendering, uploads, or outbound requests runs `docs/security/checklist.md` before it is done.
19. **Manage complexity with named patterns** (`docs/architecture/patterns.md`). Ports and adapters, factory plus strategy (`createX(config)` choosing an implementation; `XProvider.forWorkspace(id)` yielding per-key instances), registries for anything extensible, observers as `subscribe` returning the unsubscribe or as outbox consumers, use cases as commands, reducers with discriminated-union states, `Result` for expected failures, one composition root per process. Use the catalogue's naming so the pattern is recognisable from the name, say which pattern in the module doc when it is not, and do not introduce a pattern before the rule of three earns it. When a familiar approach and a novel one are otherwise equal, the familiar one wins; novelty must earn its place with substantial benefits and must document them where a reader will meet it.
20. **Do not commit or push unless asked.**

## When you finish

Run `pnpm check`. If any step fails, fix it or report the exact failure. Do not report success with a red gate.
