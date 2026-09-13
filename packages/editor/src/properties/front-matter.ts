import { CoreFrontMatterSchema, LAYOUT_WIDTHS, isTemplateDeclaration } from '@quill/markdown'
import type { TemplateQuestion } from '@quill/markdown'

/**
 * A document's front matter, as a person edits it (ADR-005).
 *
 * Front matter is YAML on disk and a record in a draft, and neither is
 * something to type at. This module turns the record into a short list of
 * fields, turns a field's edit back into a record, and — the part that matters
 * most — accounts for every key it did not recognise, because ADR-005 and
 * AGENTS.md rule 7 both say an unknown field is preserved rather than
 * discarded. A key this version has never heard of appears in the "other" list
 * and travels back out untouched.
 *
 * Everything here is pure: no React, no editor, no requests. The strip renders
 * what these functions return, which is what lets the rules be tested on their
 * own.
 */

/** How a field is edited. `readonly` is a fact shown, not a control. */
export type PropertyKind = 'readonly' | 'text' | 'select' | 'list' | 'date'

export interface PropertyOption {
  readonly value: string
  readonly label: string
}

export interface PropertyField {
  /** The front matter key this field writes, dotted for a nested one. */
  readonly key: string
  readonly label: string
  readonly kind: PropertyKind
  /** The value as the control shows it; a list is comma-separated. */
  readonly value: string
  readonly options?: readonly PropertyOption[]
  readonly help?: string
  /** A value the schema rejects, said in words beside the field (ADR-005: warn, never discard). */
  readonly error?: string
}

/** A front matter key this release recognises but does not offer a control for. */
export interface OtherProperty {
  readonly key: string
  /** The value in a form a person can read: a scalar as itself, anything else as JSON. */
  readonly value: string
}

export interface PropertiesModel {
  readonly fields: readonly PropertyField[]
  /** Template questions, with the answers the document carries (ADR-029). */
  readonly questions: readonly PropertyField[]
  readonly other: readonly OtherProperty[]
}

/**
 * Keys with a field of their own, plus the ones no form may write.
 *
 * `id` addresses the document (decision D17) and is never edited; `title` is
 * shown but written in the body; `requiredSections` is stamped by the template
 * step and is a record of what was asked, not a preference. Each is still
 * listed under "other" so that nothing in the document is invisible.
 */
const HANDLED_KEYS: ReadonlySet<string> = new Set([
  'title',
  'type',
  'status',
  'owners',
  'tags',
  'review',
  'layout',
  'template',
])

const REVIEW_INTERVAL_PATTERN = /^[1-9]\d*[dwmy]$/

/** The statuses the core schema allows, read from the schema rather than copied. */
export const STATUS_VALUES: readonly string[] = readEnum(CoreFrontMatterSchema, 'status')

