import { describe, expect, it } from 'vitest'
import type { ContainerDirective, TextDirective } from 'mdast-util-directive'
import type { Root } from 'mdast'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { calloutDirective, isCalloutType } from './callout.ts'
import {
  attribute,
  bodyOf,
  claims,
  directiveKind,
  flag,
  isDirective,
  issue,
  label,
  labelParagraph,
  textChildren,
} from './definition.ts'
import { guidanceDirective } from './guidance.ts'
import { kbdDirective } from './kbd.ts'
import { isLayoutDirectiveName, isLayoutWidth, layoutDirective } from './layout.ts'
import { notesDirective } from './notes.ts'
import { optionalDirective } from './optional.ts'
import { placeholderDirective } from './placeholder.ts'
import { findDirective, validateDirectives } from './registry.ts'
import { repeatDirective } from './repeat.ts'
import { whenDirective } from './when.ts'

function directives(markdown: string): ContainerDirective[] {
  return parseMarkdown(markdown).children.filter(
    (node): node is ContainerDirective => node.type === 'containerDirective',
  )
}

function first(markdown: string): ContainerDirective {
  const [found] = directives(markdown)
  if (found === undefined) throw new Error(`no container directive in ${markdown}`)
  return found
}

function inlineDirective(markdown: string): TextDirective {
  const [paragraph] = parseMarkdown(markdown).children
  const found =
    paragraph?.type === 'paragraph'
      ? paragraph.children.find((child) => child.type === 'textDirective')
      : undefined
  if (found === undefined) throw new Error(`no text directive in ${markdown}`)
  return found
}

function write(node: ContainerDirective | TextDirective): string {
  const tree: Root = { type: 'root', children: [{ type: 'paragraph', children: [] }] }
  return stringifyMdast(
    node.type === 'containerDirective'
      ? { ...tree, children: [node] }
      : { ...tree, children: [{ type: 'paragraph', children: [node] }] },
  )
}

describe('definition helpers', () => {
  it('names the three directive shapes', () => {
    expect(directiveKind(first(':::a\nx\n:::\n'))).toBe('container')
    expect(isDirective({ type: 'leafDirective' })).toBe(true)
    expect(isDirective({ type: 'paragraph' })).toBe(false)
  })

  it('reads attributes, treating an absent one as undefined', () => {
    const node = first(':::callout{type=warning}\nx\n:::\n')

    expect(attribute(node, 'type')).toBe('warning')
    expect(attribute(node, 'missing')).toBeUndefined()
  })

  it('reads a valueless attribute as a flag', () => {
    expect(flag(first(':::optional{title=A added}\nx\n:::\n'), 'added')).toBe(true)
    expect(flag(first(':::optional{title=A}\nx\n:::\n'), 'added')).toBe(false)
    expect(flag(first(':::optional{title=A added=false}\nx\n:::\n'), 'added')).toBe(false)
    expect(flag({ type: 'containerDirective', name: 'a', children: [] }, 'added')).toBe(false)
  })

  it('reads a label from any of the three shapes', () => {
    expect(label(first(':::callout[Before you begin]{type=note}\nx\n:::\n'))).toBe(
      'Before you begin',
    )
    expect(label(first(':::callout{type=note}\nx\n:::\n'))).toBeUndefined()
    expect(label(first(':::callout\n:::\n'))).toBeUndefined()
    expect(label(inlineDirective('A :badge[stable] one.\n'))).toBe('stable')
  })

  it('separates a label paragraph from the body', () => {
    const node = first(':::callout[Label]{type=note}\n\nBody.\n:::\n')

    expect(bodyOf(node)).toHaveLength(1)
    expect(bodyOf(first(':::callout\n:::\n'))).toEqual([])
  })

  it('builds label paragraphs, inline text and issues', () => {
    expect(labelParagraph('Hello').data).toEqual({ directiveLabel: true })
    expect(textChildren('Hello')).toEqual([{ type: 'text', value: 'Hello' }])
    expect(issue('type', 'message', 'error')).toEqual({
      path: 'type',
      message: 'message',
      severity: 'error',
    })
  })
})

