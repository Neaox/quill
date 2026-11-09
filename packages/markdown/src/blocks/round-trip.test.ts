import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { Fragment, Slice } from 'prosemirror-model'
import type { Node as PMNode } from 'prosemirror-model'

import { createMarkdownRegistry } from '../extensions/registry.ts'
import { parseDocument } from '../pipeline/parse-document.ts'
import { serializeDocument } from '../pipeline/serialize-document.ts'
import { mdastToProseMirror } from '../prosemirror/from-mdast.ts'
import { liftLayout, wrapLayout } from '../prosemirror/layout.ts'
import { schema } from '../prosemirror/schema.ts'
import { proseMirrorToMdast } from '../prosemirror/to-mdast.ts'
import { renderDocument } from '../render/html.ts'
import { endpointBlock } from './endpoint.ts'
import { ROOKWOOD_SHAPED } from './test-support.ts'

/**
 * Component blocks through the editor and onto the page, over a document
 * written the way rookwood's request guide is (`corpus/29-component-blocks.md`).
 *
 * The editor holds a block as the container, leaf or text directive it is
 * written as, with its attributes exactly as they were typed, so a block it
 * cannot edit richly still comes back byte for byte, and an edit around or
 * inside one changes only the lines the edit touched.
 */

const FIXTURE = readFileSync(
  fileURLToPath(new URL('../../corpus/29-component-blocks.md', import.meta.url)),
  'utf8',
)

/**
 * Every construct of the documentation kit, written as rookwood's guide
 * writes it (`corpus/30-docs-kit.md`). `prosemirror/real-docs.test.ts` runs
 * the same first save over rookwood's own pages when `QUILL_REAL_DOCS` names
 * them.
 */
const DOCS_KIT = readFileSync(
  fileURLToPath(new URL('../../corpus/30-docs-kit.md', import.meta.url)),
  'utf8',
)

/** Into the editor's document, through `edit`, and saved, as the editor saves. */
function saved(markdown: string, edit: (doc: PMNode) => PMNode = (doc) => doc): string {
  const parsed = parseDocument(markdown)
  const { doc } = mdastToProseMirror(parsed.ast, { softBreaks: 'collapse' })
  return serializeDocument({
    frontMatter: parsed.frontMatter,
    ast: proseMirrorToMdast(wrapLayout(edit(liftLayout(doc)))).tree,
  })
}

/** Lines removed and added between two texts, by a plain longest-common-subsequence diff. */
function changes(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split('\n')
  const b = after.split('\n')
  const table = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  )
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = table[i] ?? []
      row[j] =
        a[i] === b[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const removed: string[] = []
  const added: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1
      j += 1
    } else if (
      j < b.length &&
      (i >= a.length || (table[i]?.[j + 1] ?? 0) >= (table[i + 1]?.[j] ?? 0))
    ) {
      added.push(b[j] ?? '')
      j += 1
    } else {
      removed.push(a[i] ?? '')
      i += 1
    }
  }
  return { removed, added }
}

/** Replaces the first `find` in the document's text with `replace`, keeping its marks. */
function retyped(find: string, replace: string): (doc: PMNode) => PMNode {
  return (doc) => {
    let from = -1
    doc.descendants((node, position) => {
      if (from >= 0) return false
      const index = node.isText ? (node.text?.indexOf(find) ?? -1) : -1
      if (index >= 0) from = position + index
      return true
    })
    if (from < 0) throw new Error(`"${find}" is not in the document`)
    const marks = doc.resolve(from + 1).marks()
    const text = new Slice(Fragment.from(schema.text(replace, marks)), 0, 0)
    return doc.replace(from, from + find.length, text)
  }
}

/** The document without its first top-level container directive called `name`. */
function without(name: string): (doc: PMNode) => PMNode {
  return (doc) => {
    const children: PMNode[] = []
    let removed = false
    doc.forEach((child) => {
      const match = child.type.name === 'containerDirective' && child.attrs['name'] === name
      if (match && !removed) removed = true
      else children.push(child)
    })
    return doc.copy(Fragment.fromArray(children))
  }
}

describe('a document of component blocks, through the editor', () => {
  it('comes back byte for byte when nothing is edited', () => {
    expect(saved(FIXTURE)).toBe(FIXTURE)
  })

  it('changes only the edited line when the edit is inside a nested block', () => {
    expect(changes(FIXTURE, saved(FIXTURE, retyped('stops sending', 'no longer sends')))).toEqual({
      removed: ['After a hard bounce, rookwood stops sending to that address.'],
      added: ['After a hard bounce, rookwood no longer sends to that address.'],
    })
  })

  it('changes only the edited line when the edit is beside the blocks', () => {
    expect(changes(FIXTURE, saved(FIXTURE, retyped('A page written', 'A page set')))).toEqual({
      removed: [expect.stringMatching(/^A page written/u)],
      added: [expect.stringMatching(/^A page set/u)],
    })
  })

  it('keeps a block’s attributes as typed when its label is edited', () => {
    expect(changes(FIXTURE, saved(FIXTURE, retyped('the public API', 'the API')))).toEqual({
      removed: [':::details[:server: `api`: the public API]{open}'],
      added: [':::details[:server: `api`: the API]{open}'],
    })
  })

  it('removes exactly a block’s own lines when the block is deleted', () => {
    const { removed, added } = changes(FIXTURE, saved(FIXTURE, without('timeline')))
    expect(added).toEqual([])
    expect(removed[0]).toBe('::::timeline')
    expect(removed.at(-1)).toBe('')
    expect(removed).toContain(':::step{icon=shield tone=net}')
    expect(removed.filter((line) => line === '::::')).toHaveLength(1)
  })

  it('writes an unknown block it was never able to draw back unchanged after an edit elsewhere', () => {
    const after = saved(FIXTURE, retyped('Saves the report', 'Stores the report'))
    expect(after).toContain(':::checks\n\n1. The address is confirmed.\n')
    expect(after).toContain(':::endpoint{method=FETCH path=/webhooks/postmark}\n')
  })
})

