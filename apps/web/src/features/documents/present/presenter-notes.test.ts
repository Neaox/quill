import { describe, expect, it } from 'vitest'

import type { PresentStep } from './present-steps.ts'
import { notesForSteps } from './presenter-notes.ts'

const STEPS: readonly PresentStep[] = [
  { id: 'failover', title: 'Regional failover', html: '' },
  { id: 'steps', title: 'Steps', html: '' },
  { id: 'afterwards', title: 'Afterwards', html: '' },
]

describe('notesForSteps', () => {
  it('gives each section the notes written under its heading', () => {
    const markdown = [
      '# Regional failover',
      '',
      ':::notes',
      'Say why we are here.',
      ':::',
      '',
      '## Steps',
      '',
      ':::notes',
      'Pause after step two.',
      ':::',
      '',
      '## Afterwards',
      '',
      'Tell the on-call engineer.',
      '',
    ].join('\n')

    expect(notesForSteps(markdown, STEPS)).toEqual({
      failover: 'Say why we are here.',
      steps: 'Pause after step two.',
    })
  })

  it('gives notes above the first section to the opening step', () => {
    const markdown = ':::notes\nThirty seconds of context.\n:::\n\n## Steps\n'

    expect(notesForSteps(markdown, STEPS)['failover']).toBe('Thirty seconds of context.')
  })

  it('keeps a note written under a sub-heading with the section it is in', () => {
    const markdown = '## Steps\n\n### In detail\n\n:::notes\nThe detail.\n:::\n'

    expect(notesForSteps(markdown, STEPS)).toEqual({ steps: 'The detail.' })
  })

  it('joins several notes in one section, in order', () => {
    const markdown = '## Steps\n\n:::notes\nFirst.\n:::\n\ntext\n\n:::notes\nSecond.\n:::\n'

    expect(notesForSteps(markdown, STEPS)['steps']).toBe('First.\n\nSecond.')
  })

  it('keeps a multi-line note whole', () => {
    const markdown = '## Steps\n\n:::notes\nOne line.\n\nAnother line.\n:::\n'

    expect(notesForSteps(markdown, STEPS)['steps']).toBe('One line.\n\nAnother line.')
  })

  it('matches a heading whose markup only changes how it looks', () => {
    const markdown = '## **Steps**\n\n:::notes\nStill the steps.\n:::\n'

    expect(notesForSteps(markdown, STEPS)['steps']).toBe('Still the steps.')
  })

  it('reads nothing out of a fenced code block', () => {
    const markdown = [
      '## Steps',
      '',
      '```markdown',
      '## Afterwards',
      ':::notes',
      'Not a note.',
      ':::',
      '```',
      '',
      ':::notes',
      'A real note.',
      ':::',
      '',
    ].join('\n')

    expect(notesForSteps(markdown, STEPS)).toEqual({ steps: 'A real note.' })
  })

  it('keeps a fenced block inside a note, `:::` and all', () => {
    const markdown = '## Steps\n\n:::notes\n```text\n:::\n```\nAfter.\n:::\n'

    expect(notesForSteps(markdown, STEPS)['steps']).toBe('```text\n:::\n```\nAfter.')
  })

  it('reports nothing for a document with no notes at all', () => {
    expect(notesForSteps('# Regional failover\n\nText.\n', STEPS)).toEqual({})
    expect(notesForSteps('', STEPS)).toEqual({})
  })
})
