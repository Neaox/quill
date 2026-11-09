/**
 * A block's props: declared as JSON Schema, written as directive attributes,
 * read back as typed values (ADR-060, "A block is a module, described by JSON
 * Schema").
 *
 * Every prop a block declares is a small JSON Schema object, built with the
 * `p.*` helpers so that each one carries the `title` the generated form and
 * the catalogue need. Only the scalar shapes an attribute can hold are
 * declared here — a string, one of a set, a number, a flag, and a
 * comma-separated list — because those are what the `directives` dialect
 * writes on the directive's own line. Structured props (`yaml props`) join
 * with the first block that needs one.
 *
 * Reading is a small interpreter over that subset rather than a compiled Ajv
 * validator: the editor checks a block's props in the browser, under a
 * content security policy with no `unsafe-eval`, and Ajv compiles its
 * validators with `new Function`. The schema stays plain JSON Schema, so a
 * manifest can still be checked by Ajv where code generation is allowed.
 *
 * A prop's value is always data: a string, a number, a boolean or a list of
 * strings. Nothing read here is ever markup; a block draws a value as text or
 * as an attribute, and the HTML serialiser escapes both.
 */

interface PropBase<Value> {
  /** What the generated form labels the field, and what an issue calls the prop. */
  readonly title: string
  readonly description?: string | undefined
  readonly default?: Value | undefined
  /** Not drawn without it. A required prop with a default is never missing. */
  readonly required?: boolean | undefined
}

export interface StringProp extends PropBase<string> {
  readonly type: 'string'
  readonly pattern?: string | undefined
  readonly minLength?: number | undefined
  readonly maxLength?: number | undefined
  readonly examples?: readonly string[] | undefined
}

export interface EnumProp<Value extends string = string> extends PropBase<Value> {
  readonly type: 'string'
  readonly enum: readonly Value[]
}

export interface NumberProp extends PropBase<number> {
  readonly type: 'number' | 'integer'
  readonly minimum?: number | undefined
  readonly maximum?: number | undefined
}

/** A flag: written bare (`{narrow}`), or `=true` and `=false`. Absent is its default, or false. */
export interface BooleanProp extends PropBase<boolean> {
  readonly type: 'boolean'
}

/** Strings separated by commas in one attribute: `outside="Airbnb, Booking.com"`. */
export interface ListProp extends PropBase<readonly string[]> {
  readonly type: 'array'
  readonly items: { readonly type: 'string' }
}

export type PropSchema = StringProp | EnumProp | NumberProp | BooleanProp | ListProp

export type PropSchemas = Readonly<Record<string, PropSchema>>

/** The value one prop reads as. Optional unless it is required or has a default. */
type ValueOf<Schema extends PropSchema> =
  Schema extends EnumProp<infer Value>
    ? Value
    : Schema extends StringProp
      ? string
      : Schema extends NumberProp
        ? number
        : Schema extends BooleanProp
          ? boolean
          : readonly string[]

type Present<Schema extends PropSchema> = Schema extends BooleanProp
  ? true
  : Schema extends { readonly required: true }
    ? true
    : Schema extends { readonly default: unknown }
      ? true
      : false

/** The typed props a block's `render` receives, derived from its declarations. */
export type PropValues<Schemas extends PropSchemas> = {
  readonly [Name in keyof Schemas as Present<Schemas[Name]> extends true ? Name : never]: ValueOf<
    Schemas[Name]
  >
} & {
  readonly [Name in keyof Schemas as Present<Schemas[Name]> extends true ? never : Name]?:
    | ValueOf<Schemas[Name]>
    | undefined
}

type Options<Schema> = Omit<Schema, 'type' | 'enum' | 'items'>

/** The helpers a block declares its props with; each result is plain JSON Schema. */
export const p = {
  string: <const Options_ extends Options<StringProp>>(options: Options_) =>
    ({ type: 'string', ...options }) as const,
  enum: <const Value extends string, const Options_ extends Options<EnumProp<Value>>>(
    values: readonly Value[],
    options: Options_,
  ) => ({ type: 'string', enum: values, ...options }) as const,
  number: <const Options_ extends Options<NumberProp>>(options: Options_) =>
    ({ type: 'number', ...options }) as const,
  integer: <const Options_ extends Options<NumberProp>>(options: Options_) =>
    ({ type: 'integer', ...options }) as const,
  boolean: <const Options_ extends Options<BooleanProp>>(options: Options_) =>
    ({ type: 'boolean', ...options }) as const,
  list: <const Options_ extends Options<ListProp>>(options: Options_) =>
    ({ type: 'array', items: { type: 'string' }, ...options }) as const,
}