describe('the same document, read', () => {
  it('is legible before its blocks are installed, and says which are missing', () => {
    const { html, blockIssues } = renderDocument(parseDocument(FIXTURE).ast, {
      extensions: createMarkdownRegistry([], [endpointBlock]),
    })
    expect(html).toContain('aria-label="Unknown block: timeline"')
    expect(html).toContain('aria-label="Unknown block: step"')
    expect(html).toContain('The API skips an address that bounced')
    expect(html).toContain('<summary>')
    expect(html).toContain('class="qb qb-endpoint"')
    expect(blockIssues.map((issue) => `${String(issue.line)}: ${issue.block}`)).toEqual([
      '9: cast',
      '21: timeline',
      '23: step',
      '25: route',
      '35: step',
      '37: route',
      '49: checks',
      '70: endpoint',
    ])
  })

  it('is drawn by Quill’s own blocks, with no unknown block left', () => {
    const { html, blockIssues } = renderDocument(parseDocument(FIXTURE).ast)
    expect(html).not.toContain('block-fallback')
    expect(html).toContain('<ul class="qb qb-cast">')
    expect(html).toContain('<ol class="qb qb-timeline"><li class="qb qb-step">')
    expect(html).toContain('<span class="qb-step-node" data-qb-tone="net">')
    expect(html).toContain(
      '<p class="qb-step-when"><span class="badge qb-step-chip">Before sending</span>',
    )
    expect(html).toContain('<ol class="qb qb-checks"><li>The address is confirmed.</li>')
    expect(html).toContain(
      '<span class="badge" data-tone="neutral" data-badge="plan">Designed</span>',
    )
    // Only the bad prop the fixture writes on purpose is reported.
    expect(blockIssues).toEqual([
      {
        block: 'endpoint',
        message:
          'method: “FETCH” is not one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS; drawn as GET',
        line: 70,
      },
    ])
  })

  it('is drawn by blocks a test registers in their place', () => {
    const { html } = renderDocument(parseDocument(FIXTURE).ast, {
      extensions: createMarkdownRegistry([], [endpointBlock, ...ROOKWOOD_SHAPED]),
    })
    expect(html).toContain('<span class="qb-step-node" data-qb-icon="shield" data-qb-tone="net">')
  })
})

describe('the documentation kit, through the editor', () => {
  it('comes back byte for byte when nothing is edited', () => {
    expect(saved(DOCS_KIT)).toBe(DOCS_KIT)
  })

  it('keeps every fence as written when a step with nothing nested in it is edited', () => {
    expect(
      changes(DOCS_KIT, saved(DOCS_KIT, retyped('Only nights that differ', 'Only changed nights'))),
    ).toEqual({
      removed: ['Only nights that differ are sent.'],
      added: ['Only changed nights are sent.'],
    })
  })

  it('changes only the edited line when a step’s when-line is edited', () => {
    expect(changes(DOCS_KIT, saved(DOCS_KIT, retyped('Any time later', 'Later')))).toEqual({
      removed: [':clock: **Any time later** · :globe: Harbour Stays → :inbox: Gateway'],
      added: [':clock: **Later** · :globe: Harbour Stays → :inbox: Gateway'],
    })
  })

  it('changes only the edited line when a cast member or a route is edited', () => {
    expect(changes(DOCS_KIT, saved(DOCS_KIT, retyped('Owns a cottage', 'Owns a bach')))).toEqual({
      removed: ['- :person: **Mere Tane** · Owns a cottage by the sea'],
      added: ['- :person: **Mere Tane** · Owns a bach by the sea'],
    })
    const { removed, added } = changes(
      DOCS_KIT,
      saved(DOCS_KIT, retyped('Rates, both ways', 'Rates')),
    )
    expect(removed).toEqual([expect.stringContaining('Rates, both ways')])
    expect(added).toEqual([
      expect.stringContaining(':route[:building: Tidewater ⇄ :home: Quill Lodge]'),
    ])
  })

  it('is drawn with no unknown block and no issue', () => {
    const { html, blockIssues } = renderDocument(parseDocument(DOCS_KIT).ast)
    expect(blockIssues).toEqual([])
    expect(html).not.toContain('block-fallback')
    expect(html.match(/class="qb qb-step"/gu)).toHaveLength(6)
  })
})
