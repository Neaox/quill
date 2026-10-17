import { describe, expect, it, vi } from 'vitest'

import type { DiagramEnvironment, MermaidApi } from './draw-diagrams.ts'
import { drawDiagrams } from './draw-diagrams.ts'

const SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" id="ID" aria-labelledby="chart-title-ID" style="max-width: 640px;">',
  '<title id="chart-title-ID">The loop</title>',
  '<style>#ID .node rect{fill:#fff}</style>',
  '<g class="node"><rect style="fill:#f00;stroke-dasharray:4 4"></rect></g>',
  '</svg>',
].join('')

function articleWith(...sources: string[]): HTMLElement {
  const article = document.createElement('article')
  article.innerHTML = sources
    .map(
      (source) =>
        `<div class="diagram" data-diagram="mermaid"><pre><code data-lang="mermaid">${source}</code></pre></div>`,
    )
    .join('')
  document.body.append(article)
  return article
}

function fakeMermaid(render?: MermaidApi['render']): MermaidApi {
  return {
    initialize: vi.fn<MermaidApi['initialize']>(),
    render: vi.fn<MermaidApi['render']>(
      render ?? (async (id: string) => ({ svg: SVG.replaceAll('ID', id) })),
    ),
  }
}

function environment(mermaid: MermaidApi): DiagramEnvironment & {
  readonly sheets: string[]
} {
  const sheets: string[] = []
  return {
    sheets,
    load: vi.fn<DiagramEnvironment['load']>(async () => mermaid),
    palette: () => ({ background: '#ffffff', foreground: '#111111' }),
    fontFamily: () => 'Figtree',
    adoptStyles: (css) => {
      sheets.push(css)
      return () => {
        sheets.splice(sheets.indexOf(css), 1)
      }
    },
    onThemeChange: () => () => undefined,
  }
}

async function settled(): Promise<void> {
  await vi.waitFor(() => {
    for (const slot of document.querySelectorAll('.diagram')) {
      expect(slot.getAttribute('data-state')).not.toBe('drawing')
    }
  })
}

