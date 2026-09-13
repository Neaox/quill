export interface DocumentIdAssignment {
  readonly frontMatter: Record<string, unknown>
  /** True when this call created the identifier, so the file needs writing back. */
  readonly assigned: boolean
}

/**
 * Gives a document an identifier if, and only if, it does not have one. An `id`
 * is never changed once written: it survives rename, move, and Git sync
 * (decision D17), so a file imported from a repository is stamped on import and
 * left alone from then on.
 *
 * `generate` is the caller's `IdGenerator` (an application port): this package
 * never reads system randomness itself, so the identifier a document receives
 * is decided at the composition root and is deterministic in tests.
 */
export function ensureDocumentId(
  frontMatter: Record<string, unknown>,
  generate: () => string,
): DocumentIdAssignment {
  const current = frontMatter['id']
  if (typeof current === 'string' && current.length > 0) {
    return { frontMatter, assigned: false }
  }
  const next: Record<string, unknown> = { id: generate() }
  for (const [key, value] of Object.entries(frontMatter)) {
    if (key !== 'id') next[key] = value
  }
  return { frontMatter: next, assigned: true }
}
