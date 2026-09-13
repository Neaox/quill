import {
  ensureDocumentId,
  extractLinks,
  extractText,
  isTemplateDeclaration,
  parseDocument,
  renderDocument,
  resolveTemplate,
  serializeDocument,
  stripAuthoringBlocks,
  validateFrontMatter,
} from '@quill/markdown'
import type {
  Highlighter,
  SerialisableDocument,
  TemplateAnswers,
  TemplateDeclaration,
  Warning,
} from '@quill/markdown'
import { RENDERED_CONTENT_VERSION, DRAFT_CONTENT_VERSION } from '@quill/application'
import type {
  CreateDocumentContentInput,
  DocumentFormat,
  DraftContent,
  ExtractedLink,
  FormatWarning,
  NewDocumentContent,
  OutlineEntry,
  PreparePublishInput,
  PublishableDocument,
  PublishedDocumentView,
  RenderedContent,
  RenderInput,
  RetitleInput,
} from '@quill/application'

import { documentTitle, retitleDocument } from './document-title.ts'
import { createHighlighter } from './highlighter.ts'
import { incompleteRequiredSections } from './required-sections.ts'

/**
 * The Markdown pipeline behind the `DocumentFormat` port.
 *
 * Everything a document goes through — parsing, template resolution, stripping
 * authoring scaffolding, checking front matter, serialising, rendering — is
 * `packages/markdown`'s job (ADR-002); this composes those calls in the order
 * the use cases need and binds the highlighter the renderer takes as an option
 * (ADR-030). No Markdown knowledge lives above this file.
 */

/** The document tree, named through the package rather than through mdast directly. */
type DocumentTree = SerialisableDocument['ast']

/**
 * Required headings are recorded on the document, not looked up from the
 * template, so a document that has outlived its template still shows what its
 * team expects of it (ADR-029).
 */
const REQUIRED_SECTIONS = 'requiredSections'

export interface DocumentFormatOptions {
  readonly highlighter?: Highlighter
}

export function createDocumentFormat(options: DocumentFormatOptions = {}): DocumentFormat {
  const highlighter = options.highlighter ?? createHighlighter()

  return {
    create(input: CreateDocumentContentInput): NewDocumentContent {
      return input.template === undefined
        ? blankDocument(input)
        : fromTemplate(input, input.template.markdown, input.template.answers)
    },

    prepareForPublish(input: PreparePublishInput): PublishableDocument {
      const tree = toTree(input.content.ast)
      const stripped = isTemplate(input.content.frontMatter)
        ? { ast: tree, warnings: [] }
        : stripAuthoringBlocks(tree)
      const { frontMatter } = ensureDocumentId(
        { ...input.content.frontMatter },
        () => input.documentId,
      )
      const markdown = serializeDocument({ frontMatter, ast: stripped.ast })
      const validation = validateFrontMatter(frontMatter)

      return {
        markdown,
        frontMatter,
        title: documentTitle(frontMatter, stripped.ast),
        warnings: stripped.warnings.map(toFormatWarning),
        frontMatterIssues: validation.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
        incompleteRequiredSections: incompleteRequiredSections(
          markdown,
          readStrings(frontMatter[REQUIRED_SECTIONS]),
        ),
      }
    },

    /**
     * A rename, written into the document itself: the front matter `title`,
     * and the first heading when that heading is what names it. The row's
     * title is an index of this, not the other way round (`document-title.ts`).
     */
    retitle({ content, title }: RetitleInput): DraftContent {
      const renamed = retitleDocument(
        { frontMatter: content.frontMatter, ast: toTree(content.ast) },
        title,
      )
      return {
        version: DRAFT_CONTENT_VERSION,
        frontMatter: renamed.frontMatter,
        ast: renamed.ast,
      }
    },

    /**
     * The titles of the documents this body links to are part of the input,
     * not of the moment: the body is cached under a key that covers them, so
     * a rename produces a new key rather than an entry to invalidate
     * (ADR-031). The renderer emits canonical id links today and reads the
     * titles when auto-titled links land, so they travel with the input from
     * now on rather than being bolted on later.
     */
    render({ markdown }: RenderInput): RenderedContent {
      const { frontMatter, ast } = parseDocument(markdown)
      const text = extractText(ast)
      // One call, one tree: the heading ids in the body and the ids the
      // outline points at are produced by the same slugger, so a table of
      // contents can never drift from the document it describes.
      const rendered = renderDocument(ast, { highlighter, frontMatter })
      return {
        version: RENDERED_CONTENT_VERSION,
        html: rendered.html,
        outline: rendered.outline.map(toOutlineEntry),
        text: { title: text.title, headings: text.headings, body: text.body },
        links: extractLinks(ast).map(toLink),
        // The live-block registry arrives in M5 (ADR-032); until a block type
        // is registered the renderer emits no slots to list.
        slots: [],
        incompleteRequiredSections: incompleteRequiredSections(
          markdown,
          readStrings(frontMatter[REQUIRED_SECTIONS]),
        ),
      }
    },

    read(markdown: string): PublishedDocumentView {
      const { frontMatter, ast } = parseDocument(markdown)
      return { frontMatter, title: documentTitle(frontMatter, ast) }
    },

    /** Published Markdown back to what a draft row holds, for a restore (ADR-015). */
    toDraft(markdown: string): DraftContent {
      const { frontMatter, ast } = parseDocument(markdown)
      return { version: DRAFT_CONTENT_VERSION, frontMatter, ast }
    },
  }
}

