import type { Schema } from 'hast-util-sanitize'

import type { BlockRegistry } from './registry.ts'

/**
 * The sanitiser's grant for component blocks (ADR-060, "The default sanitise
 * grant"), applied on top of whichever document schema a render uses.
 *
 * A block draws with the base allowlist's elements and nothing more. On the
 * elements a block's markup is made of, this admits:
 *
 * - classes in the `qb` namespace (`qb`, `qb-endpoint`, `qb-endpoint-head`),
 *   alongside the classes the element already admits;
 * - an accessible name, `aria-label`, which is text;
 * - the `data-qb-*` attributes the registered blocks declare, by name, with
 *   text as their value.
 *
 * No element is added, no event handler or `style` can be granted, and no
 * URL-bearing attribute is widened: a link a block draws is still checked
 * against the document's protocols. Everything an author can write reaches
 * a block as a typed value, and a value can only become text or an attribute
 * value, both of which the HTML serialiser escapes.
 */

/** The elements a block's own markup is built from. */
export const BLOCK_ELEMENTS = [
  'section',
  'header',
  'footer',
  'div',
  'p',
  'span',
  'ol',
  'ul',
  'li',
  'dl',
  'dt',
  'dd',
  'strong',
  'em',
  'code',
  'small',
  'figure',
  'figcaption',
] as const

/** `qb`, or `qb-` and lower-case words joined by hyphens. */
export const BLOCK_CLASS = /^qb(?:-[a-z\d]+)*$/

const ARIA_LABEL = 'aria-label'

type AttributeList = NonNullable<Schema['attributes']>[string]
type Definition = AttributeList[number]

function isClassName(definition: Definition): boolean {
  return Array.isArray(definition) && definition[0] === 'className'
}

/**
 * One element's attributes with the grant added. The sanitiser reads the
 * first definition of an attribute and ignores any after it, so the class
 * pattern joins the element's existing `className` definition rather than
 * adding a second one.
 */
function granted(list: AttributeList, data: readonly string[]): AttributeList {
  const hasClassName = list.some(isClassName)
  const withClasses: AttributeList = hasClassName
    ? list.map((definition) =>
        isClassName(definition) && Array.isArray(definition)
          ? [...definition, BLOCK_CLASS]
          : definition,
      )
    : [...list, ['className', BLOCK_CLASS]]
  const named = list.includes(ARIA_LABEL) ? [] : [ARIA_LABEL]
  return [...withClasses, ...named, ...data.filter((name) => !list.includes(name))]
}

const schemas = new WeakMap<Schema, WeakMap<BlockRegistry, Schema>>()

/** The schema with the blocks' grant applied; built once per schema and registry. */
export function blockSanitizeSchema(schema: Schema, registry: BlockRegistry): Schema {
  const byRegistry = schemas.get(schema) ?? new WeakMap<BlockRegistry, Schema>()
  schemas.set(schema, byRegistry)
  const cached = byRegistry.get(registry)
  if (cached !== undefined) return cached

  // A document schema always sets both; `??` only satisfies the wider `Schema` type.
  /* v8 ignore next */
  const attributes = schema.attributes ?? {}
  /* v8 ignore next */
  const tagNames = schema.tagNames ?? []
  const extended: Schema = {
    ...schema,
    tagNames: [...new Set([...tagNames, ...BLOCK_ELEMENTS])],
    attributes: {
      ...attributes,
      ...Object.fromEntries(
        BLOCK_ELEMENTS.map((tag) => [tag, granted(attributes[tag] ?? [], registry.dataAttributes)]),
      ),
    },
  }
  byRegistry.set(registry, extended)
  return extended
}
