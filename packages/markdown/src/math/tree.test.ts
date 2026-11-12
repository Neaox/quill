import { describe, expect, it } from 'vitest'

import { MATH_ATTRIBUTES, MATH_CLASS, MATH_TAGS } from './grant.ts'
import { MATH_ENGINE_VERSION, MAX_TEX_LENGTH, renderMath } from './tree.ts'
import type { MathElement, MathRendering } from './tree.ts'

function mathOf(tex: string, display = false): MathElement {
  const rendering = renderMath(tex, display)
  if (rendering.kind !== 'math') throw new Error(`${tex}: ${rendering.message}`)
  return rendering.math
}

function everyElement(element: MathElement): readonly MathElement[] {
  return [
    element,
    ...element.children.flatMap((child) => (typeof child === 'string' ? [] : everyElement(child))),
  ]
}

const textOf = (element: MathElement): string =>
  element.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('')

const classNamesOf = (elements: readonly MathElement[]): string =>
  elements.map((element) => element.attributes['class'] ?? '').join(' ')

const refused = (tex: string): MathRendering => renderMath(tex, false)

describe('drawing TeX as MathML', () => {
  it('reports the engine’s own version, which joins the render cache key', () => {
    expect(MATH_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/u)
  })

  it('makes a math element, whose words are the formula’s', () => {
    const math = mathOf('E = mc^2')

    expect(math.tag).toBe('math')
    expect(textOf(math)).toBe('E=mc2')
    expect(math.attributes['display']).toBeUndefined()
  })

  it('makes a block of it for display, which the page can set on its own line', () => {
    const math = mathOf(String.raw`\frac{a}{b}`, true)

    expect(math.attributes['display']).toBe('block')
    expect(math.attributes['class']).toContain('tml-display')
  })

  it('is the same tree for the same TeX', () => {
    const tex = String.raw`\sum_{i=1}^{n} \frac{i}{n}`

    expect(mathOf(tex, true)).toEqual(mathOf(tex, true))
  })

  it('reads fractions, roots, sums, matrices and alignments, which is most of what is written', () => {
    const readable = [
      String.raw`\frac{a}{b} + \sqrt{x^2 + 1}`,
      String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`,
      String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`,
      String.raw`\begin{aligned} a &= b \\ c &= d \end{aligned}`,
      String.raw`\int_0^\infty e^{-x^2}\,dx = \tfrac{\sqrt{\pi}}{2}`,
      String.raw`\text{hello } \mathbb{R} \in \mathcal{A}`,
      String.raw`\lim_{x \to 0} \frac{\sin x}{x} = 1`,
    ]

    expect(readable.filter((tex) => renderMath(tex, true).kind !== 'math')).toEqual([])
  })
})

