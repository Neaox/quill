import { describe, expect, it } from 'vitest'

import { incompleteRequiredSections } from './required-sections.ts'

describe('incompleteRequiredSections', () => {
  it('has nothing to report when a document declares no required sections', () => {
    expect(incompleteRequiredSections('# Anything', [])).toEqual([])
  })

  it('reports a heading that is missing entirely', () => {
    expect(incompleteRequiredSections('# Context\n\nSome context.\n', ['Decision'])).toEqual([
      'Decision',
    ])
  })

  it('reports a heading with nothing but blank lines under it', () => {
    const markdown =
      '# Context\n\nSome context.\n\n## Decision\n\n   \n\n## Consequences\n\nNone.\n'
    expect(incompleteRequiredSections(markdown, ['Context', 'Decision', 'Consequences'])).toEqual([
      'Decision',
    ])
  })

  it('counts a subheading as content of the section it sits in', () => {
    const markdown = '## Decision\n\n### Rationale\n\nBecause.\n'
    expect(incompleteRequiredSections(markdown, ['Decision', 'Rationale'])).toEqual([])
  })

  it('counts a code block as content, and ignores headings inside one', () => {
    const markdown = '## Decision\n\n```md\n# Not a heading\n```\n\n## Alternatives\n'
    expect(incompleteRequiredSections(markdown, ['Decision', 'Not a heading'])).toEqual([
      'Not a heading',
    ])
    expect(incompleteRequiredSections(markdown, ['Alternatives'])).toEqual(['Alternatives'])
  })

  it('matches a heading regardless of case, trailing hashes, or spacing', () => {
    const markdown = '##   decision   ##\n\nAgreed.\n'
    expect(incompleteRequiredSections(markdown, ['Decision'])).toEqual([])
  })

  it('skips front matter, so a comment in it is never read as a heading', () => {
    const markdown = '---\ntitle: A\n# a comment\n---\n\n## Decision\n\nAgreed.\n'
    expect(incompleteRequiredSections(markdown, ['Decision', 'a comment'])).toEqual(['a comment'])
  })

  it('copes with front matter that is never closed', () => {
    expect(incompleteRequiredSections('---\ntitle: A\n', ['Decision'])).toEqual(['Decision'])
  })
})
