import { describe, expect, it } from 'vitest'

import {
  documentOwners,
  humanise,
  joinList,
  readProperties,
  splitList,
  summarise,
  templateQuestions,
  writeProperty,
  STATUS_VALUES,
} from './front-matter.ts'
import type { PropertyField } from './front-matter.ts'

const FRONT_MATTER: Record<string, unknown> = {
  id: '9f2c2b3a-6f55-4f2e-8f0e-7f2a1b0c3d4e',
  title: 'Reading surface tour',
  type: 'design',
  status: 'published',
  owners: ['platform@example.com', 'docs@example.com'],
  tags: ['design-system', 'showcase'],
  review: { interval: '90d', lastReviewed: '2026-01-05' },
  layout: 'wide',
  somethingNobodyKnows: 'kept',
}

function field(key: string, frontMatter = FRONT_MATTER): PropertyField {
  const model = readProperties(frontMatter)
  const found = [...model.fields, ...model.questions].find((entry) => entry.key === key)
  if (found === undefined) throw new Error(`No "${key}" field.`)
  return found
}

describe('the fields a document offers', () => {
  it('shows the seven properties a writer edits, in a fixed order', () => {
    expect(readProperties(FRONT_MATTER).fields.map((entry) => entry.key)).toEqual([
      'title',
      'type',
      'status',
      'owners',
      'tags',
      'review.interval',
      'layout',
    ])
  })

  it('reads the statuses from the schema rather than repeating them', () => {
    expect(STATUS_VALUES).toContain('draft')
    expect(field('status').options?.map((option) => option.value)).toEqual(['', ...STATUS_VALUES])
  })

  it('shows a list as one line, and reads it back as a list', () => {
    expect(field('owners').value).toBe('platform@example.com, docs@example.com')
    expect(splitList(' one ,, two ')).toEqual(['one', 'two'])
    expect(joinList('already text')).toBe('already text')
  })

  it('shows the title but does not offer to change it, because the body does', () => {
    expect(field('title')).toMatchObject({ kind: 'readonly', value: 'Reading surface tour' })
  })

  it('falls back to the first heading when no title is declared', () => {
    const model = readProperties({}, { headingTitle: 'Untitled draft' })
    expect(model.fields[0]).toMatchObject({ key: 'title', value: 'Untitled draft' })
  })

  it('says so beside the field when a review interval is not one', () => {
    expect(field('review.interval').error).toBeUndefined()
    expect(field('review.interval', { review: { interval: 'soon' } }).error).toContain('90d')
  })

  it('lists every key it has no control for, so nothing is hidden (rule 7)', () => {
    expect(readProperties(FRONT_MATTER).other).toEqual([
      { key: 'id', value: FRONT_MATTER['id'] },
      { key: 'somethingNobodyKnows', value: 'kept' },
    ])
  })

  it('shows a value of any shape in the other list, JSON where it has to', () => {
    expect(readProperties({ extra: { deep: [1, 2] } }).other).toEqual([
      { key: 'extra', value: '{"deep":[1,2]}' },
    ])
  })

  it('summarises a document in the four facts the closed strip shows', () => {
    expect(summarise(FRONT_MATTER)).toEqual({
      type: 'design',
      status: 'published',
      owners: ['platform@example.com', 'docs@example.com'],
      tags: ['design-system', 'showcase'],
    })
    expect(summarise({})).toEqual({ type: undefined, status: undefined, owners: [], tags: [] })
  })

  it('reads the owners a document declares, for the header readout', () => {
    expect(documentOwners(FRONT_MATTER)).toEqual(['platform@example.com', 'docs@example.com'])
    expect(documentOwners({})).toEqual([])
  })

  it('turns a key or a question id into words', () => {
    expect(humanise('in_review')).toBe('In review')
    expect(humanise('securityReview')).toBe('Security review')
    // A label a person already wrote keeps the capitals they chose.
    expect(humanise('ADR accepted')).toBe('ADR accepted')
  })
})