describe('callout', () => {
  it('parses the type, the label and the body', () => {
    const model = calloutDirective.parse(
      first(':::callout[Heads up]{type=warning}\n\nBody.\n:::\n'),
    )

    expect(model.type).toBe('warning')
    expect(model.label).toBe('Heads up')
    expect(model.children).toHaveLength(1)
  })

  it('degrades an unknown type to a note, and says so', () => {
    const node = first(':::callout{type=nuclear}\nBody.\n:::\n')

    expect(calloutDirective.parse(node).type).toBe('note')
    expect(calloutDirective.validate(node)[0]?.severity).toBe('warning')
  })

  it('accepts a callout with no type at all', () => {
    const node = first(':::callout\nBody.\n:::\n')

    expect(calloutDirective.validate(node)).toEqual([])
    expect(isCalloutType('tip')).toBe(true)
    expect(isCalloutType(3)).toBe(false)
  })

  it('writes a callout back, with and without a label', () => {
    const model = calloutDirective.parse(
      first(':::callout[Heads up]{type=warning}\n\nBody.\n:::\n'),
    )

    expect(write(calloutDirective.serialize(model))).toContain(':::callout[Heads up]')
    expect(write(calloutDirective.serialize({ ...model, label: undefined }))).toContain(
      ':::callout{type="warning"}',
    )
  })
})

describe('layout', () => {
  it('knows the three widths and the two that are written as wrappers', () => {
    expect(isLayoutWidth('content')).toBe(true)
    expect(isLayoutWidth('enormous')).toBe(false)
    expect(isLayoutDirectiveName('full')).toBe(true)
    expect(isLayoutDirectiveName('content')).toBe(false)
  })

  it('parses a wrapper and writes it back', () => {
    const model = layoutDirective.parse(first(':::full\n\nBody.\n:::\n'))

    expect(model.width).toBe('full')
    expect(write(layoutDirective.serialize(model))).toBe(':::full\nBody.\n:::\n')
  })

  it('defaults to the narrower width for a node that is not a layout wrapper', () => {
    expect(layoutDirective.parse(first(':::other\nBody.\n:::\n')).width).toBe('wide')
  })

  it('accepts a wrapper with no attributes object at all', () => {
    expect(
      layoutDirective.validate({ type: 'containerDirective', name: 'wide', children: [] }),
    ).toEqual([])
  })

  it('warns about attributes a layout wrapper cannot carry', () => {
    expect(layoutDirective.validate(first(':::wide\nBody.\n:::\n'))).toEqual([])
    expect(layoutDirective.validate(first(':::wide{id=x}\nBody.\n:::\n'))[0]?.path).toBe(
      'attributes',
    )
  })
})

