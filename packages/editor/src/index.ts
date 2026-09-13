/**
 * The document editor (ADR-003, ADR-021, ADR-027, ADR-029, ADR-030).
 *
 * A writing surface over the Markdown package's AST, plus the hooks that keep a
 * draft saved and a lock alive. The package makes no requests: everything it
 * needs from the outside is an interface the web application implements, which
 * is what lets the whole of it be tested with fakes.
 */

// The writing surface
export { DocumentEditor } from './document/document-editor.tsx'
export type { DocumentEditorHandle, DocumentEditorProps } from './document/document-editor.tsx'
export type { DocumentAst, DocumentNode, MdastNode } from './document-ast.ts'
export { documentFromMdast, documentToMdast } from './document/ast.ts'
export type { LoadedDocument, LoadOptions, SavedDocument } from './document/ast.ts'
export { baseExtensions, editorSchema } from './schema/editor-schema.ts'
export { createTable, tableCommands } from './schema/tables.ts'
export { buildExtensions } from './document/extensions.ts'
export type { EditorExtensionOptions } from './document/extensions.ts'
export { keyboardShortcuts } from './document/keymap.ts'
export { choosePaste } from './document/paste.ts'
export type { PasteAction, PasteInput } from './document/paste.ts'
export { chooseFiles, fileDrop } from './document/files.ts'
export type {
  DroppedFile,
  FileAction,
  FileDropInput,
  FileDropOptions,
  FileRequest,
} from './document/files.ts'
export {
  insertHardBreak,
  insertImage,
  insertLink,
  insertMarkdown,
  insertNode,
  markdownFragment,
  removeLink,
  setLink,
} from './document/commands.ts'
export type { ImageAttributes, LinkAttributes } from './document/commands.ts'

// Blocks, widths, and the block menu
export { BlockMenu } from './block/block-menu.tsx'
export type { BlockMenuProps, CommentRequest } from './block/block-menu.tsx'
export {
  blockWidth,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  setBlockWidth,
  supportsWidth,
  topLevelBlock,
} from './block/commands.ts'
export type { BlockRef } from './block/commands.ts'
export {
  BLOCK_ACTIONS,
  BLOCK_WIDTHS,
  blockLabel,
  describeBlockMenu,
  widthLabel,
} from './block/block-state.ts'
export type { BlockAction, BlockMenuState } from './block/block-state.ts'

// The slash menu
export { SlashMenu } from './slash/slash-menu.tsx'
export type { SlashMenuProps } from './slash/slash-menu.tsx'
export { createSlashStore } from './slash/slash-store.ts'
export type { SlashSnapshot, SlashStore } from './slash/slash-store.ts'
export { filterSlashItems, SLASH_ITEMS } from './slash/slash-items.ts'
export type { SlashContext, SlashItem, SlashRequest } from './slash/slash-items.ts'

// Document properties, where the front matter block used to be
export { DocumentProperties, documentPropertiesStyles } from './properties/document-properties.tsx'
export type { DocumentPropertiesProps } from './properties/document-properties.tsx'
export {
  documentOwners,
  humanise,
  joinList,
  readProperties,
  splitList,
  summarise,
  templateQuestions,
  writeProperty,
  STATUS_VALUES,
} from './properties/front-matter.ts'
export type {
  OtherProperty,
  PropertiesModel,
  PropertiesSummary,
  PropertyField,
  PropertyKind,
  PropertyOption,
  ReadPropertiesOptions,
} from './properties/front-matter.ts'
export {
  applyFrontMatter,
  frontMatterPosition,
  frontMatterSource,
  withFrontMatterView,
} from './properties/front-matter-view.ts'

// Code blocks
export { LANGUAGES, loadGrammar, resolveLanguage } from './code-block/languages.ts'
export type { EditorLanguage } from './code-block/languages.ts'
export { COPIED_FEEDBACK_MS, PLAIN_TEXT } from './code-block/code-block-view.ts'
export {
  UNMAPPED_TOKEN_CLASSES,
  tokenHighlightStyle,
  tokenVariable,
} from './code-block/highlight-style.ts'
export { TOKEN_CLASSES } from '@quill/highlight'
export type { TokenClass } from '@quill/highlight'

// The template surface
export { useTemplateProgress } from './template/use-template-progress.ts'
export { declaredSections, templateDeclaration, templateProgress } from './template/progress.ts'
export type {
  SectionStatus,
  TemplateProgress,
  TemplateSectionProgress,
} from './template/progress.ts'
export { requiredHeadings } from './template/required-markers.ts'
export type { TemplateDeclarationSummary } from './template/progress.ts'

// Drafts and locking
export type {
  AcquireResult,
  Autosave,
  AutosaveStatus,
  Clock,
  DocumentLock,
  DraftClient,
  DraftSaveResult,
  FakeClock,
  HeartbeatResult,
  LoadedDraft,
  Lock,
  LockClient,
  LockEvent,
  LockHolder,
  LockState,
  LockStatus,
  PendingDraft,
  RecoveryStore,
  TakeoverResult,
  UseAutosaveOptions,
  UseDocumentLockOptions,
} from './drafts/index.ts'
export {
  AUTOSAVE_DEBOUNCE_MS,
  createFakeClock,
  createMemoryRecoveryStore,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_RETRY_DELAY_MS,
  initialLockState,
  lockReducer,
  systemClock,
  useAutosave,
  useDocumentLock,
  useUnsavedChangesGuard,
} from './drafts/index.ts'

// Testing
export { createEditorTestHarness } from './testing/harness.ts'
export type {
  EditorTestHarness,
  FakeDraftClient,
  FakeLockClient,
  Replies,
} from './testing/harness.ts'
