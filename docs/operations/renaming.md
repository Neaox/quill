# Renaming from the "Quill" code name

"Quill" is a code name (`quill-plan.md`, section 6). The name collides with
Quill.js, an established rich-text editor, so the product will ship under a
different name. This document describes the three pieces that make that
rename mechanical instead of a hunt-and-replace across the repository, and
the procedure for running it.

## Why this exists

A rename touches the npm scope, every workspace package name, every import
of those packages, UI text, page titles, container image and database
defaults, and a long list of documentation files. Done by hand, it is easy
to miss an occurrence, and easy to rewrite something that should not change
(a competing product's name, a historical planning document). The repository
is built so this is a single reviewed script run instead of a manual sweep:

1. **`packages/brand`** is the only place the product name, slug, and
   package scope are written in application or package source. Everything
   that displays or uses the name — page titles, headings, the health-check
   response, and so on — imports `BRAND` from `@quill/brand` rather than
   hardcoding a string.
2. **The `quill/no-brand-literal` lint rule** (`tools/oxlint-plugin/rules/no-brand-literal.js`)
   flags the code name as a whole word inside any string or template
   literal in linted source, excluding `packages/brand/**` itself, test
   and e2e files, generated files, and the plugin's own code. It fails
   the quality gate if the code name appears anywhere it shouldn't — in
   other words, it is the thing that keeps rule 1 true. It runs as part
   of `pnpm lint`.
3. **`pnpm rename`** (`scripts/rename.ts`) rewrites the package scope,
   imports, development defaults, and documentation to a new name in one
   pass.

## Why it must happen before Release 1

Some formats that carry the name are persisted and then frozen: the content
store's on-disk metadata directory and the database defaults (see
`quill-plan.md`, section 6). Once real content or data exists in those
formats under the "quill" slug, changing the slug is a data migration, not a
text replacement. **The rename must land before Release 1.** After that
point the cost of renaming goes from "run a script" to "write and test a
migration for every self-hosted deployment," which is why naming is called
out as an open question that blocks the milestone, not a cosmetic detail to
defer.

## What `no-brand-literal` enforces

The rule visits every string and template literal oxlint sees (so every
non-ignored `.ts`, `.tsx`, and `.js` file in the workspace), except:

- `packages/brand/**` — the brand module itself is allowed to define the
  name.
- `*.test.ts`, `*.test.tsx`, and `e2e/**` — tests may reasonably name the
  product, and use the slug as a Postgres user, temp-directory prefix, and
  similar fixture-only identifiers.
- `**/*.gen.*` — generated code is not hand-reviewed.
- `tools/oxlint-plugin/**` and `scripts/rename.ts` — the plugin's own
  namespace is the string "quill", and the rename script is what rewrites
  it.

Within the remaining files, any literal containing `quill`
(case-insensitive, whole word) is reported, *unless* it is an import
specifier or contains `@quill/<package>` — those occurrences are the
package scope, which the rename script updates mechanically; hand-editing
them is not the problem this check is for. Comments and identifiers are not
checked: only values that could reach a user, a file, or a database.

Documentation and `quill-plan.md` itself are exempt: prose can discuss the
naming situation by name, and `quill-plan.md` will never be renamed (see
below), so nothing should try to.

If you introduce a literal mention of the product name in application code,
`pnpm lint` will fail with the offending `file:line` and the rule id
`quill/no-brand-literal`. Import `BRAND` from `@quill/brand` and use
`BRAND.name`, `BRAND.slug`, `BRAND.scope`, or `BRAND.tagline` instead.

## Running the rename

1. Agree the new name, slug, and (if it differs from `@<slug>`) npm scope
   with whoever owns the decision — this is a one-way door in practice, so
   it should not be run speculatively.
2. From the repository root, do a dry run first:

   ```bash
   pnpm rename -- --name "New Name" --slug newname --dry-run
   ```

   This prints every file that would change and how many replacements it
   would make, without writing anything. Read it. A dry run that touches a
   file you did not expect (a vendored dependency, a fixture) is a sign to
   investigate before running for real.

3. Run it for real:

   ```bash
   pnpm rename -- --name "New Name" --slug newname
   ```

   Pass `--scope @newscope` if the npm scope should differ from `@<slug>`
   (for example if the slug is already taken on npm).

4. The script rewrites, in order: the npm scope (`@quill/` →
   `@newscope/`), the lowercase slug (`quill` → `newname`, whole word), the
   display name (`Quill` → `New Name`, whole word), and the shouty variant
   (`QUILL` → `NEWNAME`) if one is ever introduced. It updates
   `packages/brand/src/index.ts` — including flipping `codeName` to
   `false` — every `package.json`, `pnpm-workspace.yaml`,
   `docker-compose.yml` (including the doubled `MINIO_ROOT_PASSWORD`
   credential), `.env.example`, and the top-level docs
   (`README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `ARCHITECTURE.md`,
   `SECURITY.md`, `LICENSE`), plus everything under `docs/`, `.github/`,
   `e2e/`, `apps/`, and `packages/`.
   It deliberately leaves two things alone: `quill-plan.md` and
   `docs/archive/quill-plan-review.md` keep their filenames and content forever — they
   are the historical record of how the project was planned under the code
   name, and references to them by filename elsewhere in the repository are
   preserved rather than rewritten. It also leaves "Quill.js" alone
   wherever the ADRs discuss the unrelated third-party editor by that name.

5. Finish the manual follow-ups the script prints:
   - Rename the repository and its remote (GitHub, etc.) to match.
   - Rename the root directory on disk.
   - Run `pnpm install` to refresh the lockfile with the new package names.
   - Run `pnpm check`.
   - Search for anything left behind: `git grep -i newname` (sanity-check
     the count looks right) and `git grep -i quill` (should now return only
     `quill-plan.md`, `quill-plan-review.md`, and any remaining historical
     references inside them).

6. Review the diff as one change before merging. It touches a lot of files,
   but every hunk should be an obviously mechanical name substitution — if
   something else changed, that is a bug in the script, not an intentional
   edit to make alongside it.

## Testing the rename script itself

`scripts/rename.ts` accepts a `--root <dir>` option for exactly this: point
it at a scratch copy of a few representative files (or the whole tree) to
verify the replacements before ever running it against the real repository
without `--dry-run`. Never run a real (non-dry-run) rename against the
actual repository as a test — only to perform an intended rename.