function blankDocument(input: CreateDocumentContentInput): NewDocumentContent {
  const { ast } = parseDocument(`# ${input.title}\n`)
  return {
    content: {
      version: DRAFT_CONTENT_VERSION,
      frontMatter: { id: input.documentId, title: input.title },
      ast,
    },
    requiredSections: [],
    warnings: [],
  }
}

/**
 * A template instantiated into a document (ADR-029).
 *
 * The template's own declaration never travels with the document: what stays
 * is a reference to the template and version it came from, the metadata that
 * template stamps, and the list of sections it marks required. Everything
 * conditional is resolved here and now, so a reader never meets machinery.
 */
function fromTemplate(
  input: CreateDocumentContentInput,
  markdown: string,
  answers: Readonly<Record<string, unknown>>,
): NewDocumentContent {
  const template = parseDocument(markdown)
  const declaration = readDeclaration(template.frontMatter)
  const resolved = resolveTemplate(template.ast, declaration, answers as TemplateAnswers)

  const { template: _declaration, id: _templateId, ...inherited } = template.frontMatter
  const frontMatter: Record<string, unknown> = {
    id: input.documentId,
    title: input.title,
    ...inherited,
    ...declaration.metadata,
    ...answers,
    ...(resolved.requiredSections.length === 0
      ? {}
      : { [REQUIRED_SECTIONS]: [...resolved.requiredSections] }),
    ...(input.template === undefined || typeof template.frontMatter['id'] !== 'string'
      ? {}
      : { template: { id: template.frontMatter['id'], version: declaration.version } }),
  }

  return {
    content: { version: DRAFT_CONTENT_VERSION, frontMatter, ast: resolved.ast },
    requiredSections: resolved.requiredSections,
    warnings: [...template.warnings, ...resolved.warnings].map(toFormatWarning),
  }
}

/**
 * Whether the document being published is itself a template (ADR-029).
 *
 * A template's guidance, placeholders, optional and conditional sections are
 * its content, not scaffolding left behind: they are what `create` resolves
 * and what a later publish of the *created* document strips. Stripping them
 * from the template's own publish would hand every document made from it an
 * empty shell, so a document whose `template:` block is a declaration rather
 * than a reference publishes its body as authored.
 */
function isTemplate(frontMatter: Record<string, unknown>): boolean {
  return isTemplateDeclaration(frontMatter['template'])
}

/**
 * The template's declaration, or an empty one.
 *
 * A document in the Templates collection that has not declared itself yet is
 * still a usable starting point: it scaffolds its body and asks nothing.
 */
function readDeclaration(frontMatter: Record<string, unknown>): TemplateDeclaration {
  const declared = frontMatter['template']
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    return { name: 'Untitled template', version: 1 }
  }
  const candidate = declared as Partial<TemplateDeclaration>
  return {
    ...candidate,
    name: typeof candidate.name === 'string' ? candidate.name : 'Untitled template',
    version: typeof candidate.version === 'number' ? candidate.version : 1,
  }
}

/**
 * A draft's stored tree.
 *
 * Drafts are JSON in Postgres, so the tree comes back as plain data; an empty
 * document is the safe reading of anything that is not a tree, because a draft
 * must never stop a publish with a type error.
 */
function toTree(value: unknown): DocumentTree {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { type?: unknown; children?: unknown }
    if (candidate.type === 'root' && Array.isArray(candidate.children)) {
      return value as DocumentTree
    }
  }
  return { type: 'root', children: [] }
}

function toFormatWarning(warning: Warning): FormatWarning {
  return { code: warning.code, detail: warning.detail }
}

function toOutlineEntry(entry: {
  id: string
  depth: number
  text: string
  children: readonly unknown[]
}): OutlineEntry {
  return {
    id: entry.id,
    depth: entry.depth,
    text: entry.text,
    children: entry.children.map((child) =>
      toOutlineEntry(child as Parameters<typeof toOutlineEntry>[0]),
    ),
  }
}

function toLink(link: {
  kind: 'link' | 'image'
  url: string
  text: string
  external: boolean
}): ExtractedLink {
  return { kind: link.kind, url: link.url, text: link.text, external: link.external }
}

function readStrings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
}

export type { DraftContent }