function readEnum(schema: { readonly properties: Record<string, unknown> }, key: string): string[] {
  const property = schema.properties[key]
  const values = (property as { readonly enum?: unknown } | undefined)?.enum
  /* v8 ignore next 2 -- the core schema pins `status` as an enum; the guard only keeps this read total. */
  if (!Array.isArray(values)) return []
  return values.filter((value) => typeof value === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A word a person reads, from a key or an identifier a machine wrote.
 *
 * Only a letter that a camel-case break exposes is lowered, so `securityReview`
 * reads as "Security review" while a label that was already written for a
 * person — a template's `ADR accepted`, say — keeps the capitals it was given.
 */
export function humanise(key: string): string {
  const spaced = key
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/([a-z\d])([A-Z])/g, (_, before: string, capital: string) => {
      return `${before} ${capital.toLowerCase()}`
    })
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** A list field's value, joined the way the field is parsed back. */
export function joinList(value: unknown): string {
  return Array.isArray(value) ? value.map((entry) => asText(entry)).join(', ') : asText(value)
}

/** The inverse: a comma-separated field back to the array front matter holds. */
export function splitList(value: string): readonly string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function optionsOf(values: readonly string[]): readonly PropertyOption[] {
  return values.map((value) => ({ value, label: humanise(value) }))
}

const UNSET: PropertyOption = { value: '', label: 'Not set' }

function titleField(
  frontMatter: Readonly<Record<string, unknown>>,
  headingTitle: string | undefined,
) {
  const declared = asText(frontMatter['title'])
  return {
    key: 'title',
    label: 'Title',
    kind: 'readonly',
    value: declared.length > 0 ? declared : (headingTitle ?? ''),
    help: "The document's first heading is its title.",
  } satisfies PropertyField
}

function reviewInterval(frontMatter: Readonly<Record<string, unknown>>): PropertyField {
  const review = frontMatter['review']
  const interval = isRecord(review) ? asText(review['interval']) : ''
  const invalid = interval.length > 0 && !REVIEW_INTERVAL_PATTERN.test(interval)
  return {
    key: 'review.interval',
    label: 'Review every',
    kind: 'text',
    value: interval,
    help: 'A count and a unit, such as 90d, 6m or 1y.',
    ...(invalid ? { error: 'Use a count and a unit, such as 90d, 6m or 1y.' } : {}),
  }
}

function questionField(question: TemplateQuestion, frontMatter: Readonly<Record<string, unknown>>) {
  const answer = frontMatter[question.id]
  const help = question.help
  const common = {
    key: question.id,
    label: question.label,
    ...(help === undefined ? {} : { help }),
  }
  if (question.type === 'boolean') {
    return {
      ...common,
      kind: 'select',
      value: answer === true ? 'true' : answer === false ? 'false' : '',
      options: [UNSET, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }],
    } satisfies PropertyField
  }
  if (question.type === 'choice') {
    return {
      ...common,
      kind: 'select',
      value: asText(answer),
      options: [UNSET, ...optionsOf(question.options ?? [])],
    } satisfies PropertyField
  }
  if (question.type === 'date') {
    return { ...common, kind: 'date', value: asText(answer) } satisfies PropertyField
  }
  return { ...common, kind: 'text', value: asText(answer) } satisfies PropertyField
}

/** The questions this document's own front matter declares, if it is a template. */
export function templateQuestions(
  frontMatter: Readonly<Record<string, unknown>>,
): readonly TemplateQuestion[] {
  const template = frontMatter['template']
  if (!isRecord(template) || !isTemplateDeclaration(template)) return []
  const questions = template['questions']
  if (!Array.isArray(questions)) return []
  return questions.filter(
    (question): question is TemplateQuestion =>
      isRecord(question) &&
      typeof question['id'] === 'string' &&
      typeof question['label'] === 'string',
  )
}

export interface ReadPropertiesOptions {
  /** The document's first heading, used as the title when none is declared. */
  readonly headingTitle?: string | undefined
}

/**
 * The whole surface: the fields with controls, the template's questions, and
 * every other key the document carries, shown but not editable.
 */
export function readProperties(
  frontMatter: Readonly<Record<string, unknown>>,
  options: ReadPropertiesOptions = {},
): PropertiesModel {
  const questions = templateQuestions(frontMatter)
  const answered = new Set(questions.map((question) => question.id))

  const fields: readonly PropertyField[] = [
    titleField(frontMatter, options.headingTitle),
    { key: 'type', label: 'Type', kind: 'text', value: asText(frontMatter['type']) },
    {
      key: 'status',
      label: 'Status',
      kind: 'select',
      value: asText(frontMatter['status']),
      options: [UNSET, ...optionsOf(STATUS_VALUES)],
    },
    {
      key: 'owners',
      label: 'Owners',
      kind: 'list',
      value: joinList(frontMatter['owners']),
      help: 'Separated by commas.',
    },
    {
      key: 'tags',
      label: 'Tags',
      kind: 'list',
      value: joinList(frontMatter['tags']),
      help: 'Separated by commas.',
    },
    reviewInterval(frontMatter),
    {
      key: 'layout',
      label: 'Layout',
      kind: 'select',
      value: asText(frontMatter['layout']),
      options: [UNSET, ...optionsOf(LAYOUT_WIDTHS)],
      help: 'The width every block takes unless it asks for its own.',
    },
  ]

  const other: readonly OtherProperty[] = Object.entries(frontMatter)
    .filter(([key]) => !HANDLED_KEYS.has(key) && !answered.has(key))
    .map(([key, value]) => ({ key, value: asText(value) }))

  return {
    fields,
    questions: questions.map((question) => questionField(question, frontMatter)),
    other,
  }
}

/** The one-line readout the strip shows while it is collapsed. */
export interface PropertiesSummary {
  readonly type: string | undefined
  readonly status: string | undefined
  readonly owners: readonly string[]
  readonly tags: readonly string[]
}

export function summarise(frontMatter: Readonly<Record<string, unknown>>): PropertiesSummary {
  const type = asText(frontMatter['type'])
  const status = asText(frontMatter['status'])
  return {
    type: type.length === 0 ? undefined : type,
    status: status.length === 0 ? undefined : status,
    owners: splitList(joinList(frontMatter['owners'])),
    tags: splitList(joinList(frontMatter['tags'])),
  }
}

/** The owners a document declares, for the header readout. */
export function documentOwners(frontMatter: Readonly<Record<string, unknown>>): readonly string[] {
  return splitList(joinList(frontMatter['owners']))
}

/**
 * One field written back.
 *
 * Key order is the document's, so an edit changes a value in place rather than
 * rewriting the block; an emptied field removes its key rather than leaving
 * `type:` with nothing after it; and a key that was not there is appended. A
 * value of a kind this release does not model is never reached, because only
 * the fields above can be edited.
 */
export function writeProperty(
  frontMatter: Readonly<Record<string, unknown>>,
  field: PropertyField,
  raw: string,
): Record<string, unknown> {
  // A field key is `owner` or `review.interval`: one level of nesting at most.
  const dot = field.key.indexOf('.')
  const key = dot === -1 ? field.key : field.key.slice(0, dot)
  const nested = dot === -1 ? undefined : field.key.slice(dot + 1)
  const value = parseValue(field, raw)
  if (nested === undefined) return setKey(frontMatter, key, value)

  const existing = frontMatter[key]
  const branch = setKey(isRecord(existing) ? existing : {}, nested, value)
  return setKey(frontMatter, key, Object.keys(branch).length === 0 ? undefined : branch)
}

/**
 * The value a field's text becomes.
 *
 * Trimmed, because what ends up here ends up in the document's YAML and a
 * trailing space would be quoted and kept for ever. What the author is typing
 * is not trimmed: the field holds its own text while it has the caret (see
 * `DocumentProperties`), so a comma or a space survives being typed even
 * though the value it produces does not carry it.
 */
function parseValue(field: PropertyField, raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  if (field.kind === 'list') {
    const list = splitList(trimmed)
    return list.length === 0 ? undefined : list
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return trimmed
}

/** The record with one key set, or removed when the value is gone, order kept. */
function setKey(
  record: Readonly<Record<string, unknown>>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  let written = false
  for (const [existing, current] of Object.entries(record)) {
    if (existing !== key) {
      next[existing] = current
      continue
    }
    written = true
    if (value !== undefined) next[key] = value
  }
  if (!written && value !== undefined) next[key] = value
  return next
}
