import type { DocumentId, ShortId } from '@quill/domain'

import type { DocumentRepository } from '../ports/persistence.ts'
import {
  canonicaliseDocumentLinks,
  parseDocumentReference,
  workspaceLinkReferences,
} from './document-path.ts'

/**
 * Links inside a document stay canonical (ADR-035).
 *
 * A reader who copies an address out of the bar pastes
 * `/w/engineering/d/the-title-k7m3q9v2xd`, which carries a workspace and a
 * title that will both be wrong one rename from now. The canonical form,
 * `/d/<uuid>`, is what the link index and backlinks understand and what never
 * goes stale (ADR-031), so the publish path rewrites the one into the other
 * and the author never has to think about it.
 *
 * Resolution is one query however many links a body carries, and a key that
 * names nothing is left exactly as it was: a broken link stays a broken link
 * the health signal can report, rather than quietly becoming a different one.
 */
export async function canonicaliseLinks(
  documents: DocumentRepository,
  markdown: string,
): Promise<string> {
  const references = [...workspaceLinkReferences(markdown)]
  if (references.length === 0) return markdown
  return canonicaliseDocumentLinks(markdown, await resolveReferences(documents, references))
}

/** Each reference text mapped to the document it names, leaving out the ones nothing names. */
async function resolveReferences(
  documents: DocumentRepository,
  references: readonly string[],
): Promise<ReadonlyMap<string, DocumentId>> {
  const resolved = new Map<string, DocumentId>()
  const byKey = new Map<ShortId, string[]>()

  for (const reference of references) {
    const parsed = parseDocumentReference(reference)
    if (parsed === null) continue
    // A UUID already names the document unambiguously; only the shape changes.
    if (parsed.kind === 'uuid') {
      resolved.set(reference, parsed.documentId)
      continue
    }
    byKey.set(parsed.shortId, [...(byKey.get(parsed.shortId) ?? []), reference])
  }
  if (byKey.size === 0) return resolved

  const rows = await documents.listByShortIds([...byKey.keys()])
  const ids = new Map(rows.map((row) => [row.shortId, row.id]))
  for (const [key, texts] of byKey) {
    const id = ids.get(key)
    if (id === undefined) continue
    for (const text of texts) resolved.set(text, id)
  }
  return resolved
}
