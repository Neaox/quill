import type { ContainerDirective, LeafDirective } from 'mdast-util-directive'
import { describe, expect, it } from 'vitest'

import type { DetailsDirective } from './details.ts'
import { accordionDirective, DETAILS, detailsDirective, detailsModel } from './details.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtmlWith } from '../render/html.ts'

const container = (name: string): ContainerDirective => ({
  type: 'containerDirective',
  name,
  children: [],
})

describe('a details written without attributes', () => {
  it('is closed, ungrouped and a plain details', () => {
    const bare: DetailsDirective = { type: 'containerDirective', name: DETAILS, children: [] }

    expect(detailsModel(bare)).toMatchObject({
      open: false,
      name: undefined,
      kind: undefined,
    })
  })
})

const SOURCE = ['<details>', '<summary></summary>', '', 'Body.', '', '</details>', ''].join('\n')

describe('reading a details whose summary tag is empty', () => {
  it('reads it as a details with no summary', () => {
    const [node] = parseMarkdown(SOURCE).children

    expect(node?.type === 'details' && detailsModel(node).summary).toBeUndefined()
    expect(node?.type).toBe('details')
  })
})

describe('checking directives that are not details', () => {
  it('has nothing to say about a directive with another name', () => {
    expect(detailsDirective.validate(container('callout'))).toEqual([])
    expect(accordionDirective.validate(container('callout'))).toEqual([])
  })

  it('has nothing to say about an accordion that holds only details', () => {
    const accordion: ContainerDirective = {
      ...container('accordion'),
      children: [container('details')],
    }

    expect(accordionDirective.validate(accordion)).toEqual([])
  })

  it('has nothing to say about an accordion that is not a container', () => {
    const leaf: LeafDirective = { type: 'leafDirective', name: 'accordion', children: [] }

    expect(accordionDirective.validate(leaf)).toEqual([])
  })
})

describe('drawing a details with nothing around it', () => {
  it('draws it ungrouped, as it would a details whose container is not an accordion', () => {
    const [quote] = parseMarkdown('> :::details[A]\n> x\n> :::\n').children
    const html = renderHtmlWith(
      { type: 'root', children: quote === undefined ? [] : [quote] },
      {},
      {
        handlers: (handlers) => ({
          ...handlers,
          blockquote: (state, node) => {
            const [inner] = node.children
            return inner === undefined ? undefined : state.one(inner, undefined)
          },
        }),
      },
    )

    expect(html).toContain('<details class="details">')
  })
})
