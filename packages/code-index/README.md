# @quill/code-index

The portable half of the code and schema reference index (ADR-065): the
versioned artifact, the cache, the Git file set, and the first extractor.

It is deliberately a **spike**, not a finished feature. It answers the first
question of M6a: can Quill build a deterministic, versioned index of its own
TypeScript with the compiler it already runs, without a second compiler or a
new dependency?

## What it owns

- **`artifact.ts`** — `CodeIndexArtifactV1`, a deterministic JSON document of
  packages, files, symbols, usages and doc comments. The format carries a
  version; a reader refuses one it has not shipped. Encoding sorts files,
  symbols and usages so two runs over the same corpus are byte-identical.
- **`cache.ts`** — the cache key (tool, compiler, tsconfig, scope, format),
  the per-file blob plan, and effective signatures through re-exports. A file
  is extracted again when its blob changes; its importers follow when a
  signature moves.
- **`git.ts`** — the worktree file set, blob SHAs from the index and from disk,
  HEAD, commits behind, and the GitHub slug. Arguments are arrays, never a
  shell.
- **`typescript/`** — the compiler-API extractor: top-level functions, consts,
  classes, types and interfaces; resolved signatures and parameters; JSDoc
  tags and descriptions; visibility; line ranges; cyclomatic complexity; and
  the identifier scan that finds usages without a second pass over the
  repository.
- **`typescript/build.ts`** — the first build function. The caller chooses the
  corpus, so a test can index one module and the CLI can index the repository.

## What it deliberately does not own

- The schema extractor. It is the next slice; the artifact has the shape for
  it, but no database reading happens here.
- The server, the pages, search, permissions and references. They belong to
  the application and web layers.
- A watch mode, a hosted index or a language other than TypeScript.
- Member-level symbols: a class is one symbol today, as in the local spike it
  came from; methods and properties are the next extraction slice.

## Why this shape

The first prototype's local index proved the compiler API, the blob cache and
the identifier scan: 9,103 symbols over the whole non-UI repository in 17
seconds cold and 1.2 seconds warm, with 99.97% agreement against the
compiler's own find-references. This package is that work lifted behind an
artifact contract, not a second parser. The compiler is the one `pnpm
typecheck` already runs, and the artifact is what a CI job can upload and a
server can ingest without a language toolchain.
