import {
  isArrayLiteralExpression,
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isStringLiteral,
} from 'typescript/unstable/ast/is'
import type { Node } from 'typescript/unstable/ast'

/**
 * A display transform for a schema-builder value (ADR-065).
 *
 * The compiler type of `z.object({...})` is a builder, not the data it
 * describes. This adapter reads the declaration's own syntax and renders the
 * data shape a person wants, without pretending it is a compiler-resolved
 * type. Each library adds one adapter; the first is Zod.
 */
export interface SchemaDisplay {
  readonly library: 'zod'
  readonly readableType: string
}

const PRIMITIVES = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'date',
  'unknown',
  'any',
  'never',
  'null',
  'undefined',
  'void',
])

/** The readable data shape of a `z.object({...})` value, or `undefined` when it is not one. */
export function schemaDisplay(initializer: Node | undefined): SchemaDisplay | undefined {
  if (initializer === undefined || !isCallExpression(initializer)) return undefined
  if (calleeName(initializer.expression) === undefined) return undefined
  const readableType = format(initializer)
  return readableType === undefined ? undefined : { library: 'zod', readableType }
}

/** `type AccountOpening = z.output<typeof ACCOUNT_OPENING>` -> `ACCOUNT_OPENING`. */
export function schemaOutputAlias(node: Node): string | undefined {
  const text = node.getText().replaceAll(/\s+/g, ' ')
  const match =
    /^export\s+type\s+[A-Za-z_$][\w$]*(?:\s*<[^>]*>)?\s*=\s*(?:z\.)?(?:output|infer)\s*<\s*typeof\s+([A-Za-z_$][\w$]*)\s*>/.exec(
      text,
    )
  return match?.[1]
}

function format(node: Node): string | undefined {
  if (!isCallExpression(node)) return undefined
  const name = calleeName(node.expression)
  if (name === undefined) return undefined
  const short = name.split('.').at(-1) ?? name
  const argument = node.arguments[0]
  if (PRIMITIVES.has(short)) return short
  if (short === 'object' || short === 'strictObject' || short === 'looseObject') {
    return argument !== undefined && isObjectLiteralExpression(argument)
      ? objectShape(argument)
      : undefined
  }
  if (short === 'nullable' || short === 'nullish') {
    const inner = argument === undefined ? undefined : format(argument)
    return inner === undefined ? undefined : `${inner} | null`
  }
  if (short === 'optional') {
    const inner = argument === undefined ? undefined : format(argument)
    return inner === undefined ? undefined : `${inner} | undefined`
  }
  if (short === 'array') {
    const inner = argument === undefined ? undefined : format(argument)
    if (inner === undefined) return undefined
    return inner.includes(' | ') ? `(${inner})[]` : `${inner}[]`
  }
  if (short === 'enum' && argument !== undefined && isArrayLiteralExpression(argument)) {
    const values = argument.elements.filter(isStringLiteral).map((element) => element.getText())
    return values.length === 0 ? undefined : values.join(' | ')
  }
  if (short === 'literal' && argument !== undefined) return argument.getText()
  if (short === 'union' && argument !== undefined && isArrayLiteralExpression(argument)) {
    const values = argument.elements.map(format).filter((value) => value !== undefined)
    return values.length === 0 ? undefined : values.join(' | ')
  }
  if (short === 'record' && argument !== undefined) {
    const key = format(argument)
    const value = node.arguments[1] === undefined ? undefined : format(node.arguments[1])
    return key === undefined || value === undefined ? undefined : `Record<${key}, ${value}>`
  }
  if (short === 'default' || short === 'catch') {
    return argument === undefined ? undefined : format(argument)
  }
  // A chained refinement such as `z.string().min(1)`: read the receiver, not the method.
  if (isPropertyAccessExpression(node.expression) && isCallExpression(node.expression.expression)) {
    return format(node.expression.expression)
  }
  return undefined
}

function objectShape(node: Node): string | undefined {
  if (!isObjectLiteralExpression(node)) return undefined
  const parts: string[] = []
  for (const property of node.properties) {
    if (!isPropertyAssignment(property)) continue
    const key = property.name.getText()
    const optional =
      isCallExpression(property.initializer) &&
      calleeName(property.initializer.expression)?.split('.').at(-1) === 'optional'
    const value = format(property.initializer)
    if (value === undefined) continue
    parts.push(`${key}${optional ? '?' : ''}: ${value}`)
  }
  return parts.length === 0 ? undefined : `{ ${parts.join('; ')} }`
}

function calleeName(node: Node): string | undefined {
  if (isIdentifier(node)) return node.text
  if (isPropertyAccessExpression(node)) return `${node.expression.getText()}.${node.name.getText()}`
  return undefined
}
