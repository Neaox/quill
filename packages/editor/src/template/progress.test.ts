import { parseDocument } from '@quill/markdown'
import { describe, expect, it } from 'vitest'

import { declaredSections, templateDeclaration, templateProgress } from './progress.ts'

const DECLARATION = [
  '---',
  'template:',
  '  name: Architecture decision record',
  '  version: 3',
  '  sections:',
  '    - heading: Context',
  '      required: true',
  '    - heading: Decision',
  '      required: true',
  '    - heading: Security considerations',
  '      required: true',
  '      when: securityReview',
  '    - heading: Alternatives considered',
  '      optional: true',
  '---',
  '',
].join('\n')

const BODY = [
  '## Context',
  '',
  'Sessions live in a Redis cluster sized for 2023 traffic.',
  '',
  '## Decision',
  '',
  ':::placeholder',
  'State the decision in one or two declarative sentences.',
  ':::',
  '',
  '## Security considerations',
  '',
  '',
].join('\n')

function progress(markdown: string) {
  return templateProgress(parseDocument(markdown).ast)
}

describe('the template checklist', () => {
  it('is empty for a document that was not made from a template', () => {
    expect(progress('# Just a document\n')).toMatchObject({ declared: false, total: 0 })
  })

  it('is empty when the front matter carries a reference rather than a declaration', () => {
    const reference = '---\ntemplate:\n  id: adr\n  version: 3\n---\n\n# A document\n'
    expect(progress(reference).declared).toBe(false)
  })

  it('is empty when the template block is not a mapping at all', () => {
    expect(progress('---\ntemplate: adr\n---\n\n# A\n').declared).toBe(false)
  })

  it('names the template and counts what has been started', () => {
    const result = progress(DECLARATION + BODY)
    expect(result.name).toBe('Architecture decision record')
    expect(result.total).toBe(4)
    expect(result.started).toBe(1)
  })

  it('says of each section whether it is started, a placeholder, empty, or not there', () => {
    const byHeading = Object.fromEntries(
      progress(DECLARATION + BODY).sections.map((section) => [section.heading, section.status]),
    )
    expect(byHeading).toEqual({
      Context: 'started',
      Decision: 'placeholder',
      'Security considerations': 'empty',
      'Alternatives considered': 'not-added',
    })
  })

  it('counts a section holding only guidance as not started either', () => {
    const onlyGuidance = [
      DECLARATION,
      '## Context',
      '',
      ':::guidance',
      'Keep it short.',
      ':::',
      '',
    ].join('\n')
    expect(progress(onlyGuidance).sections[0]?.status).toBe('placeholder')
  })

  it('counts a paragraph of inline placeholders as not started', () => {
    const inline = [DECLARATION, '## Context', '', ':placeholder[What happened]', ''].join('\n')
    expect(progress(inline).sections[0]?.status).toBe('placeholder')
  })

  it('names the required sections that are still incomplete, for the publish summary', () => {
    expect(progress(DECLARATION + BODY).incompleteRequired).toEqual([
      'Decision',
      'Security considerations',
    ])
  })

  it('keeps the flags the template declared, including the question a section waits on', () => {
    const sections = progress(DECLARATION + BODY).sections
    expect(sections[2]).toMatchObject({ required: true, when: 'securityReview', present: true })
    expect(sections[3]).toMatchObject({ optional: true, present: false })
  })

  it('stops a section at the next heading of the same level or above', () => {
    const nested = [
      DECLARATION,
      '## Context',
      '',
      '### A detail',
      '',
      'Detail prose.',
      '',
      '## Decision',
      '',
    ].join('\n')
    expect(progress(nested).sections[0]?.status).toBe('started')
    expect(progress(nested).sections[1]?.status).toBe('empty')
  })

  it('takes the first of two headings with the same text', () => {
    const repeated = [DECLARATION, '## Context', '', 'Real prose.', '', '## Context', ''].join('\n')
    expect(progress(repeated).sections[0]?.status).toBe('started')
  })

  it('ignores a declared section with no heading of its own', () => {
    const headless = '---\ntemplate:\n  name: T\n  version: 1\n  sections:\n    - {}\n---\n\n# A\n'
    expect(progress(headless).sections).toEqual([])
  })

  it('skips a declared section it cannot read, rather than naming it nothing', () => {
    expect(declaredSections({ sections: 'not a list' })).toEqual([])
    expect(declaredSections({})).toEqual([])
    expect(
      declaredSections({
        sections: ['a string', { required: true }, { heading: 'Real', when: 'answer' }],
      }),
    ).toEqual([{ heading: 'Real', required: false, optional: false, when: 'answer' }])
  })

  it('reads a declaration straight from front matter, and refuses a broken one', () => {
    expect(templateDeclaration('template:\n  name: T\n  version: 1\n')).toEqual({
      name: 'T',
      sections: [],
    })
    expect(templateDeclaration('template:\n  name: T\n')).toBeUndefined()
    expect(templateDeclaration('title: A\n')).toBeUndefined()
    expect(templateDeclaration('template:\n  version: 1\n  sections: nope\n')).toBeUndefined()
  })
})
