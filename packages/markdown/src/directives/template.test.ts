import { describe, expect, it } from 'vitest'

import type { TemplateDeclaration } from '../front-matter/template-schema.ts'
import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { conditionIdentifiers, evaluateCondition } from './condition.ts'
import { resolveTemplate } from './resolve-template.ts'
import { stripAuthoringBlocks } from './strip-authoring-blocks.ts'
import { substituteAnswers } from './substitute.ts'

describe('evaluateCondition', () => {
  const answers = {
    securityReview: true,
    skipped: false,
    status: 'accepted',
    audience: 'internal only',
    owners: ['platform'],
    none: [],
    empty: '',
    literalFalse: 'false',
    nothing: null,
  }

  it('reads a bare question id as a truth test', () => {
    expect(evaluateCondition('securityReview', answers)).toBe(true)
    expect(evaluateCondition('skipped', answers)).toBe(false)
    expect(evaluateCondition('missing', answers)).toBe(false)
  })

  it('treats empty strings, empty lists, "false" and null as unanswered', () => {
    expect(evaluateCondition('empty', answers)).toBe(false)
    expect(evaluateCondition('none', answers)).toBe(false)
    expect(evaluateCondition('owners', answers)).toBe(true)
    expect(evaluateCondition('literalFalse', answers)).toBe(false)
    expect(evaluateCondition('nothing', answers)).toBe(false)
    expect(evaluateCondition('status', answers)).toBe(true)
  })

  it('negates', () => {
    expect(evaluateCondition('!securityReview', answers)).toBe(false)
    expect(evaluateCondition('!skipped', answers)).toBe(true)
  })

  it('compares against a literal, quoted or bare', () => {
    expect(evaluateCondition('status == accepted', answers)).toBe(true)
    expect(evaluateCondition('status == proposed', answers)).toBe(false)
    expect(evaluateCondition('status != proposed', answers)).toBe(true)
    expect(evaluateCondition('audience == "internal only"', answers)).toBe(true)
    expect(evaluateCondition("audience == 'internal only'", answers)).toBe(true)
    expect(evaluateCondition('nothing == ', answers)).toBe(true)
  })

  it('combines clauses, with && binding tighter than ||', () => {
    expect(evaluateCondition('securityReview && status == accepted', answers)).toBe(true)
    expect(evaluateCondition('securityReview && skipped', answers)).toBe(false)
    expect(evaluateCondition('skipped || securityReview', answers)).toBe(true)
    expect(evaluateCondition('skipped && securityReview || status == accepted', answers)).toBe(true)
  })

  it('treats an empty expression as false', () => {
    expect(evaluateCondition('', answers)).toBe(false)
  })

  it('names the question ids an expression reads', () => {
    expect(conditionIdentifiers('!a && b == x || c')).toEqual(['a', 'b', 'c'])
    expect(conditionIdentifiers('')).toEqual([])
  })

  describe('quoting', () => {
    const quoted = {
      scope: 'reads && writes',
      either: 'a || b',
      shouted: 'NOT != really',
      apostrophe: "it's fine",
      bare: true,
    }

    it('reads an operator inside a quoted literal as text', () => {
      expect(evaluateCondition('scope == "reads && writes"', quoted)).toBe(true)
      expect(evaluateCondition('either == "a || b"', quoted)).toBe(true)
      expect(evaluateCondition('shouted == "NOT != really"', quoted)).toBe(true)
      expect(evaluateCondition('apostrophe == "it\'s fine"', quoted)).toBe(true)
    })

    it('still combines clauses around a quoted literal', () => {
      expect(evaluateCondition('bare && scope == "reads && writes"', quoted)).toBe(true)
      expect(evaluateCondition('scope == "nothing" || either == "a || b"', quoted)).toBe(true)
      expect(evaluateCondition('scope == "reads && writes" && !bare', quoted)).toBe(false)
    })

    it('does not mistake part of a literal for a question id', () => {
      expect(conditionIdentifiers('scope == "reads && writes"')).toEqual(['scope'])
      expect(conditionIdentifiers('either == "a || b" || other')).toEqual(['either', 'other'])
      expect(conditionIdentifiers('"literal" == "literal"')).toEqual([])
    })

    it('runs an unterminated quote to the end rather than changing meaning', () => {
      expect(evaluateCondition('scope == "reads && writes', quoted)).toBe(false)
      expect(conditionIdentifiers('scope == "reads && writes')).toEqual(['scope'])
    })
  })
})

