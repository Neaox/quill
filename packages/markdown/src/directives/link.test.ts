import { describe, expect, it } from 'vitest'
import type { LeafDirective, TextDirective } from 'mdast-util-directive'
import type { Root } from 'mdast'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { effectiveDisplay, linkDirective } from './link.ts'
import type { Link } from './link.ts'
import { findDirective, validateDirectives } from './registry.ts'

function leaf(markdown: string): LeafDirective {
  const found = parseMarkdown(markdown).children.find(
    (node): node is LeafDirective => node.type === 'leafDirective',
  )
  if (found === undefined) throw new Error(`no leaf directive in ${markdown}`)
  return found
}

function inline(markdown: string): TextDirective {
  const [paragraph] = parseMarkdown(markdown).children
  const found =
    paragraph?.type === 'paragraph'
      ? paragraph.children.find((child) => child.type === 'textDirective')
      : undefined
  if (found === undefined) throw new Error(`no text directive in ${markdown}`)
  return found
}

/** What a save writes for a directive typed with bare values: the same, with each value quoted. */
function canonical(markdown: string): string {
  return (
    markdown
      .replace(/(display|layout|image)=([a-z]+)/gu, '$1="$2"')
      // The serialiser writes an empty value as the bare name, which reads back as empty.
      .replace(/ description=""/gu, ' description')
  )
}

/** Reads a directive and writes it back, as a save does. */
function roundTrip(markdown: string): string {
  const [first] = parseMarkdown(markdown).children
  const node = first?.type === 'leafDirective' ? leaf(markdown) : inline(markdown)
  const written = linkDirective.serialize(linkDirective.parse(node))
  const tree: Root =
    written.type === 'leafDirective'
      ? { type: 'root', children: [written] }
      : { type: 'root', children: [{ type: 'paragraph', children: [written] }] }
  return stringifyMdast(tree).trimEnd()
}

describe('link: reading', () => {
  it('reads a block link and everything the author chose', () => {
    const model = linkDirective.parse(
      leaf(
        '::link{url="https://example.com/a" display=card layout=top image=none title="Mine" description=""}',
      ),
    )
    expect(model).toEqual({
      url: 'https://example.com/a',
      text: null,
      choice: { display: 'card', layout: 'top', showImage: false, title: 'Mine', description: '' },
      unrecognisedDisplay: null,
      extra: {},
      form: 'leaf',
    })
  })

  it('reads the address from the label of an inline link, and takes it as no words of the author’s', () => {
    const model = linkDirective.parse(inline(':link[https://example.com/a]{display=inline}'))
    expect(model).toMatchObject({
      url: 'https://example.com/a',
      text: null,
      form: 'text',
      choice: { display: 'inline' },
    })
  })

  it('keeps the author’s words when the label is not the address', () => {
    const model = linkDirective.parse(
      inline(':link[the design doc]{url="https://example.com/d" display=inline}'),
    )
    expect(model).toMatchObject({ url: 'https://example.com/d', text: 'the design doc' })
  })

  it('has no display of its own when none was chosen, so the default decides', () => {
    const model = linkDirective.parse(inline(':link[https://example.com/a]'))
    expect(model.choice.display).toBeNull()
    expect(effectiveDisplay(model, 'card')).toBe('card')
    expect(effectiveDisplay(model, 'url')).toBe('url')
  })

  it('draws an unrecognised display as a plain link whatever the default is', () => {
    const model = linkDirective.parse(inline(':link[https://example.com/a]{display=bookmark}'))
    expect(model.choice.display).toBeNull()
    expect(model.unrecognisedDisplay).toBe('bookmark')
    expect(effectiveDisplay(model, 'card')).toBe('url')
  })

  it('treats an empty title as no override, and keeps an empty description as "hide it"', () => {
    const model = linkDirective.parse(
      leaf('::link{url="https://example.com/a" title="" description=""}'),
    )
    expect(model.choice.title).toBeNull()
    expect(model.choice.description).toBe('')
  })

  it('falls back to the default layout for one it does not know, and keeps what it saw', () => {
    const model = linkDirective.parse(leaf('::link{url="https://example.com/a" layout=huge}'))
    expect(model.choice.layout).toBe('side')
    expect(model.extra).toEqual({ layout: 'huge' })
  })
})

describe('link: a directive built without attributes', () => {
  it('reads as an inline link with nothing chosen', () => {
    const model = linkDirective.parse({
      type: 'textDirective',
      name: 'link',
      children: [{ type: 'text', value: 'https://example.com/a' }],
    })
    expect(model).toMatchObject({
      url: 'https://example.com/a',
      extra: {},
      choice: { display: null },
    })
  })
})

