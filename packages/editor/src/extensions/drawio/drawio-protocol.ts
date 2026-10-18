import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import { jsonStringCodec } from '../../embedded-frame/frame-channel.ts'

/**
 * draw.io's embed protocol, as Quill speaks it (ADR-043).
 *
 * The editor is opened at `?embed=1&proto=json`, which makes every message a
 * JSON string in both directions (https://www.drawio.com/doc/faq/embed-mode).
 * This module is the protocol adapter for the generic frame channel
 * (`../../embedded-frame`): the URL, the sandbox, the messages draw.io may
 * send — as TypeBox schemas, so a message of any other shape is dropped — and
 * the actions Quill sends back. Nothing else in Quill knows draw.io's protocol.
 *
 * Verified against draw.io 32.4 (`jgraph/drawio:32.4.1`):
 *
 * - With `configure=1` draw.io first sends `configure` and waits for the
 *   `configure` action before it sends `init`; `init` asks for `load`.
 * - `save` carries the diagram as XML; `exit: true` when "Save & Exit" was
 *   pressed. draw.io clears its own "modified" flag as it sends `save`, so a
 *   save that then fails sets it again with `status`.
 * - `export` with `format: 'xmlsvg'` answers with the SVG — as text with
 *   `asText: true`, otherwise a data URI — carrying the diagram in its
 *   `content` attribute: the `.drawio.svg` form.
 * - "Convert labels to SVG" is not an export option in draw.io 32 but a cell
 *   style, `convertToSvg=1` (`mxCellRenderer`, `Format.js`). So the source is
 *   converted as it is loaded (`editableDrawioSource`), new shapes and lines
 *   take it from the configured default styles where draw.io applies them.
 *   A shape from the sidebar brings its own style, though, so a save whose
 *   diagram still has an HTML label converts it and `load`s the result before
 *   asking for the export. (`merge` would keep the view, but draw.io resolves
 *   a shape added since the load in favour of its own copy, so it is not
 *   enough.) A save with nothing to convert exports at once. A label draw.io
 *   cannot write as SVG text
 *   (vertical text) still comes out as `foreignObject`, and the reader then
 *   shows that file as an image (`@quill/markdown/drawio`).
 * - `exit` is sent by the editor's own Exit button, after draw.io has asked
 *   about unsaved changes itself.
 */

/** Every message draw.io sends that Quill acts on. Extra fields draw.io adds are allowed and ignored. */
export const DrawioInbound = Type.Union([
  Type.Object({ event: Type.Literal('configure') }),
  Type.Object({ event: Type.Literal('init') }),
  Type.Object({ event: Type.Literal('load') }),
  Type.Object({ event: Type.Literal('autosave'), xml: Type.String() }),
  Type.Object({
    event: Type.Literal('save'),
    xml: Type.String(),
    exit: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    event: Type.Literal('export'),
    format: Type.Literal('svg'),
    data: Type.String(),
  }),
  Type.Object({ event: Type.Literal('exit'), modified: Type.Optional(Type.Boolean()) }),
])

export type DrawioMessage = Static<typeof DrawioInbound>

/** Every action Quill sends draw.io. */
export type DrawioAction =
  | { readonly action: 'configure'; readonly config: DrawioConfiguration }
  | {
      readonly action: 'load'
      readonly xml: string
      /** Asks for an `autosave` message on each change, which is how Quill knows there are unsaved ones. */
      readonly autosave: 1
      // No `title`: draw.io sets it over its own menu bar, where on a phone
      // it collides with the menus; the frame's own bar names the editor.
    }
  | {
      readonly action: 'export'
      readonly format: 'xmlsvg'
      /** The SVG as text rather than a data URI. */
      readonly asText: true
      /** Fonts are the reader's (the allowlist removes `@font-face`), so none are embedded. */
      readonly embedFonts: false
      readonly spinKey: 'saving'
    }
  | { readonly action: 'status'; readonly modified: boolean; readonly message?: string }
  | { readonly action: 'spinner'; readonly show: false }

