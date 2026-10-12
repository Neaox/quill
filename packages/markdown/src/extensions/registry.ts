import type { DrawingRendering, DrawingSource, MarkdownExtension } from './contract.ts'
import { extensionProblems } from './contract.ts'
import { drawioExtension } from './drawio/drawio-extension.ts'

/**
 * The installed Markdown extensions, assembled once (ADR-039; the registry
 * pattern of `docs/architecture/patterns.md`).
 *
 * Built at the composition root from the extensions the instance runs, and
 * handed to the renderer, which asks it how each drawing is drawn. It refuses,
 * at construction, any extension that breaks the contract, so a bad one stops
 * the process at boot rather than one document at a time.
 */
export interface MarkdownRegistry {
  readonly extensions: readonly MarkdownExtension[]
  /**
   * The installed extensions' ids and versions, which join the render cache
   * key: upgrading one re-renders the bodies, and nothing else does.
   */
  readonly signature: string
  /** How a drawing is drawn: by the first extension that claims it, or inline as it is. */
  drawing(source: DrawingSource): DrawingRendering
  findExtension(id: string): MarkdownExtension | undefined
}

/** The extensions Quill ships. Each is also the reference for one kind of claim. */
export const BUILT_IN_EXTENSIONS: readonly MarkdownExtension[] = [drawioExtension]

/** A drawing no extension claims: inline, through the allowlist, as ADR-036 draws it. */
function unclaimed(source: DrawingSource): DrawingRendering {
  return { kind: 'inline', markup: source.markup, naturalSize: false, data: {} }
}

/** The rendering's data attributes, less any its extension's grant does not name. */
function granted(extension: MarkdownExtension, rendering: DrawingRendering): DrawingRendering {
  const allowed = new Set(
    rendering.kind === 'inline'
      ? (extension.sanitize.drawing?.data ?? [])
      : (extension.sanitize.image?.data ?? []),
  )
  const data = Object.fromEntries(
    Object.entries(rendering.data).filter(([name]) => allowed.has(name)),
  )
  return { ...rendering, data }
}

export function createMarkdownRegistry(
  extensions: readonly MarkdownExtension[] = BUILT_IN_EXTENSIONS,
): MarkdownRegistry {
  const byId = new Map<string, MarkdownExtension>()
  for (const extension of extensions) {
    const problems = extensionProblems(extension)
    if (problems.length > 0) {
      throw new Error(
        `The Markdown extension "${extension.id}" cannot be installed: ${problems.join('; ')}.`,
      )
    }
    if (byId.has(extension.id)) {
      throw new Error(
        `Two Markdown extensions are called "${extension.id}"; an id names one extension.`,
      )
    }
    byId.set(extension.id, extension)
  }

  // Every extension claims drawings today; a second kind of claim filters here.
  const drawings = extensions

  return {
    extensions,
    signature: extensions
      .map((extension) => `${extension.id}@${extension.version}`)
      .toSorted()
      .join(' '),
    drawing: (source) => {
      const claimant = drawings.find((extension) => extension.syntax.claims(source))
      return claimant === undefined ? unclaimed(source) : granted(claimant, claimant.render(source))
    },
    findExtension: (id) => byId.get(id),
  }
}
