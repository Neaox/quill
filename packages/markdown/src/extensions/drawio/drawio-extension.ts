import { BRAND } from '@quill/brand'
import { defineExtension } from '../contract.ts'
import { isDrawioDrawing, renderDrawioDrawing } from './drawio-svg.ts'

/**
 * draw.io diagrams (ADR-043): the reference extension (ADR-039).
 *
 * The diagram is the file and the file is an image: Markdown names a
 * `.drawio.svg` attachment the way it names any picture, so it degrades to an
 * image everywhere, GitHub included. What this extension adds is how such a
 * file is drawn on the reading surface (`drawio-svg.ts`) and, on the writing
 * surface, the editor binding: an insert entry for the slash menu and an
 * "Edit diagram" action on the image, both of which open the draw.io editor
 * (`packages/editor/src/extensions/drawio`).
 *
 * Its grant is two data attributes and nothing else: the SVG goes through the
 * platform's drawing allowlist like any other, and the fallback is the
 * platform's own `<img>`.
 */
export const DRAWIO_EXTENSION_ID = `${BRAND.slug}.drawio`

/** The action on a diagram's image that the editor binds to the draw.io editor. */
export const EDIT_DIAGRAM = { id: 'edit-diagram', label: 'Edit diagram' } as const

export const drawioExtension = defineExtension({
  id: DRAWIO_EXTENSION_ID,
  version: '1.0.0',
  syntax: { kind: 'drawing', claims: isDrawioDrawing },
  render: renderDrawioDrawing,
  sanitize: {
    drawing: { data: ['data-drawio'] },
    image: { data: ['data-drawio-legacy'] },
  },
  editor: {
    view: 'image',
    insert: {
      label: 'Draw.io diagram',
      description: 'Draw a diagram in the draw.io editor',
      keywords: ['drawio', 'draw.io', 'diagram', 'diagrams.net', 'flowchart', 'architecture'],
    },
    actions: [EDIT_DIAGRAM],
  },
})

/** A file name a draw.io diagram is saved under: `.drawio.svg`, or the raw `.drawio`. */
const DRAWIO_FILENAME = /\.drawio(?:\.svg)?$/i

export function isDrawioFilename(filename: string): boolean {
  return DRAWIO_FILENAME.test(filename)
}

/**
 * The name a diagram is saved under: the alternative text as a slug, or
 * `diagram`, always ending `.drawio.svg` so draw.io, VS Code and GitHub
 * recognise it.
 */
export function drawioFilename(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z\d]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return `${slug === '' ? 'diagram' : slug}.drawio.svg`
}
