/**
 * The accounts the development seed (`seed.ts`) writes, and their known
 * passwords. Kept apart from the seed itself so that tooling which only needs
 * to *tell a developer who to sign in as* — `scripts/dev-all.ts` — does not
 * have to load the seed's whole dependency graph to read four strings.
 */

export const ADMIN_EMAIL = 'admin@example.com'
export const ADMIN_PASSWORD = 'admin-password-change-me'

/** A second account, an editor rather than an instance admin (ADR-012). */
export const WRITER_EMAIL = 'writer@example.com'
export const WRITER_PASSWORD = 'writer-password-change-me'
