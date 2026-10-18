import { ExternalIcon, ImageIcon, PencilIcon } from '@quill/ui'

import type { ContextMenuContribution, MenuEntry } from '../context-menu/context-menu-registry.ts'
import type { ImageAction } from './image-actions.ts'

/**
 * The picture's part of the context menu: replace it, describe it, open it
 * at full size, and whatever an extension offers on it — draw.io's "Edit
 * diagram" (ADR-043) — from the same actions the picture's own bar shows.
 */

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function imageMenu(actions: readonly ImageAction[]): ContextMenuContribution {
  return {
    id: 'image',
    order: 15,
    label: 'Image',
    entries: ({ state, pos, environment, editor }) => {
      const image = state.doc.nodeAt(pos)
      if (image?.type.name !== 'image') return []
      const src = text(image.attrs['src']) ?? ''
      const ref = { src, alt: text(image.attrs['alt']), title: text(image.attrs['title']), pos }
      const own: MenuEntry[] = actions
        .filter((action) => action.appliesTo(src))
        .map((action) => ({
          kind: 'action',
          id: `image-action-${action.id}`,
          label: action.label,
          icon: PencilIcon,
          run: () => {
            action.run(ref)
          },
        }))
      return [
        ...own,
        {
          kind: 'action',
          id: 'replace-image',
          label: 'Replace image…',
          icon: ImageIcon,
          disabledReason:
            environment.requestImage === undefined ? 'Pictures cannot be added here' : undefined,
          run: () => {
            environment.requestImage?.()
          },
        },
        {
          kind: 'action',
          id: 'alt-text',
          label: 'Alternative text…',
          run: () => {
            editor.editAltText(pos)
          },
        },
        {
          kind: 'action',
          id: 'open-image',
          label: 'Open in viewer',
          icon: ExternalIcon,
          disabledReason:
            environment.openLink === undefined || src === ''
              ? 'This picture cannot be opened here'
              : undefined,
          run: () => {
            environment.openLink?.(src)
          },
        },
      ]
    },
  }
}
