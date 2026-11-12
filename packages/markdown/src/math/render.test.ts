import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from '../render/html.ts'

const html = (markdown: string): string => renderHtml(parseMarkdown(markdown))

describe('math in a document', () => {
  it('draws a formula in a sentence as MathML in a span the stylesheet knows', () => {
    const body = html(String.raw`The area is $\pi r^2$ for a circle.`)

    expect(body).toContain('<span class="math" data-math="inline"><math>')
    expect(body).toContain('<mi>π</mi>')
    expect(body).toContain('</math></span> for a circle.')
  })

  it('draws a block as display MathML in a div of its own', () => {
    const body = html(String.raw`$$
\frac{a}{b}
$$`)

    expect(body).toContain('<div class="math" data-math="display"><math display="block"')
    expect(body).toContain('<mfrac>')
  })

  it('keeps the classes that stand in for Temml’s inline style through the sanitiser', () => {
    const body = html('$$\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n$$')

    expect(body).toContain('tml-pl-0')
    expect(body).not.toMatch(/\sstyle=/u)
  })

  it('draws the one-line form and GitHub’s ```math fence as the same block', () => {
    for (const markdown of [
      String.raw`$$\frac{a}{b}$$`,
      '```math\n' + String.raw`\frac{a}{b}` + '\n```',
    ]) {
      expect(html(markdown)).toContain('data-math="display"')
    }
  })

  it('shows what is wrong with a formula beside the TeX the author wrote, and goes on', () => {
    const body = html(String.raw`Before $\frac{$ and after.

$$
\nosuchcommand
$$`)

    expect(body).toContain('<span class="math math-error" data-math="inline">')
    expect(body).toContain('<code title="Invalid math: ')
    expect(body).toContain('<span class="sr-only">Invalid math: ')
    expect(body).toContain('<div class="math math-error" data-math="display"><pre><code title=')
    expect(body).toContain('Before ')
    expect(body).toContain(' and after.')
  })

  it('leaves a price as a price', () => {
    expect(html('from $501 to $2,500')).toBe('<article><p>from $501 to $2,500</p></article>')
  })
})

describe('what a document’s math cannot do', () => {
  const body = (tex: string): string => html(`$$\n${tex}\n$$`)

  it('write a link, however it asks', () => {
    for (const tex of [
      String.raw`\href{https://example.com}{x}`,
      String.raw`\href{javascript:alert(1)}{x}`,
      String.raw`\url{https://example.com}`,
    ]) {
      expect(body(tex)).not.toMatch(/href=|<a /u)
    }
  })

  it('load a picture, set a style, name an element or add a class', () => {
    for (const tex of [
      String.raw`\includegraphics{https://example.com/x.png}`,
      String.raw`\style{color:red}{x}`,
      String.raw`\id{main}{x}`,
      String.raw`\class{evil}{x}`,
      String.raw`\htmlClass{evil}{x}`,
      String.raw`\htmlStyle{color:red}{x}`,
      String.raw`\htmlId{main}{x}`,
      String.raw`\htmlData{a=b}{x}`,
    ]) {
      expect(body(tex)).not.toMatch(/<img|style=|id="user-content-main"|class="[^"]*evil/u)
    }
  })

  it('carry script or an event handler, in the formula or around it', () => {
    for (const tex of [
      String.raw`\text{<script>alert(1)</script>}`,
      'x" onload="alert(1)',
      '<img src=x onerror=alert(1)>',
    ]) {
      expect(body(tex)).not.toMatch(/<script|<img|onload=|onerror=/u)
    }
  })

  it('carry an inline style at all, which the page’s content security policy would refuse', () => {
    expect(
      body(String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix} \color{red} x \tag{1}`),
    ).not.toMatch(/\sstyle=/u)
  })

  it('smuggle a MathML element through the raw HTML of the document', () => {
    const out = html(
      '<math><maction actiontype="statusline#evil" xlink:href="javascript:alert(1)"><mi>x</mi></maction></math>',
    )

    // Escaped to the text it was, as every raw element is (`escape-raw-html.ts`).
    expect(out).not.toMatch(/<math|<maction/u)
    expect(out).toContain('&#x3C;math>')
  })
})
