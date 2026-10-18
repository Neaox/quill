import { DOCUMENT_STATUSES, LIFECYCLE_STATES } from '@quill/domain'
import { Type } from '@sinclair/typebox'
import type { DocumentStatus, LifecycleState } from '@quill/domain'
import type { Static, TObject } from '@sinclair/typebox'

import type { LayoutWidth } from '../directives/layout.ts'
import { LAYOUT_WIDTHS } from '../directives/layout.ts'
import { TemplateDeclarationSchema, TemplateReferenceSchema } from './template-schema.ts'

/** How often a document must be reviewed: a count and a unit, such as `365d`. */
export const ReviewSchema = Type.Object(
  {
    interval: Type.String({ pattern: '^[1-9][0-9]*[dwmy]$' }),
    lastReviewed: Type.Optional(Type.String({ format: 'date' })),
  },
  { additionalProperties: true },
)

/**
 * The core front matter schema (ADR-005). `id` is the only required field: a
 * document is addressed by its identifier and never by its path (decision D17).
 *
 * `additionalProperties` is true everywhere and stays true: a workspace, a
 * template, or a future version of the platform may add fields, and a field this
 * version does not know is preserved untouched rather than discarded.
 */
export const CoreFrontMatterSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    title: Type.Optional(Type.String({ minLength: 1 })),
    description: Type.Optional(Type.String()),
    type: Type.Optional(Type.String({ minLength: 1 })),
    /**
     * The lifecycle (`in-review`, `verified`, `deprecated`), or a status an
     * earlier release wrote (`draft`, `published`, `archived`), which is kept
     * and means nothing (ADR-005 amendment, `document-lifecycle.ts`).
     */
    status: Type.Optional(
      Type.Unsafe<LifecycleState | DocumentStatus>({
        type: 'string',
        enum: [...LIFECYCLE_STATES, ...DOCUMENT_STATUSES],
      }),
    ),
    /** Who verified the document, as an address, and on which day. */
    verified: Type.Optional(
      Type.Object(
        {
          by: Type.Optional(Type.String({ minLength: 1 })),
          at: Type.Optional(Type.String({ format: 'date' })),
        },
        { additionalProperties: true },
      ),
    ),
    /** The document that replaces a deprecated one: its id (decision D17). */
    supersededBy: Type.Optional(Type.String({ minLength: 1 })),
    owners: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    tags: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    order: Type.Optional(Type.Integer()),
    layout: Type.Optional(Type.Unsafe<LayoutWidth>({ type: 'string', enum: [...LAYOUT_WIDTHS] })),
    review: Type.Optional(ReviewSchema),
    /** A reference on a created document; a declaration on a template itself. */
    template: Type.Optional(Type.Union([TemplateReferenceSchema, TemplateDeclarationSchema])),
  },
  { additionalProperties: true },
)

export type CoreFrontMatter = Static<typeof CoreFrontMatterSchema>

/**
 * Merges workspace and template schemas onto the core one. The merge is additive:
 * properties accumulate, a later schema refines an earlier definition of the same
 * field, and unknown fields stay allowed whatever any input says.
 */
export function mergeFrontMatterSchemas(...schemas: readonly TObject[]): TObject {
  const properties = schemas.reduce<TObject['properties']>(
    (merged, schema) => ({ ...merged, ...schema.properties }),
    {},
  )
  return Type.Object(properties, { additionalProperties: true })
}
