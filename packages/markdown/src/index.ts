/**
 * The Markdown package: the one place a document is read, checked, rendered, and
 * written back (ADR-002, ADR-003, ADR-004, ADR-005). Framework-free, and usable
 * unchanged on a server, in a worker, and in a browser.
 */

// Parse and serialise
export type { ParsedDocument, SerialisableDocument } from './pipeline/parse-document.ts'
export { frontMatterNode, parseDocument } from './pipeline/parse-document.ts'
export type { SerialisedDocument } from './pipeline/serialize-document.ts'
export { serializeDocument, serializeDocumentWithWarnings } from './pipeline/serialize-document.ts'
export { parseMarkdown, stringifyMdast } from './pipeline/processor.ts'
export { GFM_OPTIONS, SERIALISE_OPTIONS } from './pipeline/options.ts'
export type { RawMdast, ToMarkdownExtension } from './pipeline/raw-mdast.ts'
export { isRawMdast, rawMdast, rawMdastToMarkdown } from './pipeline/raw-mdast.ts'
export {
  DIRECTIVE_COLON_ESCAPE,
  remarkToMarkdownExtensions,
} from './pipeline/to-markdown-extensions.ts'
export { replaceUnserialisable, SERIALISABLE_TYPES } from './pipeline/serialisable.ts'
export type { NodeRewrite } from './tree.ts'
export { rewriteTree } from './tree.ts'
export type { Warning, WarningCode } from './warnings.ts'
export { warning } from './warnings.ts'

// Front matter
export type { CoreFrontMatter } from './front-matter/core-schema.ts'
export {
  CoreFrontMatterSchema,
  mergeFrontMatterSchemas,
  ReviewSchema,
} from './front-matter/core-schema.ts'
export type {
  TemplateDeclaration,
  TemplateQuestion,
  TemplateQuestionType,
  TemplateReference,
  TemplateSection,
} from './front-matter/template-schema.ts'
export {
  isTemplateDeclaration,
  TEMPLATE_QUESTION_TYPES,
  TemplateDeclarationSchema,
  TemplateQuestionSchema,
  TemplateReferenceSchema,
  TemplateSchema,
  TemplateSectionSchema,
} from './front-matter/template-schema.ts'
export type {
  FrontMatterIssue,
  FrontMatterValidation,
  FrontMatterValidator,
} from './front-matter/validate.ts'
export {
  createFrontMatterValidator,
  toFrontMatterIssue,
  validateFrontMatter,
} from './front-matter/validate.ts'
export type { DocumentIdAssignment } from './front-matter/document-id.ts'
export { ensureDocumentId } from './front-matter/document-id.ts'
export type { FrontMatterRead } from './front-matter/yaml-document.ts'
export { readFrontMatter, writeFrontMatter } from './front-matter/yaml-document.ts'

// Directives
export type {
  Directive,
  DirectiveAttributes,
  DirectiveContent,
  DirectiveDefinition,
  DirectiveIssue,
  DirectiveKind,
  DirectiveValidator,
} from './directives/definition.ts'
export {
  attribute,
  bodyOf,
  claims,
  directiveKind,
  flag,
  isDirective,
  issue,
  label,
  labelParagraph,
  textChildren,
} from './directives/definition.ts'
export type { Callout, CalloutType } from './directives/callout.ts'
export {
  CALLOUT_TYPES,
  calloutDirective,
  DEFAULT_CALLOUT_TYPE,
  isCalloutType,
} from './directives/callout.ts'
export type { LayoutBlock, LayoutDirectiveName, LayoutWidth } from './directives/layout.ts'
export {
  isLayoutDirectiveName,
  isLayoutWidth,
  LAYOUT_DIRECTIVE_NAMES,
  LAYOUT_WIDTHS,
  layoutDirective,
} from './directives/layout.ts'
export type { Placeholder } from './directives/placeholder.ts'
export { placeholderDirective } from './directives/placeholder.ts'
export type { Guidance } from './directives/guidance.ts'
export { guidanceDirective } from './directives/guidance.ts'
export type { KeyboardKeys } from './directives/kbd.ts'
export { kbdDirective } from './directives/kbd.ts'
export type { OptionalSection } from './directives/optional.ts'
export { optionalDirective } from './directives/optional.ts'
export type { WhenSection } from './directives/when.ts'
export { whenDirective } from './directives/when.ts'
export type { RepeatSection } from './directives/repeat.ts'
export { repeatDirective } from './directives/repeat.ts'
export type { PresenterNotes } from './directives/notes.ts'
export { notesDirective } from './directives/notes.ts'
export { findDirective, KNOWN_DIRECTIVES, validateDirectives } from './directives/registry.ts'
export type { StrippedDocument } from './directives/strip-authoring-blocks.ts'
export { stripAuthoringBlocks } from './directives/strip-authoring-blocks.ts'
export { stripPresenterNotes } from './directives/strip-presenter-notes.ts'
export type { TemplateAnswers } from './directives/condition.ts'
export { conditionIdentifiers, evaluateCondition } from './directives/condition.ts'
export { substituteAnswers } from './directives/substitute.ts'
export type { ResolvedTemplate } from './directives/resolve-template.ts'
export { resolveTemplate } from './directives/resolve-template.ts'

// Rendering and extraction
export type { RenderedDocument, RenderOptions } from './render/html.ts'
export { renderDocument, renderHtml } from './render/html.ts'
export type { HandlerOptions, Handlers, HighlightedCode, Highlighter } from './render/handlers.ts'
export { createHandlers } from './render/handlers.ts'
export type { Slugger } from './render/slug.ts'
export { createSlugger, headingId, HEADING_ID_PREFIX } from './render/slug.ts'
export type { OutlineEntry } from './render/outline.ts'
export { extractOutline } from './render/outline.ts'
export type { DocumentText } from './render/text.ts'
export { extractText } from './render/text.ts'
export type { ExtractedLink } from './render/links.ts'
export { extractLinks } from './render/links.ts'

// The editor converter
export { extensions, schema } from './prosemirror/schema.ts'
export type {
  FromMdastOptions,
  ProseMirrorDocument,
  SoftBreakMode,
} from './prosemirror/from-mdast.ts'
export { mdastToProseMirror } from './prosemirror/from-mdast.ts'
export type { MdastDocument } from './prosemirror/to-mdast.ts'
export { proseMirrorToMdast } from './prosemirror/to-mdast.ts'
export { liftLayout, wrapLayout } from './prosemirror/layout.ts'
