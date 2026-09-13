/**
 * Brand constants: the product name, slug, and package scope.
 *
 * This module is the only place these values are written in application or
 * package source (see the plan document, section 6). The `no-brand-literal`
 * lint rule in `tools/oxlint-plugin` fails the quality gate if the code name
 * appears anywhere else. `pnpm
 * rename` rewrites this file, along with the rest of the repository, when
 * the product is renamed; see `docs/operations/renaming.md`.
 */
export const BRAND = Object.freeze({
  /** Display name, used in UI text, page titles, and documentation. */
  name: 'Quill',
  /** Lowercase identifier: package scope, container image, and database defaults. */
  slug: 'quill',
  /** npm package scope. */
  scope: '@quill',
  tagline: 'Markdown underneath. Beautiful on top.',
  /** False once the product has its final name. */
  codeName: true,
})

export type Brand = typeof BRAND
