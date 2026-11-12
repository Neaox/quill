import type { Element, ElementContent, Properties } from 'hast'
import type { Schema } from 'hast-util-sanitize'

import { element, text } from '../render/hast-element.ts'
import { MATH_ATTRIBUTES, MATH_CLASS, MATH_TAGS } from './grant.ts'
import { renderMath } from './tree.ts'
import type { MathElement } from './tree.ts'

/**
 * How math is drawn in a document (ADR-064): a formula in a sentence, and a
 * block of its own.
 *
 * Each is one element the reading stylesheet knows (`prose.css`), holding the
 * formula's MathML, which the browser draws itself: selectable, searchable,
 * read aloud by a screen reader as maths, at the size and in the colour of the
 * text around it, in light and dark, with no script and no font to load. A
 * formula that is not valid TeX is shown as the TeX the author wrote, with
 * the reason, rather than dropped or turned into an error page: the rest of
 * the document reads, and the author can see what to fix.
 *
 * - `<span class="math" data-math="inline"><math>…</math></span>`
 * - `<div class="math" data-math="display"><math display="block">…</math></div>`
 */

type Definition = NonNullable<Schema['attributes']>[string]

/**
 * What the sanitiser admits for math: the MathML elements and the attributes they carry
 * (`grant.ts`), and the wrapper and error shapes below.
 */
export const MATH_SANITIZE_GRANT: {
  readonly tagNames: readonly string[]
  readonly classes: Readonly<Record<'span' | 'div', readonly string[]>>
  readonly attributes: {
    readonly span: Definition
    readonly div: Definition
    readonly mathml: Definition
  }
} = {
  tagNames: MATH_TAGS,
  classes: {
    span: ['math', 'math-error', 'math-error-message'],
    div: ['math', 'math-error'],
  },
  attributes: {
    span: [['data-math', 'inline']],
    div: [['data-math', 'display']],
    mathml: [
      ['className', MATH_CLASS],
      ...Object.entries(MATH_ATTRIBUTES).map(([name, pattern]): Definition[number] => [
        name,
        pattern,
      ]),
    ],
  },
}

function properties(attributes: MathElement['attributes']): Properties {
  const { class: classes, ...rest } = attributes
  return classes === undefined ? rest : { ...rest, className: classes.split(' ') }
}

function hastOf(node: MathElement | string): ElementContent {
  return typeof node === 'string'
    ? text(node)
    : element(node.tag, properties(node.attributes), node.children.map(hastOf))
}

/** The TeX the author wrote, with the reason it is not drawn: what an invalid formula shows instead. */
function errorElement(tex: string, display: boolean, message: string): Element {
  const reason = `Invalid math: ${message}`
  const source = element('code', { title: reason }, [text(tex)])
  return display
    ? element('div', { className: ['math', 'math-error'], 'data-math': 'display' }, [
        element('pre', {}, [source]),
        element('span', { className: ['math-error-message'] }, [text(reason)]),
      ])
    : element('span', { className: ['math', 'math-error'], 'data-math': 'inline' }, [
        source,
        element('span', { className: ['sr-only'] }, [text(reason)]),
      ])
}

/** A formula as the element a document holds: `$tex$` when `display` is false, a block when it is true. */
export function mathElement(tex: string, display: boolean): Element {
  const rendering = renderMath(tex, display)
  if (rendering.kind === 'error') return errorElement(tex, display, rendering.message)
  return element(
    display ? 'div' : 'span',
    { className: ['math'], 'data-math': display ? 'display' : 'inline' },
    [hastOf(rendering.math)],
  )
}
