import { Type } from '@sinclair/typebox'
import { describe, expect, it } from 'vitest'

import { CoreFrontMatterSchema, mergeFrontMatterSchemas, ReviewSchema } from './core-schema.ts'
import { ensureDocumentId } from './document-id.ts'
import {
  isTemplateDeclaration,
  TemplateDeclarationSchema,
  TEMPLATE_QUESTION_TYPES,
} from './template-schema.ts'
import { createFrontMatterValidator, toFrontMatterIssue, validateFrontMatter } from './validate.ts'
import { readFrontMatter, writeFrontMatter } from './yaml-document.ts'

const ID = '0bd9e2a6-3a3a-4a2e-9d1e-3f5c9d2b7a11'

describe('readFrontMatter', () => {
  it('reads a mapping', () => {
    expect(readFrontMatter('title: One\norder: 2\n')).toEqual({
      value: { title: 'One', order: 2 },
      warnings: [],
    })
  })

  it('treats empty front matter as an empty mapping', () => {
    expect(readFrontMatter('')).toEqual({ value: {}, warnings: [] })
  })

  it('warns instead of throwing on malformed YAML', () => {
    const { value, warnings } = readFrontMatter(': :\n  - [\n')

    expect(value).toEqual({})
    expect(warnings[0]?.code).toBe('front-matter-parse')
  })

  it('warns when the document is not a mapping', () => {
    expect(readFrontMatter('- one\n').warnings[0]).toEqual({
      code: 'front-matter-not-a-mapping',
      detail: 'object',
    })
  })
})

describe('writeFrontMatter', () => {
  it('returns nothing for an empty record with no source', () => {
    expect(writeFrontMatter({}, undefined)).toBeUndefined()
  })

  it('returns the source untouched for an empty record, rather than discarding it', () => {
    expect(writeFrontMatter({}, 'unparseable: [')).toBe('unparseable: [')
  })

  it('writes a fresh block when there is no source', () => {
    expect(writeFrontMatter({ id: ID, order: 1 }, undefined)).toBe(`id: ${ID}\norder: 1`)
  })

  it('returns the source byte for byte when nothing changed', () => {
    const source = '# comment\ntitle: One\nnested:\n  a: 1\n'

    expect(writeFrontMatter({ title: 'One', nested: { a: 1 } }, source)).toBe(source)
  })

  it('edits only the field that changed', () => {
    const source = '# comment\ntitle: One\nnested:\n  a: 1\n'
    const output = writeFrontMatter({ title: 'Two', nested: { a: 1 } }, source)

    expect(output).toBe('# comment\ntitle: Two\nnested:\n  a: 1')
  })

  it('rewrites the block when the source could not be parsed', () => {
    expect(writeFrontMatter({ title: 'One' }, ': :\n  - [')).toBe('title: One')
  })
})

describe('ensureDocumentId', () => {
  it('leaves an existing identifier alone without consulting the generator', () => {
    const result = ensureDocumentId({ id: ID, title: 'One' }, () => {
      throw new Error('generator must not be called when an id exists')
    })

    expect(result).toEqual({ frontMatter: { id: ID, title: 'One' }, assigned: false })
  })

  it('assigns one when it is missing, and puts it first', () => {
    const result = ensureDocumentId({ title: 'One' }, () => ID)

    expect(result.assigned).toBe(true)
    expect(Object.keys(result.frontMatter)).toEqual(['id', 'title'])
  })

  it('replaces an identifier that is not a usable string', () => {
    const result = ensureDocumentId({ id: null, title: 'One' }, () => ID)

    expect(result.frontMatter).toEqual({ id: ID, title: 'One' })
  })
})

