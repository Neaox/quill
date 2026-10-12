import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from './html.ts'

const render = (markdown: string): string => renderHtml(parseMarkdown(markdown))

describe('badges', () => {
  it('render as a span whose tone is an attribute, never the meaning', () => {
    expect(render('A :badge[Built]{tone=success} cell.\n')).toBe(
      '<article><p>A <span class="badge" data-tone="success">Built</span> cell.</p></article>',
    )
  })

  it('render an unknown tone as neutral', () => {
    expect(render(':badge[Odd]{tone="x\\" onclick=alert(1)"}\n')).toContain(
      '<span class="badge" data-tone="neutral">Odd</span>',
    )
  })
})

describe('small print', () => {
  it('renders as small', () => {
    expect(render(':small[Drawn from main.]\n')).toBe(
      '<article><p><small>Drawn from main.</small></p></article>',
    )
  })
})

describe('diagrams', () => {
  it('give a mermaid fence a diagram slot that still holds its source', () => {
    expect(render('```mermaid\nflowchart LR\n  a --> b\n```\n')).toBe(
      '<article><div class="diagram" data-diagram="mermaid"><pre><code data-lang="mermaid">flowchart LR\n  a --> b</code></pre></div></article>',
    )
  })

  it('leave every other fence a plain code block', () => {
    expect(render('```ts\nconst a = 1\n```\n')).toBe(
      '<article><div class="code-block"><pre><code data-lang="ts">const a = 1</code></pre></div></article>',
    )
  })
})

describe('figures', () => {
  it('caption their subject with the paragraphs that follow it', () => {
    expect(render(':::figure\n```mermaid\nx\n```\n\nThe *loop*.\n\nMore.\n:::\n')).toBe(
      [
        '<article><figure>',
        '<div class="diagram" data-diagram="mermaid"><pre><code data-lang="mermaid">x</code></pre></div>',
        '<figcaption><p>The <em>loop</em>.</p>\n<p>More.</p></figcaption>',
        '</figure></article>',
      ].join('\n'),
    )
  })

  it('leave out the caption when there is none', () => {
    expect(render(':::figure\n| a |\n| - |\n:::\n')).not.toContain('figcaption')
  })
})

describe('cards', () => {
  it('give each heading its own section', () => {
    const html = render(':::cards\n### One\n\nFirst.\n\n### Two\n\nSecond.\n:::\n')

    expect(html).toContain('<div class="cards" data-variant="panels">')
    expect(html).toContain(
      '<section class="card"><h3 id="user-content-one" aria-labelledby="user-content-title.one"><span id="user-content-title.one">One</span>',
    )
    expect(html).toContain('<p>First.</p></section>')
    expect(html).toContain(
      '<section class="card"><h3 id="user-content-two" aria-labelledby="user-content-title.two"><span id="user-content-title.two">Two</span>',
    )
  })

  it('carry their variant', () => {
    expect(render(':::cards{variant=ruled}\n### One\n:::\n')).toContain(
      '<div class="cards" data-variant="ruled">',
    )
  })
})

describe('table cells that open with a status', () => {
  it('set the status apart from the detail', () => {
    const html = render(
      '| a |\n| - |\n| :badge[Built]{tone=success} :badge[Gap]{tone=warning} `in` Pulled every 20 s. |\n',
    )

    expect(html).toContain(
      '<td><span class="cell-status"><span class="badge" data-tone="success">Built</span> <span class="badge" data-tone="warning">Gap</span> <code>in</code></span><span class="cell-detail">Pulled every 20 s.</span></td>',
    )
  })

  it('leave a cell alone when it does not open with a badge', () => {
    expect(render('| a |\n| - |\n| `x` then :badge[B] |\n')).toContain(
      '<td><code>x</code> then <span class="badge" data-tone="neutral">B</span></td>',
    )
  })

  it('need no detail when the status is all there is', () => {
    expect(render('| a |\n| - |\n| :badge[Yes] |\n')).toContain(
      '<td><span class="cell-status"><span class="badge" data-tone="neutral">Yes</span></span></td>',
    )
  })
})

