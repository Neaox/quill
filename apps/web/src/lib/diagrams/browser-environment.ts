import type { DiagramEnvironment, MermaidApi } from './draw-diagrams.ts'

/**
 * The browser half of `drawDiagrams`: where Mermaid comes from, how the page's
 * tokens become the literal colours Mermaid derives its shades from, and how
 * a drawing's stylesheet reaches the document. It is the only file in the web
 * app that names any of them.
 */

/**
 * Mermaid's theme variables and the semantic tokens that fill them (ADR-028).
 * A diagram is a raised object on the page, like a table: parts are surfaces
 * with a strong border, lines are muted ink, and notes take the accent.
 */
const THEME_TOKENS: Readonly<Record<string, string>> = {
  background: '--color-surface-raised',
  mainBkg: '--color-surface-raised',
  primaryColor: '--color-surface-raised',
  primaryTextColor: '--color-foreground',
  primaryBorderColor: '--color-border-strong',
  secondaryColor: '--color-surface',
  secondaryTextColor: '--color-foreground',
  secondaryBorderColor: '--color-border',
  tertiaryColor: '--color-surface',
  tertiaryTextColor: '--color-foreground',
  tertiaryBorderColor: '--color-border',
  textColor: '--color-foreground',
  lineColor: '--color-muted',
  clusterBkg: '--color-surface',
  clusterBorder: '--color-border',
  titleColor: '--color-foreground',
  edgeLabelBackground: '--color-surface-raised',
  nodeTextColor: '--color-foreground',
  noteBkgColor: '--color-accent-subtle',
  noteTextColor: '--color-foreground',
  noteBorderColor: '--color-accent',
  actorBkg: '--color-surface-raised',
  actorBorder: '--color-border-strong',
  actorTextColor: '--color-foreground',
  actorLineColor: '--color-border-strong',
  signalColor: '--color-muted',
  signalTextColor: '--color-foreground',
  labelBoxBkgColor: '--color-surface',
  labelBoxBorderColor: '--color-border',
  labelTextColor: '--color-foreground',
  loopTextColor: '--color-foreground',
  activationBkgColor: '--color-surface',
  activationBorderColor: '--color-border-strong',
  sequenceNumberColor: '--color-accent-foreground',
}

/** The slice of a `Window` this adapter reads. */
export interface DiagramWindow {
  readonly document: Document
  getComputedStyle(element: Element): CSSStyleDeclaration
  matchMedia(query: string): MediaQueryList
  readonly MutationObserver: typeof MutationObserver
  readonly CSSStyleSheet: typeof CSSStyleSheet
}

function hex(channel: number): string {
  return channel.toString(16).padStart(2, '0')
}

/**
 * Resolves any CSS colour — `oklch()`, `color-mix()`, a name — to `#rrggbb` by
 * painting it, because Mermaid's colour library reads hex and `rgb()` only and
 * the themes are written in OKLCH.
 */
function createColourResolver(window: DiagramWindow): (colour: string) => string | undefined {
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  return (colour) => {
    if (context === null || colour.length === 0) return undefined
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = '#000'
    context.fillStyle = colour
    context.fillRect(0, 0, 1, 1)
    const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data
    return `#${hex(red)}${hex(green)}${hex(blue)}`
  }
}

export function createBrowserDiagrams(window: DiagramWindow, scope: Element): DiagramEnvironment {
  const { document } = window
  const resolve = createColourResolver(window)
  const token = (name: string): string =>
    window.getComputedStyle(scope).getPropertyValue(name).trim()

  return {
    load: async (): Promise<MermaidApi> => (await import('mermaid')).default,

    palette: () =>
      Object.fromEntries(
        Object.entries(THEME_TOKENS).flatMap(([variable, name]) => {
          const colour = resolve(token(name))
          return colour === undefined ? [] : [[variable, colour]]
        }),
      ),

    fontFamily: () => token('--font-sans') || window.getComputedStyle(scope).fontFamily,

    adoptStyles: (css) => {
      const sheet = new window.CSSStyleSheet()
      sheet.replaceSync(css)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      return () => {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((each) => each !== sheet)
      }
    },

    onThemeChange: (listener) => {
      // Light and dark follow the system unless the reader chose one
      // (`data-theme`), and the identity is `data-theme-id` (ADR-028); both
      // live on the document element.
      const observer = new window.MutationObserver(listener)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-theme-id', 'class'],
      })
      const scheme = window.matchMedia('(prefers-color-scheme: dark)')
      scheme.addEventListener('change', listener)
      return () => {
        observer.disconnect()
        scheme.removeEventListener('change', listener)
      }
    },
  }
}
