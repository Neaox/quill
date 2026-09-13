import { toString } from 'mdast-util-to-string'
import type { Root } from 'mdast'

import { rewriteTree } from '../tree.ts'
import type { Warning } from '../warnings.ts'
import { warning } from '../warnings.ts'
import { claims, isDirective } from './definition.ts'
import { guidanceDirective } from './guidance.ts'
import { optionalDirective } from './optional.ts'
import { placeholderDirective } from './placeholder.ts'
import { repeatDirective } from './repeat.ts'
import { whenDirective } from './when.ts'

export interface StrippedDocument {
  readonly ast: Root
  /**
   * One per placeholder still unfilled when the author published, and one per
   * `:::when` that reached publish without ever being resolved.
   */
  readonly warnings: readonly Warning[]
}

/**
 * Removes authoring scaffolding before publishing (ADR-029). Every template-only
 * block in that ADR's table has a case here, because a reader must never meet
 * machinery:
 *
 * - `:::guidance` is removed;
 * - `:placeholder` is removed and reported, one warning per prompt still unfilled;
 * - `:::optional` is unwrapped when the author added it and removed when not;
 * - `:::when` is removed with a warning — it is resolved at creation and on
 *   re-answer, so one that survived into a publish is a condition nothing ever
 *   decided, and publishing its body would show a reader content meant for
 *   someone who answered differently;
 * - `:::repeat` is unwrapped: ADR-029 publishes its instances as ordinary
 *   sections, which means the wrapper goes and the content stays.
 *
 * `:::notes` is deliberately *not* here: presenter notes stay in the published
 * source so presentation mode can read them, and are kept from readers by
 * `stripPresenterNotes`, which every rendering and extraction path applies.
 *
 * Publishing is never blocked by what this finds; the warnings are what the
 * publish summary states plainly and then publishes anyway.
 */
export function stripAuthoringBlocks(ast: Root): StrippedDocument {
  const warnings: Warning[] = []
  const stripped = rewriteTree(ast, (node) => {
    if (!isDirective(node)) return undefined
    if (claims(placeholderDirective, node)) {
      warnings.push(warning('placeholder-remains', toString(node)))
      return []
    }
    if (claims(guidanceDirective, node)) return []
    if (node.type !== 'containerDirective') return undefined
    if (claims(optionalDirective, node)) {
      const section = optionalDirective.parse(node)
      return section.added ? section.children : []
    }
    if (claims(whenDirective, node)) {
      const section = whenDirective.parse(node)
      warnings.push(warning('unresolved-condition', section.question))
      return []
    }
    if (claims(repeatDirective, node)) return repeatDirective.parse(node).children
    return undefined
  })
  return { ast: stripped, warnings }
}