describe('the architecture map', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../corpus/20-architecture-map.md', import.meta.url)),
    'utf8',
  )
  const html = renderHtml(parseMarkdown(source))

  it('opens with the eyebrow, the title, the lead and the small print', () => {
    expect(html).toMatch(
      /^<article><p>Architecture<\/p>\n<h1 id="user-content-lockstay-sync-map"[^>]*><span[^>]*>lockstay Sync Map<\/span><a[^>]*><span aria-hidden="true">#<\/span><\/a><\/h1>\n<p>How properties/,
    )
    expect(html).toContain('<p><small>Drawn from the code')
  })

  it('draws every diagram, each wide and captioned where the source captions it', () => {
    expect(html.match(/data-diagram="mermaid"/g)).toHaveLength(7)
    expect(html.match(/<figcaption>/g)).toHaveLength(3)
    expect(html.match(/<div class="layout-wide">/g)).toHaveLength(7)
  })

  it('sets the badges and the cards', () => {
    expect(html.match(/class="badge"/g)).toHaveLength(22)
    expect(html.match(/<section class="card">/g)).toHaveLength(8)
    expect(html).toContain('<div class="cards" data-variant="ruled">')
  })
})

describe('drawings', () => {
  const url = '/api/attachments/0b6b0d2c-7f7e-4a39-8a8a-4a5f6d0c1a11'
  const markup =
    '<svg viewBox="0 0 10 10"><style>.box{}</style><defs><marker id="m"><path d="M0,0"/></marker></defs><rect class="box" marker-end="url(#m)"/><script>alert(1)</script></svg>'
  const drawings = new Map([[url, markup]])

  it('draw an SVG the document shows on its own line inline, captioned by its title', () => {
    const html = renderHtml(
      parseMarkdown(`![The loop, end to end](${url} "Marks make it prompt.")\n`),
      {
        drawings,
      },
    )

    expect(html).toContain(
      '<figure><div class="diagram" data-diagram="svg"><svg viewBox="0 0 10 10" role="img" aria-label="The loop, end to end">',
    )
    expect(html).toContain('<rect class="box" marker-end="url(#user-content-d1-m)"></rect>')
    expect(html).toContain('<figcaption>Marks make it prompt.</figcaption></figure>')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('script')
  })

  it('give each drawing on a page its own ids', () => {
    const html = renderHtml(parseMarkdown(`![a](${url})\n\n![b](${url})\n`), { drawings })

    expect(html).toContain('id="user-content-d1-m"')
    expect(html).toContain('id="user-content-d2-m"')
  })

  it('leave an image alone when there is no drawing for it', () => {
    expect(renderHtml(parseMarkdown(`![a](${url})\n`))).toContain(`<img src="${url}" alt="a">`)
  })

  it('cannot be forged by an author', () => {
    // Raw HTML is escaped long before the drawing pass, so markup that names
    // the slot is text, and the slot is filled only where the renderer put one.
    const html = renderHtml(
      parseMarkdown(
        '<div class="diagram" data-diagram="svg"></div>\n\n```svg\n<svg><script>x</script></svg>\n```\n',
      ),
      { drawings },
    )

    expect(html).not.toContain('<svg')
    expect(html).toContain('&#x3C;div class="diagram"')
  })
})