/** A problem with one prop, or with the block as a whole when `prop` is absent. */
export interface PropIssue {
  readonly prop?: string | undefined
  readonly message: string
  /**
   * `fatal` when the block cannot be drawn at all (a required prop is
   * missing); otherwise the prop is drawn as its default, or left out.
   */
  readonly fatal: boolean
}

/** Any prop's value: data, never markup. */
export type PropValue = string | number | boolean | readonly string[]

export interface ReadProps {
  readonly values: Readonly<Record<string, PropValue>>
  readonly issues: readonly PropIssue[]
}

function isEnum(schema: PropSchema): schema is EnumProp {
  return 'enum' in schema
}

function quoted(value: string): string {
  return `“${value}”`
}

function oneOf(values: readonly string[]): string {
  return values.join(', ')
}

type Read = { readonly value: PropValue } | { readonly problem: string }

function readString(schema: StringProp, written: string): Read {
  if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(written)) {
    return { problem: `${quoted(written)} is not in the form it needs` }
  }
  if (schema.minLength !== undefined && written.length < schema.minLength) {
    return { problem: `needs at least ${schema.minLength} characters` }
  }
  if (schema.maxLength !== undefined && written.length > schema.maxLength) {
    return { problem: `takes at most ${schema.maxLength} characters` }
  }
  return { value: written }
}

function readNumber(schema: NumberProp, written: string): Read {
  const value = written.trim() === '' ? Number.NaN : Number(written)
  if (!Number.isFinite(value)) return { problem: `${quoted(written)} is not a number` }
  if (schema.type === 'integer' && !Number.isInteger(value)) {
    return { problem: `${quoted(written)} is not a whole number` }
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    return { problem: `${written} is below ${schema.minimum}` }
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    return { problem: `${written} is above ${schema.maximum}` }
  }
  return { value }
}

/** A bare attribute reads as `''`, which is what a flag is written as. */
function readBoolean(written: string): Read {
  if (written === '' || written === 'true') return { value: true }
  if (written === 'false') return { value: false }
  return { problem: `${quoted(written)} is not true or false` }
}

function readValue(schema: PropSchema, written: string): Read {
  if (isEnum(schema)) {
    return schema.enum.includes(written)
      ? { value: written }
      : { problem: `${quoted(written)} is not one of ${oneOf(schema.enum)}` }
  }
  switch (schema.type) {
    case 'string':
      return readString(schema, written)
    case 'number':
    case 'integer':
      return readNumber(schema, written)
    case 'boolean':
      return readBoolean(written)
    case 'array':
      return {
        value: written
          .split(',')
          .map((each) => each.trim())
          .filter((each) => each.length > 0),
      }
  }
}

function fallback(schema: PropSchema): PropValue | undefined {
  if (schema.default !== undefined) return schema.default
  return schema.type === 'boolean' ? false : undefined
}

/**
 * Reads a directive's attributes against a block's props.
 *
 * Nothing is thrown and nothing is discarded from the document: an
 * attribute the block does not declare is reported and ignored by the
 * render, and a value that does not fit its prop is reported and drawn as
 * the prop's default. Only a required prop with no value and no default
 * stops the block being drawn.
 */
export function readProps(
  schemas: PropSchemas,
  attributes: Readonly<Record<string, string | null | undefined>> | null | undefined,
): ReadProps {
  const written = attributes ?? {}
  const values: Record<string, PropValue> = {}
  const issues: PropIssue[] = []

  for (const [name, schema] of Object.entries(schemas)) {
    const value = Object.hasOwn(written, name) ? written[name] : undefined
    if (value === undefined || value === null) {
      const assumed = fallback(schema)
      if (assumed === undefined && schema.required === true) {
        issues.push({ prop: name, message: `${name} is required`, fatal: true })
      }
      if (assumed !== undefined) values[name] = assumed
      continue
    }
    const read = readValue(schema, value)
    if ('value' in read) {
      values[name] = read.value
      continue
    }
    const assumed = fallback(schema)
    const drawn = assumed === undefined ? 'left out' : `drawn as ${String(assumed)}`
    const fatal = assumed === undefined && schema.required === true
    issues.push({ prop: name, message: `${name}: ${read.problem}; ${drawn}`, fatal })
    if (assumed !== undefined) values[name] = assumed
  }

  for (const name of Object.keys(written)) {
    if (Object.hasOwn(schemas, name)) continue
    const known = Object.keys(schemas)
    const expected = known.length === 0 ? 'it takes none' : `it takes ${oneOf(known)}`
    issues.push({
      prop: name,
      message: `${name} is not a prop of this block; ${expected}`,
      fatal: false,
    })
  }

  return { values, issues }
}