describe("a template's questions, which live in its front matter (ADR-029)", () => {
  it('offers no questions to a document merely created from a template', () => {
    // `{ id, version }` is what a created document carries; only a template
    // declaration carries questions.
    expect(templateQuestions({ template: { id: 'adr', version: 1 } })).toEqual([])
  })

  const declaration: Record<string, unknown> = {
    id: 'template-1',
    template: {
      name: 'Architecture decision record',
      version: 3,
      questions: [
        { id: 'initialStatus', label: 'Initial status', type: 'choice', options: ['Proposed'] },
        { id: 'touchesAuth', label: 'Touches auth', type: 'boolean', help: 'Data or secrets.' },
        { id: 'decidedOn', label: 'Decided on', type: 'date' },
        { id: 'supersedes', label: 'Supersedes', type: 'document' },
        'not a question',
      ],
    },
    initialStatus: 'Proposed',
    touchesAuth: true,
    decidedOn: '2026-02-01',
  }

  it('reads only the questions that are questions', () => {
    expect(templateQuestions(declaration).map((question) => question.id)).toEqual([
      'initialStatus',
      'touchesAuth',
      'decidedOn',
      'supersedes',
    ])
    expect(templateQuestions({})).toEqual([])
    expect(templateQuestions({ template: { id: 'a-template', version: 2 } })).toEqual([])
  })

  it('gives every answer type a control, and shows the answer the document holds', () => {
    const model = readProperties(declaration)
    expect(model.questions).toMatchObject([
      { key: 'initialStatus', kind: 'select', value: 'Proposed' },
      { key: 'touchesAuth', kind: 'select', value: 'true', help: 'Data or secrets.' },
      { key: 'decidedOn', kind: 'date', value: '2026-02-01' },
      { key: 'supersedes', kind: 'text', value: '' },
    ])
  })

  it('reads a declaration that asks nothing as asking nothing', () => {
    expect(templateQuestions({ template: { name: 'Bare', version: 1 } })).toEqual([])
  })

  it('shows a no answer, a choice with no options, and an answer with no text form', () => {
    const model = readProperties({
      template: {
        name: 'Edge cases',
        version: 1,
        questions: [
          { id: 'touchesAuth', label: 'Touches auth', type: 'boolean' },
          { id: 'audience', label: 'Audience', type: 'choice' },
          { id: 'supersedes', label: 'Supersedes', type: 'document' },
          { id: 'attempts', label: 'Attempts', type: 'text' },
        ],
      },
      touchesAuth: false,
      supersedes: { id: 'doc-1' },
      attempts: 3,
    })
    expect(model.questions).toMatchObject([
      { key: 'touchesAuth', kind: 'select', value: 'false' },
      { key: 'audience', kind: 'select', options: [{ value: '' }] },
      { key: 'supersedes', kind: 'text', value: '{"id":"doc-1"}' },
      { key: 'attempts', kind: 'text', value: '3' },
    ])
  })

  it('keeps an answer out of the other list, because the question already shows it', () => {
    expect(readProperties(declaration).other).toEqual([{ key: 'id', value: 'template-1' }])
  })

  it('offers an unanswered boolean no answer at all rather than a false one', () => {
    const [, touches] = readProperties({ ...declaration, touchesAuth: undefined }).questions
    expect(touches?.value).toBe('')
  })
})

describe('writing one property back', () => {
  it('changes a value in place, leaving every other key where it was', () => {
    const next = writeProperty(FRONT_MATTER, field('type'), 'runbook')
    expect(Object.keys(next)).toEqual(Object.keys(FRONT_MATTER))
    expect(next['type']).toBe('runbook')
    expect(next['somethingNobodyKnows']).toBe('kept')
  })

  it('removes a key rather than leaving it empty', () => {
    const next = writeProperty(FRONT_MATTER, field('type'), '   ')
    expect(Object.hasOwn(next, 'type')).toBe(false)
    expect(Object.keys(next)).toEqual(Object.keys(FRONT_MATTER).filter((key) => key !== 'type'))
  })

  it('appends a key the document did not have', () => {
    const next = writeProperty({ id: 'x' }, field('status'), 'draft')
    expect(Object.keys(next)).toEqual(['id', 'status'])
  })

  it('removes a list whose text holds nothing but separators', () => {
    expect(Object.hasOwn(writeProperty(FRONT_MATTER, field('tags'), ' , , '), 'tags')).toBe(false)
  })

  it('writes a list as a list', () => {
    expect(writeProperty(FRONT_MATTER, field('tags'), 'one, two ,three')['tags']).toEqual([
      'one',
      'two',
      'three',
    ])
  })

  it('trims what it writes, because the document keeps what it is given', () => {
    expect(writeProperty(FRONT_MATTER, field('type'), ' design ')['type']).toBe('design')
  })

  it('writes a nested key without disturbing its siblings', () => {
    const next = writeProperty(FRONT_MATTER, field('review.interval'), '1y')
    expect(next['review']).toEqual({ interval: '1y', lastReviewed: '2026-01-05' })
  })

  it('removes the whole branch when its last value goes', () => {
    const one = { review: { interval: '90d' } }
    expect(Object.hasOwn(writeProperty(one, field('review.interval'), ''), 'review')).toBe(false)
  })

  it('creates the branch when the document has none, or has the wrong shape', () => {
    expect(writeProperty({}, field('review.interval'), '30d')['review']).toEqual({
      interval: '30d',
    })
    expect(writeProperty({ review: 'yearly' }, field('review.interval'), '1y')['review']).toEqual({
      interval: '1y',
    })
  })

  it('writes a yes or no answer as a boolean, which is what a condition reads', () => {
    const question: PropertyField = {
      key: 'touchesAuth',
      label: 'Touches auth',
      kind: 'select',
      value: '',
    }
    expect(writeProperty({}, question, 'true')['touchesAuth']).toBe(true)
    expect(writeProperty({}, question, 'false')['touchesAuth']).toBe(false)
  })
})
