import { describe, expect, it } from 'vitest'
import { documentId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { DRAFT_CONTENT_VERSION } from '../ports/document-format.ts'
import { createFakeDocumentFormat, serialise } from './fake-document-format.ts'
import { createFakeClock, createFakeIdGenerator } from './fakes.ts'

const DOC = documentId('00000000-0000-4000-8000-000000000201')
const format = createFakeDocumentFormat()

const draft = (body: string, frontMatter: Record<string, unknown> = {}) => ({
  version: DRAFT_CONTENT_VERSION,
  frontMatter,
  ast: { body },
})

describe('createFakeDocumentFormat: create', () => {
  it('creates a blank document titled by its heading', () => {
    const created = format.create({ documentId: DOC, title: 'Overview' })
    expect(created.content.frontMatter).toEqual({ id: DOC, title: 'Overview' })
    expect(created.content.ast).toEqual({ body: '# Overview' })
    expect(created.requiredSections).toEqual([])
    expect(created.warnings).toEqual([])
  })

  it('resolves a template, leaving an unanswered substitution in place', () => {
    const created = format.create({
      documentId: DOC,
      title: 'Use Postgres',
      template: {
        markdown: serialise({ requiredSections: ['Decision'] }, '# {{ answers.a }} {{answers.b}}'),
        answers: { a: 'Answered' },
      },
    })
    expect(created.content.ast).toEqual({ body: '# Answered {{answers.b}}' })
    expect(created.requiredSections).toEqual(['Decision'])
  })

  it('warns about a placeholder a template left behind', () => {
    const created = format.create({
      documentId: DOC,
      title: 'ADR',
      template: { markdown: serialise({}, '::placeholder decide'), answers: {} },
    })
    expect(created.warnings.map((warning) => warning.code)).toEqual(['placeholder-remains'])
  })
})

describe('createFakeDocumentFormat: prepareForPublish', () => {
  it('stamps the id, strips placeholders, and reports the title', () => {
    const prepared = format.prepareForPublish({
      documentId: DOC,
      content: draft('# Overview\n::placeholder more\nBody.', { title: 'Overview' }),
    })
    expect(prepared.markdown).not.toContain('::placeholder')
    expect(prepared.frontMatter['id']).toBe(DOC)
    expect(prepared.title).toBe('Overview')
    expect(prepared.warnings).toEqual([{ code: 'placeholder-remains', detail: ' more' }])
    expect(prepared.frontMatterIssues).toEqual([])
  })

  it('reads a title from the body when front matter names none', () => {
    const prepared = format.prepareForPublish({ documentId: DOC, content: draft('# From body') })
    expect(prepared.title).toBe('From body')
    expect(prepared.frontMatterIssues).toEqual([{ path: 'title', message: 'must be a string' }])
  })

  it('has no title at all when there is neither', () => {
    expect(
      format.prepareForPublish({ documentId: DOC, content: draft('Body') }).title,
    ).toBeUndefined()
  })

  it('treats a draft with no usable tree as an empty body', () => {
    expect(
      format.prepareForPublish({
        documentId: DOC,
        content: { version: DRAFT_CONTENT_VERSION, frontMatter: {}, ast: null },
      }).markdown,
    ).toContain('')
    expect(
      format.prepareForPublish({
        documentId: DOC,
        content: { version: DRAFT_CONTENT_VERSION, frontMatter: {}, ast: { body: 7 } },
      }).title,
    ).toBeUndefined()
  })

  it('reports a required section that is missing or empty, and not one that is filled', () => {
    const required = { requiredSections: ['Context', 'Decision', 'Consequences'] }
    const prepared = format.prepareForPublish({
      documentId: DOC,
      content: draft('# Context\n\nSome context.\n\n# Decision\n\n', required),
    })
    expect(prepared.incompleteRequiredSections).toEqual(['Decision', 'Consequences'])
  })
})

describe('createFakeDocumentFormat: render and read', () => {
  it('renders the body, its outline, and its links', () => {
    const rendered = format.render({
      markdown: serialise(
        { title: 'Overview' },
        '# Overview\n\n[a](/d/x) and [b](https://example.com)',
      ),
      linkTitles: new Map(),
    })
    expect(rendered.html).toContain('<article>')
    expect(rendered.outline).toEqual([{ id: 'overview', depth: 1, text: 'Overview', children: [] }])
    expect(rendered.links.map((link) => link.external)).toEqual([false, true])
    expect(rendered.text.title).toBe('Overview')
    expect(rendered.slots).toEqual([])
  })

  it('shows an auto-titled link under the title its target carries now', () => {
    const target = '00000000-0000-4000-8000-000000000301'
    const markdown = serialise({ title: 'Overview' }, `# Overview\n\nSee [](/d/${target}).`)
    expect(
      format.render({ markdown, linkTitles: new Map([[target as DocumentId, 'Runbook']]) }).html,
    ).toContain(`[Runbook](/d/${target})`)
    // No title to hand: the link is left exactly as the author wrote it.
    expect(format.render({ markdown, linkTitles: new Map() }).html).toContain(`[](/d/${target})`)
  })

  it('turns published Markdown back into the content a draft holds', () => {
    const content = format.toDraft(serialise({ title: 'Overview' }, '# Overview'))
    expect(content).toEqual({
      version: 1,
      frontMatter: { title: 'Overview' },
      ast: { body: '# Overview' },
    })
  })

  it('reads front matter and title back out, and copes with markdown that has none', () => {
    expect(format.read(serialise({ title: 'Overview' }, '# Heading')).frontMatter).toEqual({
      title: 'Overview',
    })
    expect(format.read('# Just a body').title).toBe('Just a body')
    expect(format.read(['7', 'body'].join('\n---\n')).frontMatter).toEqual({})
  })
})

describe('the fake clock and id generator', () => {
  it('advances and resets only when told to', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const clock = createFakeClock(start)
    clock.advance(1000)
    expect(clock.now()).toEqual(new Date('2026-01-01T00:00:01.000Z'))
    clock.set(start)
    expect(clock.now()).toEqual(start)
  })

  it('generates distinct, valid identifiers', () => {
    const ids = createFakeIdGenerator()
    expect(ids.uuid()).toBe('00000000-0000-4000-8000-000000000001')
    expect(ids.uuid()).not.toBe('00000000-0000-4000-8000-000000000001')
    expect(createFakeIdGenerator('1111').uuid()).toBe('11110000-0000-4000-8000-000000000001')
  })
})