describe('drawDiagrams', () => {
  it('loads nothing for a document without diagrams', () => {
    const env = environment(fakeMermaid())
    const article = document.createElement('article')
    article.innerHTML = '<pre><code data-lang="ts">x</code></pre>'

    drawDiagrams(article, env)()

    expect(env.load).not.toHaveBeenCalled()
  })

  it('draws each diagram from its source, themed from the page', async () => {
    const mermaid = fakeMermaid()
    const env = environment(mermaid)
    const article = articleWith('flowchart LR\n  a --&gt; b')

    const dispose = drawDiagrams(article, env)
    await settled()

    const slot = article.querySelector('.diagram')
    expect(slot?.getAttribute('data-state')).toBe('drawn')
    expect(mermaid.render).toHaveBeenCalledWith(
      expect.stringMatching(/^quill-diagram-/),
      'flowchart LR\n  a --> b',
    )
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        themeVariables: expect.objectContaining({
          background: '#ffffff',
          fontFamily: 'Figtree',
        }) as unknown,
      }),
    )
    // The source stays for a reader without the drawing, and for a redraw.
    expect(slot?.querySelector('pre code')?.textContent).toBe('flowchart LR\n  a --> b')
    dispose()
  })

  it("moves the drawing's styles out of markup, where a strict CSP would refuse them", async () => {
    const env = environment(fakeMermaid())
    const article = articleWith('flowchart LR')

    const dispose = drawDiagrams(article, env)
    await settled()

    const svg = article.querySelector('.diagram svg')
    expect(svg?.querySelector('style')).toBeNull()
    expect(env.sheets).toEqual([expect.stringContaining('.node rect{fill:#fff}')])
    const rect = svg?.querySelector('rect')
    expect(rect instanceof SVGElement ? rect.style.getPropertyValue('fill') : '').toMatch(
      /#f00|rgb\(255, 0, 0\)/,
    )
    expect(svg?.getAttribute('role')).toBe('img')
    // Drawn at its own size, so its text is never shrunk past reading; the
    // stylesheet decides how far it may give way before the slot scrolls.
    expect(svg instanceof SVGElement ? svg.style.maxWidth : 'missing').toBe('')
    expect(svg instanceof SVGElement ? svg.style.getPropertyValue('--natural-width') : '').toBe(
      '640px',
    )

    dispose()
    expect(env.sheets).toEqual([])
  })

  it('names a drawing that has no title of its own', async () => {
    const env = environment(
      fakeMermaid(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })),
    )
    const article = articleWith('flowchart LR')

    const dispose = drawDiagrams(article, env)
    await settled()

    expect(article.querySelector('.diagram svg')?.getAttribute('aria-label')).toBe('Diagram')
    dispose()
  })

  it('names a titleless drawing from its caption, then from the title its source gives', async () => {
    const untitled = environment(
      fakeMermaid(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })),
    )
    const article = document.createElement('article')
    article.innerHTML =
      '<figure><div class="diagram" data-diagram="mermaid"><pre><code>flowchart LR</code></pre></div>' +
      '<figcaption> The sync <em>loop</em> </figcaption></figure>' +
      '<div class="diagram" data-diagram="mermaid"><pre><code>---\ntitle: Order flow\n---\nflowchart LR</code></pre></div>' +
      '<div class="diagram" data-diagram="mermaid"><pre><code>---\nconfig: {}\n---\nflowchart LR</code></pre></div>'
    document.body.append(article)

    const dispose = drawDiagrams(article, untitled)
    await settled()

    const names = [...article.querySelectorAll('.diagram svg')].map((svg) =>
      svg.getAttribute('aria-label'),
    )
    expect(names).toEqual(['The sync loop', 'Order flow', 'Diagram'])
    dispose()
  })

  it('keeps the source as the drawing’s long description, behind a disclosure', async () => {
    const env = environment(fakeMermaid())
    const article = articleWith('flowchart LR')

    const dispose = drawDiagrams(article, env)
    await settled()

    const slot = article.querySelector('.diagram')
    const svg = slot?.querySelector('svg')
    const disclosure = slot?.querySelector(':scope > details.diagram-source')
    expect(disclosure?.querySelector('summary')?.textContent).toBe('Diagram source')
    expect(disclosure?.hasAttribute('open')).toBe(false)
    expect(disclosure?.querySelector('pre code')?.textContent).toBe('flowchart LR')
    expect(svg?.getAttribute('aria-details')).toBe(disclosure?.id)
    // Mermaid's own title still names it.
    expect(svg?.getAttribute('aria-labelledby')).toMatch(/^chart-title-/)
    expect(svg?.hasAttribute('aria-label')).toBe(false)

    dispose()
    expect(slot?.querySelector(':scope > pre code')?.textContent).toBe('flowchart LR')
    expect(slot?.querySelector('details')).toBeNull()
  })

  it('keeps the source, and says so, when a diagram cannot be drawn', async () => {
    const env = environment(
      fakeMermaid(async () => {
        throw new Error('Parse error on line 1')
      }),
    )
    const article = articleWith('flowchart ???')

    const dispose = drawDiagrams(article, env)
    await settled()

    const slot = article.querySelector('.diagram')
    expect(slot?.getAttribute('data-state')).toBe('failed')
    expect(slot?.querySelector('svg')).toBeNull()
    expect(slot?.querySelector('pre code')?.textContent).toBe('flowchart ???')
    dispose()
  })

  it('draws nothing once disposed', async () => {
    const pending: { finish?: (value: { svg: string }) => void } = {}
    const env = environment(
      fakeMermaid(
        async () =>
          new Promise((resolve) => {
            pending.finish = resolve
          }),
      ),
    )
    const article = articleWith('flowchart LR')

    const dispose = drawDiagrams(article, env)
    await vi.waitFor(() => {
      expect(env.load).toHaveBeenCalled()
    })
    dispose()
    pending.finish?.({ svg: SVG })
    await Promise.resolve()

    expect(article.querySelector('.diagram svg')).toBeNull()
    expect(env.sheets).toEqual([])
  })

  it('redraws when the theme changes, replacing the earlier drawing', async () => {
    const mermaid = fakeMermaid()
    const theme: { change?: () => void } = {}
    const env = {
      ...environment(mermaid),
      onThemeChange: (listener: () => void) => {
        theme.change = listener
        return () => undefined
      },
    }
    const article = articleWith('flowchart LR')

    const dispose = drawDiagrams(article, env)
    await settled()
    theme.change?.()
    await vi.waitFor(() => {
      expect(mermaid.render).toHaveBeenCalledTimes(2)
    })
    await settled()

    expect(article.querySelectorAll('.diagram svg')).toHaveLength(1)
    expect(env.sheets).toHaveLength(1)
    dispose()
  })
})
