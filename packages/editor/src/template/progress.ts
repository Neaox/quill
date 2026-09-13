import {
  TemplateDeclarationSchema,
  createFrontMatterValidator,
  frontMatterNode,
  readFrontMatter,
} from '@quill/markdown'
import type { TemplateSection } from '@quill/markdown'
import type { DocumentAst, DocumentNode, MdastNode } from '../document-ast.ts'

/**
 * The template checklist (ADR-029).
 *
 * "Required" is a business rule that is shown, never enforced: this module says
 * which declared sections are still scaffolding so the template panel can show
 * it and the publish summary can state it, and it refuses to decide anything
 * about whether the document may be published. The panel itself is the web
 * application's; what it needs is here, derived from the document alone.
 */

const isDeclaration = createFrontMatterValidator(TemplateDeclarationSchema)

/** Directives that are scaffolding: a section holding only these has not been started. */
const SCAFFOLDING: ReadonlySet<string> = new Set(['placeholder', 'guidance'])

export type SectionStatus = 'started' | 'placeholder' | 'empty' | 'not-added'

export interface TemplateSectionProgress extends TemplateSection {
  /** A heading with this text exists in the document. */
  readonly present: boolean
  readonly status: SectionStatus
}

export interface TemplateProgress {
  readonly declared: boolean
  readonly name: string | undefined
  readonly sections: readonly TemplateSectionProgress[]
  readonly started: number
  readonly total: number
  /** Required sections still holding only scaffolding, named for the publish summary. */
  readonly incompleteRequired: readonly string[]
}

const EMPTY: TemplateProgress = {
  declared: false,
  name: undefined,
  sections: [],
  started: 0,
  total: 0,
  incompleteRequired: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * The declared sections, read field by field and leniently.
 *
 * The schema above decides whether the block is a declaration at all; this takes
 * only what the checklist needs and refuses to assume more than it checked, so a
 * section that is not a mapping, or has no heading, is skipped rather than
 * turned into a section with no name. Exported because that leniency is worth
 * testing on its own, independently of the schema in front of it.
 */
export function declaredSections(template: Record<string, unknown>): readonly TemplateSection[] {
  const raw = template['sections']
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).flatMap((section) => {
    const heading = asString(section['heading'])
    if (heading === undefined) return []
    const when = asString(section['when'])
    return [
      {
        heading,
        required: section['required'] === true,
        optional: section['optional'] === true,
        ...(when === undefined ? {} : { when }),
      },
    ]
  })
}

/** A node's children, for the walks that do not care whether it has any. */
function childrenOf(node: MdastNode): readonly MdastNode[] {
  return node.children ?? []
}

function textOf(node: MdastNode): string {
  if (typeof node.value === 'string') return node.value
  return childrenOf(node)
    .map((child) => textOf(child))
    .join('')
}

function isScaffolding(node: MdastNode): boolean {
  if (node.type === 'containerDirective' || node.type === 'textDirective') {
    return typeof node.name === 'string' && SCAFFOLDING.has(node.name)
  }
  if (node.type === 'paragraph') return childrenOf(node).every((child) => isScaffolding(child))
  return false
}

/** The blocks under a heading, up to the next heading at the same level or above. */
function sectionBody(
  children: readonly DocumentNode[],
  index: number,
  depth: number,
): DocumentNode[] {
  const body: DocumentNode[] = []
  for (const node of children.slice(index + 1)) {
    if (node.type === 'heading' && node.depth <= depth) break
    body.push(node)
  }
  return body
}

function statusOf(body: readonly DocumentNode[]): SectionStatus {
  if (body.length === 0) return 'empty'
  return body.every((node) => isScaffolding(node)) ? 'placeholder' : 'started'
}

function headings(tree: DocumentAst): ReadonlyMap<string, SectionStatus> {
  const found = new Map<string, SectionStatus>()
  tree.children.forEach((node, index) => {
    if (node.type !== 'heading') return
    const heading = textOf(node).trim()
    if (found.has(heading)) return
    found.set(heading, statusOf(sectionBody(tree.children, index, node.depth)))
  })
  return found
}

export interface TemplateDeclarationSummary {
  readonly name: string | undefined
  readonly sections: readonly TemplateSection[]
}

/**
 * The `template:` block of a front matter string, when it declares a template.
 * A document created *from* a template carries a reference instead, which has no
 * sections and therefore no checklist.
 */
export function templateDeclaration(yaml: string): TemplateDeclarationSummary | undefined {
  const template = readFrontMatter(yaml).value['template']
  if (!isRecord(template) || !isDeclaration(template).valid) return undefined
  return { name: asString(template['name']), sections: declaredSections(template) }
}

function declarationOf(tree: DocumentAst): TemplateDeclarationSummary | undefined {
  const node = frontMatterNode(tree)
  return node === undefined ? undefined : templateDeclaration(node.value)
}

/**
 * The checklist for a document, or an empty one when the document was not made
 * from a template. A document never has to have a template for the editor to
 * work, so the absent case is a value rather than an error.
 */
export function templateProgress(tree: DocumentAst): TemplateProgress {
  const template = declarationOf(tree)
  if (template === undefined) return EMPTY

  const present = headings(tree)
  const sections = template.sections.map((section) => {
    const status = present.get(section.heading)
    return {
      ...section,
      present: status !== undefined,
      status: status ?? ('not-added' satisfies SectionStatus),
    }
  })

  return {
    declared: true,
    name: template.name,
    sections,
    started: sections.filter((section) => section.status === 'started').length,
    total: sections.length,
    incompleteRequired: sections
      .filter((section) => section.required === true && section.status !== 'started')
      .map((section) => section.heading),
  }
}
