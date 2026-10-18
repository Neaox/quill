/**
 * The Markdown extension contract (ADR-039), as much of it as the extensions
 * Quill ships need today.
 *
 * An extension is one typed object that covers every stage — what it claims,
 * how it is drawn, what the sanitiser must admit for it, and how the editor
 * shows and writes it — so a feature cannot exist on the reading surface and
 * not the writing one. The full contract in the ADR also has directive
 * syntax, `parse`, `serialize`, `live` and `styles`; each joins this file
 * with the first extension that needs it, so nothing here is speculative.
 *
 * The first claim is a **drawing**: an SVG attachment shown on its own line,
 * which ADR-036's pipeline would otherwise draw inline as it is. An extension
 * that recognises the file decides how it is drawn, but only by choosing one
 * of the platform's own renderings (`DrawingRendering`): it hands back markup
 * for the SVG allowlist, or asks for the stored file as an `<img>`. It never
 * builds output itself, so the allowlist and the sanitiser stay the last word
 * on what a page contains (ADR-011), and the only thing it can add is a data
 * attribute its grant names.
 *
 * `docs/extending/markdown-extensions.md` is the guide; the draw.io extension
 * (`./drawio`) is the reference implementation.
 */

/** A drawing an extension has been offered: the stored file, as text. */
export interface DrawingSource {
  /** The SVG as it was stored. Untrusted: it reaches a page only through the allowlist. */
  readonly markup: string
}

/**
 * How a claimed drawing is shown, chosen from the platform's renderings.
 *
 * - `inline`: drawn into the page through the SVG allowlist (`render/drawing.ts`),
 *   from the markup given, which may be a reduced copy of the source. With
 *   `naturalSize`, the drawing keeps its own width as an upper bound instead of
 *   filling the measure, for drawings made at a fixed size rather than for it.
 * - `image`: the stored file shown as an `<img>`, the browser's own sandbox
 *   for an SVG (no script, nothing fetched). For a drawing the allowlist would
 *   draw wrongly, such as one whose text is HTML the allowlist refuses.
 *
 * `data` names the data attributes the rendered element carries, so the
 * reader's stylesheet and the editor can recognise it. Every name must be in
 * the extension's grant; the registry refuses an extension that says
 * otherwise, and the renderer drops any name that is not.
 */
export type DrawingRendering =
  | {
      readonly kind: 'inline'
      readonly markup: string
      readonly naturalSize: boolean
      readonly data: Readonly<Record<string, string>>
    }
  | { readonly kind: 'image'; readonly data: Readonly<Record<string, string>> }

/** What an extension claims. A drawing claim is asked of every SVG a body shows. */
export interface DrawingClaim {
  readonly kind: 'drawing'
  /** Cheap: asked of every drawing on every render. */
  claims(drawing: DrawingSource): boolean
}

export type ExtensionSyntax = DrawingClaim

/**
 * Exactly what an extension's output needs from the sanitiser, and nothing
 * else (ADR-039, "The sanitiser runs last"). Data attribute names, written as
 * they are in HTML (`data-drawio`), by the rendering that may carry them.
 */
export interface SanitizeGrant {
  readonly drawing?: { readonly data: readonly string[] }
  readonly image?: { readonly data: readonly string[] }
}

/** How the slash menu offers to insert one (`packages/editor/src/slash`). */
export interface EditorInsert {
  readonly label: string
  readonly description: string
  readonly keywords: readonly string[]
}

/** An action offered on a node the extension owns, such as "Edit diagram". */
export interface EditorAction {
  readonly id: string
  readonly label: string
}

/**
 * The writing surface (ADR-039, "Both surfaces, always"). A drawing is an
 * image to the editor — the Markdown is `![alt](url "title")` — so its view
 * is the editor's image, with the extension's actions on it and its insert
 * entry in the slash menu. What the actions do is the editor package's
 * binding for the extension, loaded only when one is used.
 */
export interface EditorBinding {
  readonly view: 'image'
  readonly insert: EditorInsert
  readonly actions: readonly EditorAction[]
}

export interface MarkdownExtension {
  /** Unique and stable: `quill.drawio`, `acme.decision`. */
  readonly id: string
  /** Semver. Joins the render cache key, so upgrading one re-renders the bodies it draws. */
  readonly version: string
  readonly syntax: ExtensionSyntax
  /** How a claimed drawing is shown. Pure: no clock, randomness or I/O. */
  render(drawing: DrawingSource): DrawingRendering
  readonly sanitize: SanitizeGrant
  readonly editor: EditorBinding
}

const EXTENSION_ID = /^[a-z][a-z\d-]*(?:\.[a-z][a-z\d-]*)+$/
const SEMVER = /^\d+\.\d+\.\d+$/
/** The only attributes an extension may add, written as they are in HTML. */
export const DATA_ATTRIBUTE = /^data-[a-z][a-z\d-]*$/

/**
 * Why an extension cannot be registered, or nothing when it can. Checked by
 * the registry, so an extension that breaks the contract stops the process
 * at boot rather than misbehaving in one document.
 */
export function extensionProblems(extension: MarkdownExtension): readonly string[] {
  const grants = [
    ...(extension.sanitize.drawing?.data ?? []),
    ...(extension.sanitize.image?.data ?? []),
  ]
  return [
    ...(EXTENSION_ID.test(extension.id)
      ? []
      : [`its id "${extension.id}" is not dotted lowercase`]),
    ...(SEMVER.test(extension.version) ? [] : [`its version "${extension.version}" is not semver`]),
    // Required by the type, and checked here for what arrives untyped: there
    // is no reading-only extension (ADR-039).
    ...(isRecord(extension.editor) ? [] : ['it has no editor binding']),
    ...grants.flatMap((name) =>
      DATA_ATTRIBUTE.test(name) ? [] : [`its grant names "${name}", which is not a data attribute`],
    ),
  ]
}

function isRecord(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

/** Declares an extension, typed against the contract. The registry checks it. */
export function defineExtension(extension: MarkdownExtension): MarkdownExtension {
  return extension
}
