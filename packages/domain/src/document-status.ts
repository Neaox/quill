/**
 * Document lifecycle status.
 *
 * Kept as an extensible string union rather than a boolean so the review
 * workflow (milestone M6) can add states such as `in-review` without a
 * data migration (decision D12).
 */
export const DOCUMENT_STATUSES = ['draft', 'published', 'archived'] as const

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return typeof value === 'string' && (DOCUMENT_STATUSES as readonly string[]).includes(value)
}
