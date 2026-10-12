import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import type { DocumentMerge } from './merge-documents.ts'
import { mergeDocuments } from './merge-documents.ts'

export type MarkdownMerge =
  | { readonly clean: true; readonly markdown: string }
  | { readonly clean: false; readonly merge: DocumentMerge }

/**
 * The same merge over Markdown text, for the publish path (plan section 9) and
 * Git sync, which hold documents as files rather than trees.
 *
 * Where one side changed nothing the other side's bytes come back untouched.
 * Otherwise the three are parsed with the one processor, merged as trees, and
 * the result written with the one serialiser — which writes an untouched
 * block exactly as it read it (ADR-002), so a merge moves only the bytes of
 * what was edited.
 */
export function mergeMarkdown(base: string, mine: string, theirs: string): MarkdownMerge {
  if (mine === base || mine === theirs) return { clean: true, markdown: theirs }
  if (theirs === base) return { clean: true, markdown: mine }
  const merge = mergeDocuments(parseMarkdown(base), parseMarkdown(mine), parseMarkdown(theirs))
  return merge.conflicts.length === 0
    ? { clean: true, markdown: stringifyMdast(merge.merged) }
    : { clean: false, merge }
}