describe('what comes out of it', () => {
  const SAMPLES = [
    String.raw`\frac{a}{b}`,
    String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`,
    String.raw`\begin{aligned} a &= b \\ c &= d \end{aligned}`,
    String.raw`\begin{array}{c|c} a & b \\ \hline c & d \end{array}`,
    String.raw`x = 1 \tag{1}`,
    String.raw`\color{red} x + \textcolor{blue}{y}`,
    String.raw`\cancel{x} + \overline{y} + \vec{v} + \hat{w}`,
    String.raw`\rule{1em}{2em} \hspace{3em} x`,
    String.raw`\mathscr{L} f'`,
  ]

  it('holds only the elements the grant names', () => {
    const tags = new Set<string>(MATH_TAGS)
    const outside = SAMPLES.flatMap((tex) =>
      everyElement(mathOf(tex, true))
        .filter((element) => !tags.has(element.tag))
        .map((element) => `${tex}: ${element.tag}`),
    )

    expect(outside).toEqual([])
  })

  it('holds only the attributes the grant names, with values of the shapes it gives them', () => {
    const problems: string[] = []
    for (const tex of SAMPLES) {
      for (const element of everyElement(mathOf(tex, true))) {
        for (const [name, value] of Object.entries(element.attributes)) {
          const names = name === 'class' ? value.split(' ') : []
          const allowed =
            name === 'class'
              ? names.every((className) => MATH_CLASS.test(className))
              : MATH_ATTRIBUTES[name]?.test(value) === true
          if (!allowed) problems.push(`${tex}: ${name}="${value}"`)
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('has no inline style, which the page’s content security policy would refuse', () => {
    const styles = SAMPLES.flatMap((tex) =>
      everyElement(mathOf(tex, true))
        .filter((element) => element.attributes['style'] !== undefined)
        .map((element) => `${tex}: ${element.attributes['style'] ?? ''}`),
    )

    expect(styles).toEqual([])
  })

  it('has no link, address, id or event handler', () => {
    const forbidden = ['href', 'src', 'id', 'xmlns', 'title', 'onclick', 'onload']
    const found = SAMPLES.flatMap((tex) =>
      everyElement(mathOf(tex, true)).flatMap((element) =>
        forbidden
          .filter((name) => element.attributes[name] !== undefined)
          .map((name) => `${tex}: ${name}`),
      ),
    )

    expect(found).toEqual([])
  })

  it('turns the styles that matter into classes: cells without padding, and the rule of an \\hline', () => {
    const matrix = everyElement(
      mathOf(String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, true),
    )
    const aligned = everyElement(mathOf(String.raw`\begin{aligned} a &= b \end{aligned}`, true))
    const ruled = everyElement(
      mathOf(String.raw`\begin{array}{c|c} a & b \\ \hline c & d \end{array}`, true),
    )

    expect(classNamesOf(matrix)).toContain('tml-pl-0')
    expect(classNamesOf(aligned)).toContain('tml-pl-0')
    expect(classNamesOf(ruled)).toContain('tml-bb-solid')
  })

  it('draws a tagged equation with its number held at the edge', () => {
    const classes = everyElement(mathOf(String.raw`x = 1 \tag{1}`, true))
      .map((element) => element.attributes['class'] ?? '')
      .join(' ')

    expect(classes).toContain('tml-w-100')
    expect(classes).toContain('tml-w-50')
  })

  it('drops a colour, which the theme and not the author chooses', () => {
    const colours = everyElement(mathOf(String.raw`\color{red} x`))
      .flatMap((element) => Object.entries(element.attributes))
      .filter(([name]) => name === 'mathcolor' || name === 'style')

    expect(colours).toEqual([])
  })
})

describe('what it refuses', () => {
  it('says what is wrong, in one line, when TeX does not read', () => {
    const result = refused(String.raw`\frac{`)

    expect(result).toEqual({
      kind: 'error',
      message: "Unexpected end of input in a macro argument, expected '}'",
    })
  })

  it('says so for an unknown command, and for a misplaced character', () => {
    expect(refused(String.raw`\nosuchcommand x`).kind).toBe('error')
    expect(refused('a & b').kind).toBe('error')
  })

  it.each([
    String.raw`\href{https://example.com}{x}`,
    String.raw`\url{https://example.com}`,
    String.raw`\includegraphics{https://example.com/x.png}`,
    String.raw`\style{color:red}{x}`,
    String.raw`\class{evil}{x}`,
    String.raw`\id{evil}{x}`,
    String.raw`\htmlClass{evil}{x}`,
  ])('does not run %s, which writes a link, a picture, a style or a name', (tex) => {
    const result = refused(tex)
    const elements = result.kind === 'math' ? everyElement(result.math) : []
    const forbidden = elements.flatMap((element) =>
      ['href', 'style', 'id'].filter((name) => element.attributes[name] !== undefined),
    )

    expect(forbidden).toEqual([])
    expect(
      elements.filter((element) => (element.attributes['class'] ?? '').includes('evil')),
    ).toEqual([])
  })

  it('says a formula that is too long is, rather than reading it', () => {
    expect(renderMath('x'.repeat(MAX_TEX_LENGTH + 1), false)).toEqual({
      kind: 'error',
      message: `This formula is longer than ${MAX_TEX_LENGTH} characters.`,
    })
  })

  it('does not fall over a formula nested too deeply for the stack', () => {
    const result = refused(`${'{'.repeat(15_000)}x${'}'.repeat(15_000)}`)

    expect(result.kind).toBe('error')
  })

  it('does not run a macro that expands for ever', () => {
    expect(refused(String.raw`\def\a{\a\a}\a`).kind).toBe('error')
  })

  it('does not draw a space or a box as wide as the author asks, only as wide as is sensible', () => {
    const math = mathOf(String.raw`\hspace{9999em} x`)

    const widths = everyElement(math).flatMap((element) =>
      element.attributes['width'] === undefined
        ? []
        : [Number.parseFloat(element.attributes['width'])],
    )
    expect(Math.max(...widths)).toBeLessThanOrEqual(120)
  })
})