describe('validateFrontMatter', () => {
  it('accepts a document with only an identifier', () => {
    expect(validateFrontMatter({ id: ID })).toEqual({ valid: true, issues: [] })
  })

  it('accepts the full core vocabulary', () => {
    const result = validateFrontMatter({
      id: ID,
      title: 'One',
      description: 'A document.',
      type: 'adr',
      status: 'published',
      owners: ['platform'],
      tags: ['markdown'],
      order: 3,
      layout: 'wide',
      review: { interval: '365d', lastReviewed: '2026-01-31' },
      template: { id: 'adr', version: 3 },
    })

    expect(result).toEqual({ valid: true, issues: [] })
  })

  it('allows fields it has never heard of', () => {
    expect(validateFrontMatter({ id: ID, whateverComesNext: { deeply: ['nested'] } }).valid).toBe(
      true,
    )
  })

  it('reports a missing identifier rather than throwing', () => {
    const { valid, issues } = validateFrontMatter({ title: 'One' })

    expect(valid).toBe(false)
    expect(issues[0]?.keyword).toBe('required')
  })

  it('reports the path of a nested problem', () => {
    const { issues } = validateFrontMatter({ id: ID, review: { interval: 'soon' } })

    expect(issues[0]?.path).toBe('review.interval')
  })

  it('reports the index of an array element', () => {
    const { issues } = validateFrontMatter({ id: ID, owners: ['platform', ''] })

    expect(issues[0]?.path).toBe('owners[1]')
  })

  it('rejects a status outside the document lifecycle', () => {
    expect(validateFrontMatter({ id: ID, status: 'in-review' }).valid).toBe(false)
  })

  it('rejects a layout width that is not one of the three', () => {
    expect(validateFrontMatter({ id: ID, layout: 'enormous' }).valid).toBe(false)
  })

  it('accepts a template declaration in place of a template reference', () => {
    const result = validateFrontMatter({
      id: ID,
      template: {
        name: 'Architecture decision record',
        category: 'Engineering',
        version: 3,
        questions: [{ id: 'status', label: 'Initial status', type: 'choice', options: ['a'] }],
        sections: [{ heading: 'Context', required: true }],
        metadata: { type: 'adr' },
      },
    })

    expect(result).toEqual({ valid: true, issues: [] })
  })

  it('rejects a template question whose type is not one of the declared ones', () => {
    const result = validateFrontMatter({
      id: ID,
      template: {
        name: 'Runbook',
        version: 1,
        questions: [{ id: 'x', label: 'X', type: 'colour' }],
      },
    })

    expect(result.valid).toBe(false)
    expect(TEMPLATE_QUESTION_TYPES).not.toContain('colour')
  })
})

describe('toFrontMatterIssue', () => {
  it('falls back to the keyword when ajv reports no message', () => {
    const issue = toFrontMatterIssue({
      instancePath: '/review/~1odd~0key',
      schemaPath: '#/x',
      keyword: 'type',
      params: {},
    })

    expect(issue).toEqual({ path: 'review./odd~key', keyword: 'type', message: 'fails type' })
  })
})

describe('mergeFrontMatterSchemas', () => {
  const workspace = Type.Object({
    costCentre: Type.String({ minLength: 1 }),
    confidentiality: Type.Optional(Type.String()),
  })

  it('accumulates properties and keeps every requirement', () => {
    const validate = createFrontMatterValidator(
      mergeFrontMatterSchemas(CoreFrontMatterSchema, workspace),
    )

    expect(validate({ id: ID, costCentre: 'PLAT' }).valid).toBe(true)
    expect(validate({ id: ID }).valid).toBe(false)
    expect(validate({ costCentre: 'PLAT' }).valid).toBe(false)
  })

  it('still allows unknown fields whatever the inputs say', () => {
    const closed = Type.Object(
      { extra: Type.Optional(Type.String()) },
      {
        additionalProperties: false,
      },
    )
    const validate = createFrontMatterValidator(mergeFrontMatterSchemas(closed))

    expect(validate({ anything: 1 }).valid).toBe(true)
  })

  it('lets a later schema refine an earlier definition of the same field', () => {
    const stricter = Type.Object({ order: Type.Integer({ minimum: 10 }) })
    const validate = createFrontMatterValidator(
      mergeFrontMatterSchemas(CoreFrontMatterSchema, stricter),
    )

    expect(validate({ id: ID, order: 3 }).valid).toBe(false)
    expect(validate({ id: ID, order: 30 }).valid).toBe(true)
  })
})

describe('schemas', () => {
  it('describes the review cycle as a count and a unit', () => {
    const validate = createFrontMatterValidator(ReviewSchema)

    expect(validate({ interval: '90d' }).valid).toBe(true)
    expect(validate({ interval: '2y' }).valid).toBe(true)
    expect(validate({ interval: '0d' }).valid).toBe(false)
  })

  it('requires a template to name itself and carry a version', () => {
    const validate = createFrontMatterValidator(TemplateDeclarationSchema)

    expect(validate({ name: 'Runbook', version: 1 }).valid).toBe(true)
    expect(validate({ name: 'Runbook' }).valid).toBe(false)
  })
})

describe('isTemplateDeclaration', () => {
  it('recognises a template declaring itself', () => {
    expect(isTemplateDeclaration({ name: 'Runbook', version: 1 })).toBe(true)
    expect(isTemplateDeclaration({ name: 'Runbook', version: 1, questions: [] })).toBe(true)
  })

  it('treats an unnamed template block as a declaration, not a reference', () => {
    expect(isTemplateDeclaration({ version: 1 })).toBe(true)
    expect(isTemplateDeclaration({})).toBe(true)
  })

  it('rejects the reference a created document carries', () => {
    expect(isTemplateDeclaration({ id: ID, version: 2 })).toBe(false)
  })

  it('rejects anything that is not a template block', () => {
    for (const value of [undefined, null, 'adr', 3, ['name'], true]) {
      expect(isTemplateDeclaration(value)).toBe(false)
    }
  })
})
