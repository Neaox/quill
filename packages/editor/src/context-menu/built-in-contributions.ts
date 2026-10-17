import { blockMenu } from '../block/block-context-menu.ts'
import { calloutMenu } from '../callout/callout-menu.ts'
import { codeBlockMenu } from '../code-block/code-block-menu.ts'
import { textMenu, turnIntoMenu } from '../format/text-menu.ts'
import { imageMenu } from '../image/image-context-menu.ts'
import type { ImageAction } from '../image/image-actions.ts'
import { linkMenu } from '../link/link-menu.ts'
import { tableMenu } from '../table/table-context-menu.ts'
import type { ContextMenuContribution } from './context-menu-registry.ts'

/**
 * Quill's own parts of the context menu, each from the feature that owns it.
 * An extension's or a feature's own are added after these
 * (`DocumentEditor`'s `contextMenuContributions`).
 */
export function builtInContextMenu(
  imageActions: readonly ImageAction[] = [],
): readonly ContextMenuContribution[] {
  return [
    linkMenu,
    imageMenu(imageActions),
    textMenu,
    turnIntoMenu,
    tableMenu,
    calloutMenu,
    codeBlockMenu,
    blockMenu,
  ]
}
