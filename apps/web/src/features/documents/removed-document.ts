import { ApiError } from '../../lib/api/index.ts'

/**
 * A page whose file left its repository, as the API says so (ADR-061,
 * ADR-046): `410 document_removed`, with the page's title, when and in which
 * commit it was removed, and the page its old path now leads to when the
 * reader may open that one.
 */
export interface RemovedDocument {
  readonly title: string
  readonly removedAt: string
  readonly revision: string | null
  readonly replacement: {
    readonly id: string
    readonly shortId: string
    readonly title: string
  } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The removal an API error describes, or null for any other error. */
export function removedDocument(error: unknown): RemovedDocument | null {
  if (!(error instanceof ApiError) || error.status !== 410 || error.code !== 'document_removed') {
    return null
  }
  const details: unknown = error.details
  if (!isRecord(details) || typeof details['title'] !== 'string') return null
  const replacement = details['replacement']
  return {
    title: details['title'],
    removedAt: typeof details['removedAt'] === 'string' ? details['removedAt'] : '',
    revision: typeof details['revision'] === 'string' ? details['revision'] : null,
    replacement:
      isRecord(replacement) &&
      typeof replacement['id'] === 'string' &&
      typeof replacement['shortId'] === 'string' &&
      typeof replacement['title'] === 'string'
        ? { id: replacement['id'], shortId: replacement['shortId'], title: replacement['title'] }
        : null,
  }
}
