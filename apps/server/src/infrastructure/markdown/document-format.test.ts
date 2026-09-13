import { describe, expect, it } from 'vitest'
import { RENDERED_CONTENT_VERSION } from '@quill/application'
import { parseDocument } from '@quill/markdown'
import { documentId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { createDocumentFormat } from './document-format.ts'

/**
 * The adapter between the use cases and `packages/markdown`: what a document
 * looks like when it is created, what a publish writes, and what a reader is
 * served.
 */

const DOC = documentId('00000000-0000-4000-8000-000000000201')
const TEMPLATE_ID = '00000000-0000-4000-8000-000000000901'
const format = createDocumentFormat()

const draftOf = (markdown: string) => {
  const { frontMatter, ast } = parseDocument(markdown)
  return { version: 1, frontMatter, ast }
}

describe('createDocumentFormat: create', () => {
  it('creates a blank document with its id and title in front matter', () => {
    const created = format.create({ documentId: DOC, title: 'Authentication architecture' })
    expect(created.content.frontMatter).toEqual({
      id: DOC,
      title: 'Authentication architecture',
    })
    expect(created.requiredSections).toEqual([])
    expect(created.warnings).toEqual([])

    const prepared = format.prepareForPublish({ documentId: DOC, content: created.content })
    expect(prepared.markdown).toContain('# Authentication architecture')
  })

  it('instantiates a template: conditions resolved, answers substituted, nothing conditional left', () => {
    const template = [
      '---',
      `id: ${TEMPLATE_ID}`,
      'template:',
      '  name: Architecture decision record',
      '  version: 3',
      '  questions:',
      '    - id: securityReview',
      '      label: Does this touch authentication?',
      '      type: boolean',
      '  sections:',
      '    - heading: Context',
      '      required: true',
      '    - heading: Security considerations',
      '      when: securityReview',
      '      required: true',
      '  metadata:',
      '    type: adr',
      '---',
      '',
      '# {{ answers.title }}',
      '',
      '## Context',
      '',
      ':::guidance',
      'Say why this decision was needed.',
      ':::',
      '',
      ':::when{question="securityReview"}',
      '## Security considerations',
      ':::',
      '',
      ':::optional{title="Alternatives considered"}',
      '## Alternatives considered',
      ':::',
    ].join('\n')

    const created = format.create({
      documentId: DOC,
      title: 'Use Postgres',
      template: { markdown: template, answers: { securityReview: true, title: 'Use Postgres' } },
    })

    expect(created.requiredSections).toEqual(['Context', 'Security considerations'])
    expect(created.content.frontMatter).toMatchObject({
      id: DOC,
      title: 'Use Postgres',
      type: 'adr',
      securityReview: true,
      requiredSections: ['Context', 'Security considerations'],
      template: { id: TEMPLATE_ID, version: 3 },
    })

    const prepared = format.prepareForPublish({ documentId: DOC, content: created.content })
    expect(prepared.markdown).toContain('# Use Postgres')
    expect(prepared.markdown).toContain('## Security considerations')
    // Conditionals, guidance, and sections nobody added never reach a revision.
    expect(prepared.markdown).not.toContain(':::when')
    expect(prepared.markdown).not.toContain('Say why this decision was needed.')
    expect(prepared.markdown).not.toContain('Alternatives considered')
    expect(prepared.incompleteRequiredSections).toEqual(['Context', 'Security considerations'])
  })

  it('drops a section whose condition the answers do not satisfy', () => {
    const template = [
      '---',
      `id: ${TEMPLATE_ID}`,
      'template:',
      '  name: ADR',
      '  version: 1',
      '  questions:',
      '    - id: securityReview',
      '      label: Security?',
      '      type: boolean',
      '  sections:',
      '    - heading: Security considerations',
      '      when: securityReview',
      '      required: true',
      '---',
      '',
      ':::when{question="securityReview"}',
      '## Security considerations',
      ':::',
    ].join('\n')

    const created = format.create({
      documentId: DOC,
      title: 'No security review',
      template: { markdown: template, answers: { securityReview: false } },
    })
    expect(created.requiredSections).toEqual([])
    expect(created.content.frontMatter).not.toHaveProperty('requiredSections')
  })

  it('accepts a template document that has not declared itself', () => {
    const created = format.create({
      documentId: DOC,
      title: 'From a bare template',
      template: { markdown: '# A body and nothing else\n', answers: {} },
    })
    expect(created.requiredSections).toEqual([])
    expect(created.content.frontMatter).not.toHaveProperty('template')
  })

  it('falls back to a usable declaration when the template block is malformed', () => {
    for (const declaration of ['template: not-an-object', 'template:\n  - a list']) {
      const created = format.create({
        documentId: DOC,
        title: 'Odd template',
        template: {
          markdown: `---\nid: ${TEMPLATE_ID}\n${declaration}\n---\n\n# Body\n`,
          answers: {},
        },
      })
      expect(created.content.frontMatter).toMatchObject({ id: DOC, title: 'Odd template' })
    }
  })

  it('defaults a declaration that names no version', () => {
    const created = format.create({
      documentId: DOC,
      title: 'Versionless',
      template: {
        markdown: `---\nid: ${TEMPLATE_ID}\ntemplate:\n  name: 7\n---\n\n# Body\n`,
        answers: {},
      },
    })
    expect(created.content.frontMatter).toMatchObject({
      template: { id: TEMPLATE_ID, version: 1 },
    })
  })
})

describe('createDocumentFormat: prepareForPublish', () => {
  it('strips authoring scaffolding, warns about it, and publishes anyway', () => {
    const content = draftOf(
      [
        '---',
        'title: With scaffolding',
        '---',
        '',
        '# With scaffolding',
        '',
        ':::placeholder',
        'Describe the decision.',
        ':::',
        '',
        ':::guidance',
        'A hint for the author.',
        ':::',
      ].join('\n'),
    )

    const prepared = format.prepareForPublish({ documentId: DOC, content })
    expect(prepared.markdown).not.toContain('placeholder')
    expect(prepared.markdown).not.toContain('A hint for the author.')
    expect(prepared.warnings).toEqual([
      { code: 'placeholder-remains', detail: 'Describe the decision.' },
    ])
    expect(prepared.title).toBe('With scaffolding')
    expect(prepared.frontMatter['id']).toBe(DOC)
  })

  it('keeps every authoring block when the document published is itself a template', () => {
    const body = [
      '# Runbook',
      '',
      ':::guidance',
      'Explain what the reader is looking at.',
      ':::',
      '',
      ':placeholder[Name the service.]',
      '',
      ':::optional{title="Escalation"}',
      '## Escalation',
      '',
      'Who to page.',
      ':::',
      '',
      ':::when{question="hasRollback"}',
      '## Rollback',
      '',
      ':::repeat{title="Step"}',
      '### Step',
      '',
      ':placeholder[What to undo.]',
      ':::',
      ':::',
      '',
      '## Overview',
    ].join('\n')
    const content = draftOf(
      [
        '---',
        'title: Runbook',
        'type: template',
        'template:',
        '  name: Runbook',
        '  version: 1',
        '  questions:',
        '    - id: hasRollback',
        '      label: Can this be rolled back?',
        '      type: boolean',
        '---',
        '',
        body,
      ].join('\n'),
    )

    const prepared = format.prepareForPublish({ documentId: DOC, content })
    expect(prepared.warnings).toEqual([])
    for (const block of [':::guidance', ':placeholder', ':::optional', ':::when', ':::repeat']) {
      expect(prepared.markdown).toContain(block)
    }
    expect(prepared.markdown).toContain('## Escalation')
    expect(prepared.markdown).toContain('## Rollback')
    expect(prepared.markdown).toContain('### Step')
    expect(prepared.markdown).toContain('What to undo.')

    // A document created from what was published still has the template to
    // resolve, and its own publish is the one that strips.
    const created = format.create({
      documentId: DOC,
      title: 'Payments runbook',
      template: { markdown: prepared.markdown, answers: { hasRollback: true } },
    })
    const republished = format.prepareForPublish({ documentId: DOC, content: created.content })
    expect(republished.markdown).toContain('## Rollback')
    expect(republished.markdown).toContain('### Step')
    expect(republished.markdown).not.toContain(':::')
    expect(republished.markdown).not.toContain(':placeholder')
    expect(republished.warnings.map((warning) => warning.code)).toEqual([
      'placeholder-remains',
      'placeholder-remains',
    ])
  })

  it('publish keeps :::notes in the source and out of the body', () => {
    const content = draftOf(
      [
        '---',
        'title: Rollout plan',
        '---',
        '',
        '# Rollout plan',
        '',
        'Shown to the room.',
        '',
        ':::notes',
        '## Not a section',
        '',
        'Said aloud, see [the runbook](https://example.com/runbook).',
        ':::',
        '',
        '## Next steps',
        '',
        ':::guidance',
        'Still scaffolding.',
        ':::',
      ].join('\n'),
    )

    const prepared = format.prepareForPublish({ documentId: DOC, content })
    // The source keeps the note, so presentation mode can read it back.
    expect(prepared.markdown).toContain(':::notes')
    expect(prepared.markdown).toContain('Said aloud')
    expect(prepared.markdown).not.toContain('Still scaffolding.')
    expect(prepared.warnings).toEqual([])

    // What a reader is served never carries it.
    const rendered = format.render({ markdown: prepared.markdown, linkTitles: new Map() })
    expect(rendered.html).toContain('Shown to the room.')
    expect(rendered.html).not.toContain('Said aloud')
    expect(rendered.html).not.toContain('Not a section')
    expect(rendered.outline.map((entry) => entry.text)).toEqual(['Rollout plan'])
    expect(rendered.outline[0]?.children.map((entry) => entry.text)).toEqual(['Next steps'])
    expect(rendered.links).toEqual([])
    expect(rendered.text.body).toBe('Shown to the room.')
    expect(rendered.text.headings).toEqual(['Rollout plan', 'Next steps'])
  })

  it('still strips a document that references the template it was made from', () => {
    const content = draftOf(
      [
        '---',
        'title: From a template',
        'template:',
        `  id: ${TEMPLATE_ID}`,
        '  version: 1',
        '---',
        '',
        '# From a template',
        '',
        ':::guidance',
        'A hint for the author.',
        ':::',
      ].join('\n'),
    )

    const prepared = format.prepareForPublish({ documentId: DOC, content })
    expect(prepared.markdown).not.toContain('A hint for the author.')
  })

  it('reports front matter that does not match the schema, and still writes it', () => {
    const content = draftOf('---\ntitle: ""\nowners: notalist\n---\n\n# Body\n')
    const prepared = format.prepareForPublish({ documentId: DOC, content })
    expect(prepared.frontMatterIssues.length).toBeGreaterThan(0)
    expect(prepared.markdown).toContain('owners: notalist')
  })

  it('takes a title from the first heading when front matter names none', () => {
    const prepared = format.prepareForPublish({
      documentId: DOC,
      content: draftOf('# A heading title\n\nBody.\n'),
    })
    expect(prepared.title).toBe('A heading title')
  })

  it('treats a draft that holds no tree as an empty document', () => {
    for (const ast of [null, 'not a tree', { type: 'paragraph' }]) {
      const prepared = format.prepareForPublish({
        documentId: DOC,
        content: { version: 1, frontMatter: {}, ast },
      })
      expect(prepared.title).toBeUndefined()
      expect(prepared.markdown).toContain(DOC)
    }
  })
})

describe('createDocumentFormat: render and read', () => {
  const markdown = [
    '---',
    `id: ${DOC}`,
    'title: Rendered',
    'requiredSections: [Decision]',
    '---',
    '',
    '# Rendered',
    '',
    'A body with [a link](/d/00000000-0000-4000-8000-000000000202) and one to',
    '[the web](https://example.com).',
    '',
    '## Detail',
    '',
    '```ts',
    'const a = 1',
    '```',
    '',
    '## Decision',
  ].join('\n')

  it('renders the body, the outline, the text, and the links', () => {
    const rendered = format.render({ markdown, linkTitles: new Map() })
    expect(rendered.version).toBe(RENDERED_CONTENT_VERSION)
    expect(rendered.html).toContain('<article>')
    // The fence tag was `ts`; `data-lang` reports the grammar the packed
    // ranges were actually produced for (ADR-030).
    expect(rendered.html).toContain('data-lang="typescript"')
    expect(rendered.outline).toHaveLength(1)
    expect(rendered.outline[0]?.children.map((child) => child.text)).toEqual(['Detail', 'Decision'])
    expect(rendered.text.title).toBe('Rendered')
    expect(rendered.links.map((link) => link.external)).toEqual([false, true])
    expect(rendered.slots).toEqual([])
    expect(rendered.incompleteRequiredSections).toEqual(['Decision'])
  })

  it('renders a body whose code blocks the highlighter declines to tokenize', () => {
    const plain = createDocumentFormat({ highlighter: () => null })
    expect(plain.render({ markdown, linkTitles: new Map() }).html).not.toContain('data-tokens')
  })

  it('reads front matter and the title back without rendering', () => {
    expect(format.read(markdown)).toMatchObject({ title: 'Rendered' })
    expect(format.read('# Only a heading\n').title).toBe('Only a heading')
    expect(format.read('---\ntitle: ""\n---\n\nNo heading.\n').title).toBeUndefined()
  })

  it('ignores a requiredSections list that is not a list of strings', () => {
    expect(
      format.render({
        markdown: `---\nid: ${DOC}\nrequiredSections: 7\n---\n\n# Body\n`,
        linkTitles: new Map(),
      }).incompleteRequiredSections,
    ).toEqual([])
    expect(
      format.render({
        markdown: `---\nid: ${DOC}\nrequiredSections: [7, Decision]\n---\n\n# Body\n`,
        linkTitles: new Map(),
      }).incompleteRequiredSections,
    ).toEqual(['Decision'])
  })
})

describe('the document id', () => {
  it('is stamped on a draft that has none, and never changed on one that has', () => {
    const other = documentId('00000000-0000-4000-8000-0000000002ff') as DocumentId
    expect(
      format.prepareForPublish({ documentId: DOC, content: draftOf('# No id\n') }).frontMatter[
        'id'
      ],
    ).toBe(DOC)
    expect(
      format.prepareForPublish({
        documentId: DOC,
        content: draftOf(`---\nid: ${other}\n---\n\n# X\n`),
      }).frontMatter['id'],
    ).toBe(other)
  })
})

/**
 * Renaming, which is a change to the document rather than to a column
 * (`document-title.ts`). The row's title is an index of what the document
 * says (ADR-034), so a publish after a rename has to carry the new name —
 * which it only does if the rename wrote it where the title lives.
 */
describe('createDocumentFormat: retitle', () => {
  const retitle = (markdown: string, title: string) =>
    format.retitle({ content: draftOf(markdown), title })

  it('writes the title into the front matter and into the heading that names it', () => {
    const source = [
      '---',
      `id: ${DOC}`,
      '# who to ask about this one',
      'owners: [ada@example.com]',
      'title: Quarterly plan',
      'tags: [planning]',
      '---',
      '',
      '# Quarterly plan',
      '',
      'What we are doing this quarter.',
      '',
    ].join('\n')

    const renamed = retitle(source, 'Quarterly plan 2026')
    expect(renamed.frontMatter['title']).toBe('Quarterly plan 2026')

    // Surgical: the key is rewritten where it stood, the keys around it keep
    // their order and their values, and the comment survives.
    const published = format.prepareForPublish({ documentId: DOC, content: renamed }).markdown
    expect(published).toContain('# who to ask about this one')
    expect(published).toContain('ada@example.com')
    expect(published).toContain('title: Quarterly plan 2026')
    expect(published).toContain('planning')
    expect(published).toContain('# Quarterly plan 2026')
    expect(published).not.toContain('# Quarterly plan\n')
    expect(published.indexOf('owners')).toBeLessThan(published.indexOf('title'))
  })

  it('gives a document that declares no title one, and renames the heading that named it', () => {
    const renamed = retitle('# Imported page\n\nFrom somewhere else.\n', 'Adopted page')
    expect(renamed.frontMatter).toEqual({ title: 'Adopted page' })
    expect(format.prepareForPublish({ documentId: DOC, content: renamed }).markdown).toContain(
      '# Adopted page',
    )
  })

  it('treats an empty declared title as none at all', () => {
    const renamed = retitle(`---\nid: ${DOC}\ntitle: ''\n---\n\n# Imported page\n`, 'Adopted page')
    expect(format.prepareForPublish({ documentId: DOC, content: renamed }).title).toBe(
      'Adopted page',
    )
  })

  it('renames the first level-one heading, not the level-two one above it', () => {
    const renamed = retitle('## Preamble\n\n# The document\n\nBody.\n', 'The renamed document')
    const published = format.prepareForPublish({ documentId: DOC, content: renamed }).markdown
    expect(published).toContain('## Preamble')
    expect(published).toContain('# The renamed document')
  })

  it('renames a document whose only heading is a level-two one', () => {
    const renamed = retitle('## The document\n\nBody.\n', 'The renamed document')
    expect(format.prepareForPublish({ documentId: DOC, content: renamed }).markdown).toContain(
      '## The renamed document',
    )
  })

  it('leaves a heading that is not the document’s title alone', () => {
    const renamed = retitle(
      `---\nid: ${DOC}\ntitle: Runbook\n---\n\n## Summary\n\nWhat to do at 3am.\n`,
      'Incident runbook',
    )
    const published = format.prepareForPublish({ documentId: DOC, content: renamed }).markdown
    expect(published).toContain('title: Incident runbook')
    expect(published).toContain('## Summary')
  })

  it('renames a document that has no heading to rename', () => {
    const renamed = retitle(`---\nid: ${DOC}\ntitle: Notes\n---\n\nJust prose.\n`, 'Field notes')
    const published = format.prepareForPublish({ documentId: DOC, content: renamed })
    expect(published.title).toBe('Field notes')
    expect(published.markdown).toContain('Just prose.')
  })

  it('reads a draft whose tree is not one, and still writes the title', () => {
    const renamed = format.retitle({
      content: { version: 1, frontMatter: { id: DOC }, ast: 'not a tree' },
      title: 'Recovered',
    })
    expect(renamed.frontMatter).toEqual({ id: DOC, title: 'Recovered' })
  })
})
