import { describe, expect, it } from 'vitest'

import { answersToSend, defaultAnswers, readTemplateDeclaration } from './template-declaration.ts'

const ADR_FRONT_MATTER = {
  title: 'Architecture decision record',
  template: {
    name: 'Architecture decision record',
    category: 'Engineering',
    version: 3,
    questions: [
      {
        id: 'status',
        label: 'Initial status',
        type: 'choice',
        options: ['proposed', 'accepted'],
        default: 'proposed',
      },
      {
        id: 'securityReview',
        label: 'Does this touch secrets?',
        type: 'boolean',
        help: 'Adds a section.',
      },
      { id: 'supersedes', label: 'Supersedes', type: 'document', optional: true },
    ],
  },
}

describe('readTemplateDeclaration', () => {
  it('reads the name, category, and questions ADR-029 declares', () => {
    const declaration = readTemplateDeclaration(ADR_FRONT_MATTER)

    expect(declaration?.name).toBe('Architecture decision record')
    expect(declaration?.category).toBe('Engineering')
    expect(declaration?.questions.map((question) => question.id)).toEqual([
      'status',
      'securityReview',
      'supersedes',
    ])
    expect(declaration?.questions[0]?.options).toEqual(['proposed', 'accepted'])
    expect(declaration?.questions[1]?.help).toBe('Adds a section.')
    expect(declaration?.questions[2]?.optional).toBe(true)
  })

  it('is null for a document that is not a template', () => {
    expect(readTemplateDeclaration({ title: 'Runbook' })).toBeNull()
    expect(readTemplateDeclaration(undefined)).toBeNull()
  })

  it('keeps a template usable when its front matter is malformed', () => {
    const declaration = readTemplateDeclaration({
      template: {
        questions: ['not an object', { label: 'no id' }, { id: 'ok', type: 'nonsense' }],
      },
    })

    // Only the question that can be identified survives, and an unknown type
    // is asked for as text rather than dropping the question.
    expect(declaration?.questions).toEqual([
      {
        id: 'ok',
        label: 'ok',
        type: 'text',
        options: [],
        optional: false,
        help: undefined,
        defaultValue: undefined,
      },
    ])
  })

  it('treats a template with no questions as a template with no questions', () => {
    expect(readTemplateDeclaration({ template: { name: 'Blank-ish' } })?.questions).toEqual([])
  })
})

describe('defaultAnswers', () => {
  it('starts each question at its declared default, or at its type’s empty value', () => {
    expect(defaultAnswers(readTemplateDeclaration(ADR_FRONT_MATTER))).toEqual({
      status: 'proposed',
      securityReview: false,
      supersedes: '',
    })
  })

  it('is empty for a blank document', () => {
    expect(defaultAnswers(null)).toEqual({})
  })
})

describe('answersToSend', () => {
  it('drops answers nobody gave, so a skipped question adds no front-matter field', () => {
    const declaration = readTemplateDeclaration(ADR_FRONT_MATTER)

    expect(
      answersToSend(declaration, { status: 'accepted', securityReview: false, supersedes: '' }),
    ).toEqual({ status: 'accepted', securityReview: false })
  })

  it('ignores answers to questions the template never asked', () => {
    const declaration = readTemplateDeclaration(ADR_FRONT_MATTER)

    expect(answersToSend(declaration, { invented: 'yes' })).toEqual({})
  })
})
