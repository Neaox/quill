import { useMemo } from 'react'

import type { DocumentAst } from '../document-ast.ts'
import { templateProgress } from './progress.ts'
import type { TemplateProgress } from './progress.ts'

/**
 * The template checklist for a document, recomputed only when the AST changes.
 *
 * The panel that shows it belongs to the web application; this is the state it
 * renders. Deriving it here rather than holding it in state is deliberate — there
 * is no second copy of the answer to go stale (ADR-013).
 */
export function useTemplateProgress(ast: DocumentAst): TemplateProgress {
  return useMemo(() => templateProgress(ast), [ast])
}