describe('substituteAnswers', () => {
  it('replaces answer references and leaves everything else alone', () => {
    expect(substituteAnswers('Owner: {{ answers.owner }}.', { owner: 'Platform' })).toBe(
      'Owner: Platform.',
    )
    expect(substituteAnswers('{{answers.count}}', { count: 3 })).toBe('3')
    expect(substituteAnswers('{{ answers.missing }}', {})).toBe('')
    expect(substituteAnswers('{{ answers.blank }}', { blank: null })).toBe('')
    expect(substituteAnswers('{{ not.answers }}', {})).toBe('{{ not.answers }}')
  })
})

describe('stripAuthoringBlocks', () => {
  const source = [
    '# Decision',
    '',
    ':::guidance',
    'Explain the trade-off.',
    ':::',
    '',
    'We chose :placeholder[the thing] because.',
    '',
    ':::placeholder',
    'Say what changed.',
    ':::',
    '',
    ':::optional{title="Alternatives" added}',
    'We also considered B.',
    ':::',
    '',
    ':::optional{title="Security considerations"}',
    'Never added.',
    ':::',
    '',
    ':::notes',
    'Mention the migration.',
    ':::',
    '',
    ':::callout{type=note}',
    'This stays.',
    ':::',
    '',
  ].join('\n')

  it('removes scaffolding and keeps everything the reader should see', () => {
    const { ast, warnings } = stripAuthoringBlocks(parseMarkdown(source))
    const output = stringifyMdast(ast)

    expect(output).not.toContain('guidance')
    expect(output).not.toContain('Say what changed')
    expect(output).not.toContain('Never added')
    expect(output).toContain('We also considered B.')
    expect(output).toContain(':::callout{type="note"}')
    expect(output).toContain('We chose  because.')
    expect(warnings.map((found) => found.detail)).toEqual(['the thing', 'Say what changed.'])
  })

  it('keeps presenter notes in the source, for presentation mode to read', () => {
    const { ast } = stripAuthoringBlocks(parseMarkdown(source))
    const output = stringifyMdast(ast)

    expect(output).toContain(':::notes')
    expect(output).toContain('Mention the migration.')
  })

  it('removes scaffolding nested inside other blocks', () => {
    const { ast } = stripAuthoringBlocks(
      parseMarkdown('> :::guidance\n> Hidden.\n> :::\n>\n> Kept.\n'),
    )

    expect(stringifyMdast(ast)).toBe('> Kept.\n')
  })

  it('drops a `when` that reached publish unresolved, and says so', () => {
    // Conditions are resolved at creation and on re-answer, so one that is
    // still here belongs to a question nobody ever answered: publishing its
    // body would show every reader content meant for one of them.
    const { ast, warnings } = stripAuthoringBlocks(
      parseMarkdown(':::when{question=securityReview}\nAudit notes.\n:::\n\nKept.\n'),
    )

    expect(stringifyMdast(ast)).toBe('Kept.\n')
    expect(warnings).toEqual([{ code: 'unresolved-condition', detail: 'securityReview' }])
  })

  it('unwraps a `repeat` so its instances publish as ordinary sections', () => {
    const { ast, warnings } = stripAuthoringBlocks(
      parseMarkdown(':::repeat{title="Alternative"}\n## Alternative\n\nWhy not.\n:::\n'),
    )

    expect(stringifyMdast(ast)).toBe('## Alternative\n\nWhy not.\n')
    expect(warnings).toEqual([])
  })

  it('leaves an inline directive that is not scaffolding alone', () => {
    const { ast, warnings } = stripAuthoringBlocks(parseMarkdown('Press :kbd[Esc] to stop.\n'))

    expect(stringifyMdast(ast)).toBe('Press :kbd[Esc] to stop.\n')
    expect(warnings).toEqual([])
  })

  it('leaves a document with no scaffolding untouched', () => {
    const { ast, warnings } = stripAuthoringBlocks(parseMarkdown('# Heading\n\nText.\n'))

    expect(stringifyMdast(ast)).toBe('# Heading\n\nText.\n')
    expect(warnings).toEqual([])
  })
})

