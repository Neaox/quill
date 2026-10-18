import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { compareDocuments } from './compare.ts'
import { renderComparison } from './render.ts'

function render(before: string, after: string) {
  return renderComparison(compareDocuments(parseDocument(before).ast, parseDocument(after).ast))
}

describe('naming the sections of a comparison', () => {
  it('names a section for the heading as it reads now', () => {
    const { sections } = render(
      '# Guide\n\n## Install quickly\n\nRun it.\n',
      '# Guide\n\n## Install carefully\n\nRun it.\n',
    )

    expect(sections.map((section) => section.title)).toEqual(['Guide', 'Install carefully'])
  })

  it('names the section of a heading that was removed for the heading as it read', () => {
    const { sections, changes } = render(
      '# Guide\n\n## Old name\n\nText here.\n',
      '# Guide\n\nText here.\n',
    )

    expect(sections.map((section) => section.title)).toEqual(['Guide', 'Old name'])
    expect(changes.map((change) => change.section?.title)).toEqual(['Old name'])
  })
})

describe('drawing what a comparison holds', () => {
  it('draws a code block with no language, keeping the lines that did not change', () => {
    const { html } = render('```\nsame\nold\n```\n', '```\nsame\nnew\n```\n')

    expect(html).toContain('<span data-line="">same</span>')
    expect(html).not.toContain('data-lang')
  })

  it('draws a directive nobody defined as the source it was written in', () => {
    const { html } = render('Run :unknown[x] now.\n', 'Run :unknown[x] later.\n')

    expect(html).toContain(':unknown[x]')
  })
})
