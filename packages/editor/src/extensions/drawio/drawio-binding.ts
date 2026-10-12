import { EDIT_DIAGRAM, drawioExtension } from '@quill/markdown/drawio'
import { DiagramIcon } from '@quill/ui'

import type { ImageAction, ImageRef } from '../../image/image-actions.ts'
import type { SlashContribution, SlashPlace } from '../../slash/slash-item.ts'
import { insertBlock } from '../../slash/slash-commands.ts'
import { nodeType } from '../../schema/node-type.ts'

/**
 * The draw.io extension's editor binding (ADR-039, ADR-043): its entry in the
 * slash menu and its action on a diagram's image, both named by the
 * extension's own declaration (`@quill/markdown/drawio`), so the reading and
 * writing surfaces say the same thing.
 *
 * This is the small part, in the editor's main chunk: what to offer and
 * where. Opening the draw.io editor is the application's, which loads the
 * session (`@quill/editor/drawio`) only when somebody asks for it.
 */

const insert = drawioExtension.editor.insert

/** Where a diagram, which is a block, can go: wherever a paragraph can. */
function blockFits(place: SlashPlace): boolean {
  return insertBlock((schema) => nodeType(schema, 'paragraph').create())(place.state)
}

export interface DrawioSlashOptions {
  /** Asks the application to open the draw.io editor for a new diagram. */
  onInsert(): void
  /**
   * Whether the instance has a draw.io editor to open, asked each time the
   * menu is: the answer can arrive after the editor is built.
   */
  enabled?(): boolean
}

/** "Draw.io diagram" in the slash menu; choosing it asks the application to open the editor. */
export function drawioSlashContribution({
  onInsert,
  enabled,
}: DrawioSlashOptions): SlashContribution {
  return {
    id: drawioExtension.id,
    items: () => [
      {
        id: 'drawio',
        label: insert.label,
        description: insert.description,
        group: 'Media and diagrams',
        keywords: insert.keywords,
        icon: DiagramIcon,
        available: (place) => (enabled?.() ?? true) && blockFits(place),
        run: () => {
          onInsert()
        },
      },
    ],
  }
}

export interface DrawioImageActionOptions {
  /** Whether an image's address is a draw.io diagram this writer can edit. */
  isDiagram(src: string): boolean
  /** The address to draw a diagram from, so a re-saved one is shown fresh. */
  displaySrc?(src: string): string
  /** Called when either answer may have changed; returns the unsubscribe. */
  subscribe?(listener: () => void): () => void
  onEdit(image: ImageRef): void
}

/** "Edit diagram" on an image that is a draw.io diagram. */
export function drawioImageAction(options: DrawioImageActionOptions): ImageAction {
  return {
    id: EDIT_DIAGRAM.id,
    label: EDIT_DIAGRAM.label,
    appliesTo: (src) => options.isDiagram(src),
    run: (image) => {
      options.onEdit(image)
    },
    ...(options.displaySrc === undefined ? {} : { displaySrc: options.displaySrc }),
    ...(options.subscribe === undefined ? {} : { subscribe: options.subscribe }),
  }
}
