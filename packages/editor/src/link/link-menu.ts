import { CopyIcon, ExternalIcon, PencilIcon, UnlinkIcon } from '@quill/ui'

import type { ContextMenuContribution } from '../context-menu/context-menu-registry.ts'
import { linkAt, unlink } from './link-commands.ts'

/** The context menu over a link: open it, edit it, copy where it goes, or take it off. */
export const linkMenu: ContextMenuContribution = {
  id: 'link',
  order: 10,
  entries: ({ view, state, pos, environment, editor }) => {
    const link = linkAt(state, pos)
    if (link === undefined) return []
    return [
      {
        kind: 'action',
        id: 'open-link',
        label: 'Open link',
        icon: ExternalIcon,
        disabledReason:
          environment.openLink === undefined ? 'Links cannot be opened here' : undefined,
        run: () => {
          environment.openLink?.(link.href)
        },
      },
      {
        kind: 'action',
        id: 'edit-link',
        label: 'Edit link',
        icon: PencilIcon,
        run: () => {
          editor.editLink()
        },
      },
      {
        kind: 'action',
        id: 'copy-link',
        label: 'Copy link address',
        icon: CopyIcon,
        disabledReason:
          environment.copyText === undefined ? 'The clipboard is not available here' : undefined,
        run: () => {
          void environment.copyText?.(link.href)
        },
      },
      {
        kind: 'action',
        id: 'unlink',
        label: 'Unlink',
        icon: UnlinkIcon,
        run: () => {
          unlink(link.from, link.to)(view.state, view.dispatch)
          view.focus()
        },
      },
    ]
  },
}