describe('GitHub alerts', () => {
  it('render as the callout they are, titled by their kind', () => {
    expect(render('> [!IMPORTANT]\n> Delete every mark, and the sweep still finds it.\n')).toBe(
      '<article><aside class="callout callout-important" role="note" aria-labelledby="user-content-callout.1">\n<p class="callout-label" id="user-content-callout.1">Important</p>\n<p>Delete every mark, and the sweep still finds it.</p>\n</aside></article>',
    )
  })

  it('know all five kinds, in any case', () => {
    for (const [marker, kind] of [
      ['NOTE', 'note'],
      ['tip', 'tip'],
      ['Important', 'important'],
      ['WARNING', 'warning'],
      ['CAUTION', 'caution'],
    ]) {
      expect(render(`> [!${marker}]\n> Text.\n`)).toContain(`class="callout callout-${kind}"`)
    }
  })

  it('keep everything after the marker, formatting included', () => {
    const html = render('> [!WARNING]\n> The **puller** must keep running.\n>\n> - one\n')

    expect(html).toContain('<p>The <strong>puller</strong> must keep running.</p>')
    expect(html).toContain('<li>one</li>')
  })

  it('leave any other blockquote a blockquote', () => {
    expect(render('> Plain [!NOTE] text.\n')).toContain('<blockquote>')
    expect(render('> [!NOTE]text with no space.\n')).toContain('<blockquote>')
    expect(render('> Words first.\n> [!NOTE]\n')).toContain('<blockquote>')
  })

  it('read Obsidian’s callouts: a kind of any name, and the title after it', () => {
    const titled = render('> [!tip] Before you begin\n> Read **this**.\n')

    expect(titled).toContain('callout callout-tip')
    expect(titled).toContain('Before you begin')
    expect(titled).toContain('<strong>this</strong>')
    expect(titled).not.toContain('[!tip]')
  })

  it('read an Obsidian kind as the callout it is drawn as, and one nobody knows as a note', () => {
    expect(render('> [!faq]\n> Why?\n')).toContain('callout-info')
    expect(render('> [!bug] A bug\n> Fix.\n')).toContain('callout-caution')
    expect(render('> [!custom-kind]\n> Text.\n')).toContain('callout-note')
  })
})

describe('label shorthands', () => {
  it('read :ok, :warn, :bad, :accent and :plan as badges of that tone', () => {
    expect(render(':ok[Built] :warn[Not read] :bad[Broken] :accent[New] :plan[Designed]\n')).toBe(
      '<article><p><span class="badge" data-tone="success">Built</span> <span class="badge" data-tone="warning">Not read</span> <span class="badge" data-tone="danger">Broken</span> <span class="badge" data-tone="accent">New</span> <span class="badge" data-tone="neutral">Designed</span></p></article>',
    )
  })

  it('leave prose that merely contains the word alone', () => {
    expect(render('The check said status:ok and moved on.\n')).toContain('status:ok and moved on.')
    expect(render('A bare :badge stays as written.\n')).toContain('A bare :badge stays')
  })
})

describe('heading links written for GitHub', () => {
  it('slug a heading the way GitHub does, keeping underscores and every space', () => {
    expect(render('## snake_case  and  spaces\n')).toContain(
      'id="user-content-snake_case--and--spaces"',
    )
  })

  it('send an in-page link to the heading it names', () => {
    expect(render('See [the loop](#the-loop).\n\n## The loop\n')).toContain(
      '<a href="#user-content-the-loop">the loop</a>',
    )
  })

  it('leave a link that already names the rendered id, and every other link, alone', () => {
    const html = render(
      '[a](#user-content-the-loop) [b](https://example.com/#x) [c](/d/1#x)\n\n## The loop\n',
    )

    expect(html).toContain('href="#user-content-the-loop"')
    expect(html).toContain('href="https://example.com/#x"')
    expect(html).toContain('href="/d/1#x"')
  })
})

describe('GitHub alerts, written every way GitHub accepts', () => {
  it('keep formatting that opens the first line', () => {
    expect(render('> [!TIP]\n> **Bold** first.\n')).toContain('<p><strong>Bold</strong> first.</p>')
  })

  it('take a body that starts after a blank line', () => {
    const html = render('> [!NOTE]\n>\n> After a gap.\n')

    expect(html).toContain(
      '<p class="callout-label" id="user-content-callout.1">Note</p>\n<p>After a gap.</p>',
    )
  })

  it('leave a blockquote that opens with something other than words', () => {
    expect(render('> - [!NOTE] a list\n')).toContain('<blockquote>')
    expect(render('> *[!NOTE]* emphasised\n')).toContain('<blockquote>')
  })
})

describe('a drawing that is not one', () => {
  it('shows the image as it would any other', () => {
    const url = '/api/attachments/0b6b0d2c-7f7e-4a39-8a8a-4a5f6d0c1a11'
    const html = renderHtml(parseMarkdown(`![a](${url})\n`), {
      drawings: new Map([[url, '<p>not a drawing</p>']]),
    })

    expect(html).toContain(`<img src="${url}" alt="a">`)
  })
})