describe('template blocks', () => {
  it('parses an inline placeholder and a block placeholder', () => {
    const block = placeholderDirective.parse(first(':::placeholder\nSay what changed.\n:::\n'))

    expect(block).toEqual({ prompt: 'Say what changed.', block: true })
    expect(write(placeholderDirective.serialize(block))).toContain(':::placeholder')

    const inline = placeholderDirective.serialize({ prompt: 'Say why', block: false })
    expect(write(inline)).toBe(':placeholder[Say why]\n')
  })

  it('warns about a placeholder with no prompt', () => {
    expect(placeholderDirective.validate(first(':::placeholder\n:::\n'))[0]?.severity).toBe(
      'warning',
    )
    expect(placeholderDirective.validate(first(':::placeholder\nPrompt.\n:::\n'))).toEqual([])
  })

  it('parses, checks and writes guidance', () => {
    const node = first(':::guidance\nExplain the trade-off.\n:::\n')
    const model = guidanceDirective.parse(node)

    expect(guidanceDirective.validate(node)).toEqual([])
    expect(guidanceDirective.validate(first(':::guidance\n:::\n'))).toHaveLength(1)
    expect(write(guidanceDirective.serialize(model))).toBe(
      ':::guidance\nExplain the trade-off.\n:::\n',
    )
  })

  it('parses, checks and writes presenter notes', () => {
    const node = first(':::notes\nMention the migration.\n:::\n')

    expect(notesDirective.parse(node).children).toHaveLength(1)
    expect(notesDirective.validate(node)).toEqual([])
    expect(notesDirective.validate(first(':::notes\n:::\n'))).toHaveLength(1)
    expect(write(notesDirective.serialize(notesDirective.parse(node)))).toContain(':::notes')
  })

  it('parses an optional section and whether it was added', () => {
    const offered = optionalDirective.parse(first(':::optional{title="Alternatives"}\nx\n:::\n'))
    const added = optionalDirective.parse(
      first(':::optional{title="Alternatives" added}\nx\n:::\n'),
    )

    expect(offered).toMatchObject({ title: 'Alternatives', added: false })
    expect(added.added).toBe(true)
    expect(write(optionalDirective.serialize(added))).toContain(' added}')
    expect(write(optionalDirective.serialize(offered))).not.toContain('added')
  })

  it('requires an optional section to have a title', () => {
    expect(optionalDirective.validate(first(':::optional{title=A}\nx\n:::\n'))).toEqual([])
    expect(optionalDirective.validate(first(':::optional\nx\n:::\n'))[0]?.severity).toBe('error')
  })

  it('parses a when block and requires a question', () => {
    const node = first(':::when{question=securityReview}\nx\n:::\n')

    expect(whenDirective.parse(node).question).toBe('securityReview')
    expect(whenDirective.validate(node)).toEqual([])
    expect(whenDirective.validate(first(':::when\nx\n:::\n'))[0]?.path).toBe('question')
    expect(whenDirective.validate(first(':::when{question="  "}\nx\n:::\n'))).toHaveLength(1)
    expect(whenDirective.parse(first(':::when\nx\n:::\n')).question).toBe('')
    expect(write(whenDirective.serialize(whenDirective.parse(node)))).toContain(
      'question="securityReview"',
    )
  })

  it('parses a repeat block and requires a title', () => {
    const node = first(':::repeat{title=Alternative}\nx\n:::\n')

    expect(repeatDirective.parse(node).title).toBe('Alternative')
    expect(repeatDirective.validate(node)).toEqual([])
    expect(repeatDirective.validate(first(':::repeat\nx\n:::\n'))[0]?.severity).toBe('error')
    expect(write(repeatDirective.serialize(repeatDirective.parse(node)))).toContain(':::repeat')
  })
})

describe('kbd', () => {
  it('reads the keys it names', () => {
    expect(kbdDirective.parse(inlineDirective('Press :kbd[Ctrl+C] to stop.\n'))).toEqual({
      keys: 'Ctrl+C',
    })
  })

  it('warns when it names no keys', () => {
    expect(kbdDirective.validate(inlineDirective('Press :kbd[] now.\n'))).toEqual([
      { path: '', message: 'A keyboard directive needs the keys it names.', severity: 'warning' },
    ])
    expect(kbdDirective.validate(inlineDirective('Press :kbd[Esc] now.\n'))).toEqual([])
  })

  it('writes back as an inline directive', () => {
    expect(write(kbdDirective.serialize({ keys: 'Ctrl+C' }))).toBe(':kbd[Ctrl+C]\n')
  })
})

describe('registry', () => {
  it('finds the definition that claims a directive', () => {
    expect(findDirective(inlineDirective('Press :kbd[Esc] now.\n'))).toBe(kbdDirective)
    expect(findDirective(first(':::callout\nx\n:::\n'))).toBe(calloutDirective)
    expect(findDirective(first(':::timeline\nx\n:::\n'))).toBeUndefined()
  })

  it('checks every directive in a document and names where the problem is', () => {
    const issues = validateDirectives(
      parseMarkdown(
        [
          'Text.',
          '',
          ':::callout{type=nuclear}',
          'x',
          ':::',
          '',
          ':::optional',
          'x',
          ':::',
          '',
          ':::guidance',
          ':::',
          '',
          ':::unknown',
          'x',
          ':::',
          '',
        ].join('\n'),
      ),
    )

    expect(issues.map((found) => found.path)).toEqual([
      'callout[0].type',
      'optional[1].title',
      'guidance[2]',
    ])
  })

  it('leaves an unknown directive alone, whatever shape it takes', () => {
    expect(
      validateDirectives(parseMarkdown('A :mystery[x]{k=v} inline.\n\n::mystery{k=v}\n')),
    ).toEqual([])
  })

  it('does not claim a directive written in the wrong shape', () => {
    expect(claims(calloutDirective, inlineDirective('A :callout[x] inline.\n'))).toBe(false)
  })
})
