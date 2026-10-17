/**
 * What a rendered document body is given once it is in the page: copy buttons
 * and tabs on code, colour over it, drawn diagrams, the lightbox, the reading
 * tools on tables, the details a link points into, the animated emoji and the
 * picture viewer.
 *
 * Registry pattern (`docs/architecture/patterns.md`): each enhancer names the
 * markup it is for and how to load itself. A body is enhanced by the entries
 * whose markup it contains, so a page of plain prose loads none of them, and a
 * page with a table pays for the table tools alone (quill-plan.md section 31:
 * the reading route's first load is budgeted). Every `load` is a dynamic
 * import, which is what keeps the code out of the route's static graph.
 */
/** Stops one enhancement and puts the DOM back as it found it. */
type Disposer = () => void

export interface EnhanceOptions {
  /** Pictures open in the full-screen viewer, for a surface read at a distance. */
  readonly expandImages: boolean
}

type Enhance = (article: Element, options: EnhanceOptions) => readonly Disposer[]

interface BodyEnhancer {
  /** The markup this enhancer is for; a body with none of it never loads it. */
  readonly appliesTo: string
  readonly load: () => Promise<Enhance>
}

/**
 * In the order they are applied: code cards come before the ranges painted
 * over their text, because a bare block is moved into its card and ranges
 * painted before the move would be painted over nothing.
 */
const ENHANCERS: readonly BodyEnhancer[] = [
  {
    appliesTo: 'pre, .code-group',
    load: async () => {
      const [
        { enhanceCodeBlocks },
        { createBrowserHighlighting },
        { applyHighlighting },
        { languageLabel },
      ] = await Promise.all([
        import('@quill/design-css/code-blocks'),
        import('@quill/highlight/browser'),
        import('@quill/highlight/client'),
        import('@quill/markdown/code-languages'),
      ])
      return (article) => {
        const { environment, rootOf } = createBrowserHighlighting(window)
        return [
          enhanceCodeBlocks(article, { languageLabel }),
          ...applyHighlighting(rootOf(article), environment),
        ]
      }
    },
  },
  {
    appliesTo: '.diagram[data-diagram="mermaid"]',
    load: async () => {
      const [{ createBrowserDiagrams }, { drawDiagrams }] = await Promise.all([
        import('../../lib/diagrams/browser-environment.ts'),
        import('../../lib/diagrams/draw-diagrams.ts'),
      ])
      return (article) => [drawDiagrams(article, createBrowserDiagrams(window, article))]
    },
  },
  {
    appliesTo: '.diagram',
    load: async () => {
      const { enhanceDiagrams } = await import('@quill/design-css/lightbox')
      return (article) => [enhanceDiagrams(article)]
    },
  },
  {
    appliesTo: '.table-block',
    load: async () => {
      const { enhanceTables } = await import('@quill/design-css/tables')
      return (article) => [enhanceTables(article)]
    },
  },
  {
    appliesTo: 'details',
    load: async () => {
      const { enhanceDetails } = await import('@quill/design-css/details')
      return (article) => [enhanceDetails(article)]
    },
  },
  {
    appliesTo: 'picture.emoji',
    load: async () => {
      const { enhanceAnimatedImages } = await import('@quill/design-css/animated-images')
      return (article) => [enhanceAnimatedImages(article)]
    },
  },
  {
    appliesTo: 'img:not(.emoji)',
    load: async () => {
      const { enhanceImages } = await import('@quill/design-css/image-viewer')
      return (article, { expandImages }) => (expandImages ? [enhanceImages(article)] : [])
    },
  },
]

export interface BodyEnhancement {
  /** Settles with whether the enhancements the body needs have been applied (false: disposed first). */
  readonly ready: Promise<boolean>
  /** Undoes what has been applied, and applies nothing more if still loading. */
  readonly dispose: Disposer
}

/** Enhances `article`, loading only the enhancers its markup calls for. */
export function enhanceBody(article: Element, options: EnhanceOptions): BodyEnhancement {
  const needed = ENHANCERS.filter(({ appliesTo }) => article.querySelector(appliesTo) !== null)
  const disposers: Disposer[] = []
  let disposed = false

  const ready = Promise.all(needed.map(({ load }) => load())).then((enhancers) => {
    // Applied in registry order, once all have arrived, so a slow chunk cannot
    // reorder the passes.
    if (disposed) return false
    for (const enhance of enhancers) disposers.push(...enhance(article, options))
    return true
  })

  return {
    ready,
    dispose: () => {
      disposed = true
      for (const dispose of disposers.splice(0)) dispose()
    },
  }
}