describe('link: an attribute with no value', () => {
  it('reads as the empty string, and is kept as an attribute this release does not understand', () => {
    const model = linkDirective.parse({
      type: 'textDirective',
      name: 'link',
      attributes: { pinned: null },
      children: [{ type: 'text', value: 'https://example.com/a' }],
    })
    expect(model.extra).toEqual({ pinned: '' })
  })
})

describe('link: writing it back', () => {
  it.each([
    '::link{url="https://example.com/a" display=card}',
    '::link{url="https://example.com/a" display=card layout=top}',
    '::link{url="https://example.com/a" display=card image=none}',
    '::link{url="https://example.com/a" display=card title="Mine" description="Why it matters"}',
    '::link{url="https://example.com/a" display=card description=""}',
    '::link{url="https://example.com/a"}',
    ':link[https://example.com/a]{display=inline}',
    ':link[https://example.com/a]',
    ':link[the design doc]{url="https://example.com/d" display=inline}',
  ])('writes %s back, with its values quoted as the serialiser always writes them', (markdown) => {
    expect(roundTrip(markdown)).toBe(canonical(markdown))
  })

  it('writes the attributes in a fixed order, so saving twice changes nothing', () => {
    const messy =
      '::link{description="d" title="t" image=none layout=top display=card url="https://example.com/a"}'
    const once = roundTrip(messy)
    expect(once).toBe(
      '::link{url="https://example.com/a" display="card" layout="top" image="none" title="t" description="d"}',
    )
    expect(roundTrip(once)).toBe(once)
  })

  it('writes "hide the description" as the bare name, and reads it back as the same choice', () => {
    expect(roundTrip('::link{url="https://example.com/a" description=""}')).toBe(
      '::link{url="https://example.com/a" description}',
    )
    expect(
      linkDirective.parse(leaf('::link{url="https://example.com/a" description}')).choice
        .description,
    ).toBe('')
  })

  it('keeps an attribute this release does not know (a newer release may have written it)', () => {
    expect(roundTrip('::link{url="https://example.com/a" display=card pinned=true}')).toBe(
      '::link{url="https://example.com/a" display="card" pinned="true"}',
    )
  })

  it('keeps a display this release does not know, as it was written', () => {
    expect(roundTrip(':link[https://example.com/a]{display=bookmark}')).toBe(
      ':link[https://example.com/a]{display="bookmark"}',
    )
  })

  it('keeps a layout value it did not understand', () => {
    expect(roundTrip('::link{url="https://example.com/a" display=card layout=huge}')).toBe(
      '::link{url="https://example.com/a" display="card" layout="huge"}',
    )
  })

  it('keeps an image value it did not understand', () => {
    expect(roundTrip('::link{url="https://example.com/a" image=hidden}')).toBe(
      '::link{url="https://example.com/a" image="hidden"}',
    )
  })

  it('writes a block link’s words as its label', () => {
    const model: Link = {
      url: 'https://example.com/a',
      text: 'Read this',
      choice: { display: 'card', layout: 'side', showImage: true, title: null, description: null },
      unrecognisedDisplay: null,
      extra: {},
      form: 'leaf',
    }
    expect(linkDirective.serialize(model)).toMatchObject({
      type: 'leafDirective',
      children: [{ type: 'text', value: 'Read this' }],
    })
  })
})

const issues = (markdown: string) => validateDirectives(parseMarkdown(markdown))

describe('link: checking it', () => {
  it('is claimed as both a block and an inline directive, by name', () => {
    expect(findDirective(leaf('::link{url="https://example.com/"}'))).toBe(linkDirective)
    expect(findDirective(inline(':link[https://example.com/]'))).toBe(linkDirective)
  })

  it('is content when it is well formed', () => {
    expect(
      issues('::link{url="https://example.com/a" display=card layout=top image=none}'),
    ).toEqual([])
    expect(issues('See :link[https://example.com/a]{display=inline} now.')).toEqual([])
  })

  it('warns, without refusing, about an address it cannot use', () => {
    expect(issues('::link{url="ftp://example.com/a"}')).toEqual([
      expect.objectContaining({ severity: 'warning', path: expect.stringContaining('url') }),
    ])
    expect(issues(':link[not an address]')).toHaveLength(1)
  })

  it('warns about a display or layout it does not know', () => {
    expect(issues('::link{url="https://example.com/a" display=bookmark}')[0]?.message).toContain(
      'bookmark',
    )
    expect(issues('::link{url="https://example.com/a" layout=huge}')[0]?.message).toContain('huge')
  })

  it('has nothing to say about a container form, which is not a link', () => {
    expect(
      linkDirective.validate({ type: 'containerDirective', name: 'link', children: [] }),
    ).toEqual([])
  })
})