describe('resolveTemplate', () => {
  const declaration: TemplateDeclaration = {
    name: 'Architecture decision record',
    version: 3,
    questions: [
      { id: 'securityReview', label: 'Touches auth?', type: 'boolean' },
      { id: 'owner', label: 'Owner', type: 'text' },
    ],
    sections: [
      { heading: 'Context', required: true },
      { heading: 'Decision', required: true },
      { heading: 'Security considerations', when: 'securityReview', required: true },
      { heading: 'Alternatives considered', optional: true },
    ],
  }

  const template = [
    '# {{ answers.title }}',
    '',
    'Owner: {{ answers.owner }}.',
    '',
    '## Context',
    '',
    ':::when{question=securityReview}',
    '## Security considerations',
    ':::',
    '',
    ':::when{question=skipped}',
    '## Never here',
    ':::',
    '',
    ':::optional{title="Alternatives considered"}',
    '## Alternatives considered',
    ':::',
    '',
    '```sh',
    'deploy --owner {{ answers.owner }}',
    '```',
    '',
    ':::callout{type=note}',
    'Untouched by the resolver.',
    ':::',
    '',
  ].join('\n')

  it('evaluates conditions, substitutes answers and drops unchosen sections', () => {
    const { ast, requiredSections, warnings } = resolveTemplate(
      parseMarkdown(template),
      declaration,
      { securityReview: true, owner: 'Platform', title: 'Use Postgres' },
    )
    const output = stringifyMdast(ast)

    expect(output).toContain('# Use Postgres')
    expect(output).toContain('Owner: Platform.')
    expect(output).toContain('## Security considerations')
    expect(output).not.toContain('## Never here')
    // The optional section is an offer, not a condition: it stays in the draft
    // as the ghosted affordance of ADR-029 and publish decides its fate.
    expect(output).toContain(':::optional{title="Alternatives considered"}')
    expect(output).toContain('deploy --owner Platform')
    expect(output).toContain(':::callout{type="note"}')
    expect(requiredSections).toEqual(['Context', 'Decision', 'Security considerations'])
    expect(warnings.map((found) => found.detail)).toEqual(['skipped'])
  })

  it('drops a conditional required section when its question is unanswered', () => {
    const { requiredSections } = resolveTemplate(parseMarkdown(template), declaration, {})

    expect(requiredSections).toEqual(['Context', 'Decision'])
  })

  it('leaves optional sections exactly where they are, added or not', () => {
    // Creation is not where an offer is accepted or withdrawn: the author can
    // still add the section at any point while drafting (ADR-029), and
    // `stripAuthoringBlocks` unwraps or removes it at publish.
    const source = [
      ':::optional{title="Alternatives" added}',
      '## Alternatives',
      ':::',
      '',
      ':::optional{title="Security considerations"}',
      '## Security considerations',
      ':::',
      '',
    ].join('\n')
    const { ast } = resolveTemplate(parseMarkdown(source), declaration, {})

    expect(stringifyMdast(ast)).toBe(source)
  })

  it('substitutes inline code as well as prose', () => {
    const { ast } = resolveTemplate(
      parseMarkdown('Run `{{ answers.owner }}` now.\n'),
      declaration,
      {
        owner: 'deploy',
      },
    )

    expect(stringifyMdast(ast)).toBe('Run `deploy` now.\n')
  })

  it('warns once about an undeclared question a body block and a section share', () => {
    const shared: TemplateDeclaration = {
      name: 'Shared',
      version: 1,
      sections: [{ heading: 'Extra', when: 'undeclared', required: true }],
    }
    const { warnings } = resolveTemplate(
      parseMarkdown(':::when{question=undeclared}\n## Extra\n:::\n'),
      shared,
      { undeclared: true },
    )

    expect(warnings).toEqual([{ code: 'unknown-question', detail: 'undeclared' }])
  })

  it('copes with a declaration that asks nothing and declares no sections', () => {
    const bare: TemplateDeclaration = { name: 'Blank', version: 1 }
    const { ast, requiredSections, warnings } = resolveTemplate(
      parseMarkdown('# Title\n'),
      bare,
      {},
    )

    expect(stringifyMdast(ast)).toBe('# Title\n')
    expect(requiredSections).toEqual([])
    expect(warnings).toEqual([])
  })
})
