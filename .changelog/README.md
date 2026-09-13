# Changelog fragments

`CHANGELOG.md` is assembled, not edited by hand. A pull request that changes
runtime behaviour under `apps/` or `packages/` adds one file here instead of
adding a line to `CHANGELOG.md` directly, so two unrelated pull requests
never conflict on the same lines. This is the same shape
[Overcast](https://github.com/overcast-sh/overcast) uses for its
`.changelog/` fragments, simplified for a pre-1.0, single-repo project (see
the deviations noted in `scripts/changelog.ts`'s doc comment).

## Adding a fragment

Create a file named:

```text
.changelog/<YYYYMMDD>-<slug>.md
```

- `YYYYMMDD` is the UTC date you add the file.
- `<slug>` is a short, lowercase, hyphenated description (letters, digits,
  hyphens only), for example `search-comment-index`.

Its content is one or more lines, each in the form:

```text
<Category>: <prose sentence>
```

`<Category>` is exactly one of, spelled as shown:

```text
Added
Changed
Deprecated
Removed
Fixed
Security
```

These are [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)'s
categories. A fragment may have several lines if one pull request touches
more than one category. Blank lines are ignored.

Example (`.changelog/20260912-comment-search.md`):

```text
Added: Workspace search now indexes comment bodies as well as document text.
Fixed: Publishing a document no longer drops its table of contents.
```

## When a fragment is needed

Any pull request that changes shipped behaviour under `apps/` or
`packages/`: a new feature, a user-visible bug fix, a config change, a
performance change. Not needed for CI-only changes, test-only changes,
tooling under `scripts/` or `tools/`, or refactors with no observable
effect. CI (`pnpm changelog:check` plus a pull-request-only step) enforces
the format always, and enforces presence of a fragment only when the diff
touches `apps/` or `packages/` — see `CONTRIBUTING.md`.

## Validating and releasing

```bash
pnpm changelog:check            # fails if any fragment is malformed
pnpm changelog:release <version>  # assembles fragments into CHANGELOG.md and deletes them
```

`release` groups every fragment's entries by category, in the fixed order
above, under a new `## [<version>] - <date>` heading inserted just below
`## Unreleased` in `CHANGELOG.md`, then deletes the fragment files it used.
Running it again with no new fragments does nothing (there is nothing left
to collect) — see `scripts/changelog.ts`.
