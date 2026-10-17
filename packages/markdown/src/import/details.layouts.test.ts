import { describe, expect, it } from 'vitest'

import { importDetails } from './details.ts'

describe('importing collapsible sections written without every part', () => {
  it('keeps a Material for MkDocs section that has a title and no kind', () => {
    expect(importDetails('??? "Just a title"\n    Body.\n')).toBe(
      ':::details[Just a title]\nBody.\n:::\n',
    )
  })

  it('writes a Material for MkDocs section with neither title nor kind as a bare details', () => {
    expect(importDetails('???\n    Body.\n')).toBe(':::details\nBody.\n:::\n')
  })

  it('writes the kind and the open state of a Material for MkDocs section as attributes', () => {
    expect(importDetails('???+ tip "Hint"\n    Body.\n')).toBe(
      ':::details[Hint]{type=tip open}\nBody.\n:::\n',
    )
  })

  it('reads the accordions of a group that has blank lines between them', () => {
    expect(
      importDetails(
        '<Accordions>\n\n<Accordion title="A">\na\n</Accordion>\n\n<Accordion title="B">\nb\n</Accordion>\n\n</Accordions>\n',
      ),
    ).toBe('::::accordion\n:::details[A]\na\n:::\n:::details[B]\nb\n:::\n::::\n')
  })

  it('leaves a group with no accordion in it as written', () => {
    for (const source of [
      '<Accordions>\n</Accordions>\n',
      '<AccordionGroup>\n\n</AccordionGroup>\n',
    ]) {
      expect(importDetails(source)).toBe(source)
    }
  })
})
