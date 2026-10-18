import type { Editor } from '@tiptap/react'
import { useEffect, useRef } from 'react'

import { useLinkPreviewSource } from '../blocks/link-preview-context.tsx'
import { createLiveTitles, liveTitleKey } from './live-titles.ts'

/**
 * Wires the live titles of links to documents (`live-titles.ts`) into an editor.
 *
 * Renders nothing. It synchronises two external systems: it adds the plugin to the
 * editor for as long as this is mounted, and it asks the editor to draw again when
 * the application's lookup changes, which it does as titles arrive. The lookup is
 * handed to the plugin through a ref because the plugin is built once.
 */
export function LiveLinkTitles({ editor }: { readonly editor: Editor }) {
  const source = useLinkPreviewSource()
  const latest = useRef(source)

  // Synchronises with the editor, an external system: the plugin is added while this is mounted.
  useEffect(() => {
    const plugin = createLiveTitles(() => latest.current)
    editor.registerPlugin(plugin)
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(liveTitleKey)
    }
  }, [editor])

  // Synchronises with the editor's drawing, which has to be told that the lookup it reads has changed.
  useEffect(() => {
    latest.current = source
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(liveTitleKey, 'redraw'))
  }, [editor, source])

  return null
}