export interface DrawioConfiguration {
  /** Every new shape and line writes its label as SVG text (see above). */
  readonly defaultVertexStyle: { readonly convertToSvg: '1' }
  readonly defaultEdgeStyle: { readonly convertToSvg: '1' }
}

export const DRAWIO_CONFIGURATION: DrawioConfiguration = {
  defaultVertexStyle: { convertToSvg: '1' },
  defaultEdgeStyle: { convertToSvg: '1' },
}

export const drawioCodec = jsonStringCodec<DrawioAction>()

/**
 * The sandbox the editor's frame runs in: exactly what embed mode needs.
 *
 * - `allow-scripts`: draw.io is a JavaScript application.
 * - `allow-same-origin`: keeps the frame on its own origin rather than an
 *   opaque one. draw.io keeps its settings and libraries in that origin's
 *   storage, and the frame channel accepts messages only from that origin —
 *   an opaque origin would be `null`, which nothing should be trusted for.
 *   This pairing is safe only because the editor is never on Quill's own
 *   origin, which the server refuses at boot (`DRAWIO_URL`).
 *
 * Not granted: top navigation, popups, forms, modals, downloads, pointer
 * lock, presentation. Links in a diagram do not open from the editor.
 */
export const DRAWIO_SANDBOX = 'allow-scripts allow-same-origin'

/** Copy and paste inside the editor, and nothing else the Permissions Policy governs. */
export const DRAWIO_ALLOW = 'clipboard-read; clipboard-write'

export interface DrawioUrlOptions {
  /** Matches the reader's light or dark mode. */
  readonly dark: boolean
  /** The interface language, as draw.io names it (`drawioLanguage`), when the application knows it. */
  readonly lang?: string | undefined
}

/**
 * The language draw.io is asked to speak, from a BCP 47 tag such as the page's
 * own `lang`: its primary subtag, lower case, except the two languages draw.io
 * splits by region, Brazilian Portuguese (`pt-br`) and traditional Chinese
 * (`zh-tw`). Nothing for a tag that names no language, so draw.io keeps its own
 * guess rather than being told something it cannot use.
 */
export function drawioLanguage(tag: string): string | undefined {
  const [primary = '', ...rest] = tag.trim().toLowerCase().split(/[-_]/)
  if (!/^[a-z]{2,3}$/.test(primary)) return undefined
  if (primary === 'pt' && rest.includes('br')) return 'pt-br'
  if (primary === 'zh' && rest.some((part) => ['hant', 'tw', 'hk', 'mo'].includes(part))) {
    return 'zh-tw'
  }
  return primary
}

/**
 * The editor page in embed mode (https://www.drawio.com/doc/faq/embed-mode):
 *
 * - `embed=1&proto=json`: the JSON message protocol above;
 * - `spin=1`: draw.io shows its own spinner while it loads;
 * - `saveAndExit=1&noSaveBtn=0`: both "Save" and "Save & Exit";
 * - `configure=1`: waits for the configuration before `init`;
 * - `dark=1|0`: the reader's colour scheme;
 * - `lang`: the interface language, when known.
 */
export function drawioEditorUrl(base: string, options: DrawioUrlOptions): string {
  const url = new URL(base)
  url.searchParams.set('embed', '1')
  url.searchParams.set('proto', 'json')
  url.searchParams.set('spin', '1')
  url.searchParams.set('saveAndExit', '1')
  url.searchParams.set('noSaveBtn', '0')
  url.searchParams.set('configure', '1')
  url.searchParams.set('dark', options.dark ? '1' : '0')
  if (options.lang !== undefined) url.searchParams.set('lang', options.lang)
  return url.href
}

/** An empty diagram, for "Draw.io diagram" in the slash menu. */
export const EMPTY_DIAGRAM =
  '<mxfile><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
