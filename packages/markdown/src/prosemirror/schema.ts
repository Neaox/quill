import { Mark, Node, getSchema } from '@tiptap/core'
import type { Attributes, Extensions } from '@tiptap/core'
import type { Schema } from 'prosemirror-model'

/**
 * The editor schema (ADR-003), built with TipTap's `getSchema()`. `getSchema()`
 * reads extension specs and touches no DOM, so this module runs unchanged on the
 * server, in a worker, and in a test. Nothing here renders HTML: the reading
 * surfaces render from mdast, and the editor application supplies the views,
 * keymaps, and input rules on top of these specs.
 */

/** Attributes default to null so an unset attribute and an absent one are the same thing. */
function attributes(...names: readonly string[]): Attributes {
  return Object.fromEntries(
    names.map((name) => [name, name === SOURCE_FORM ? SOURCE_FORM_SPEC : { default: null }]),
  )
}

/** ADR-027: width is a property of the block, not a wrapper the author can see. */
const LAYOUT = 'layout'

/**
 * How the node was written where mdast does not record it (`pipeline/source-form.ts`):
 * opaque here, carried so a document saved unchanged is written back as it was.
 * It is never drawn into the DOM, and a node split off another was written
 * nowhere, so it does not inherit it.
 */
const SOURCE_FORM = 'sourceForm'
const SOURCE_FORM_SPEC = { default: null, rendered: false, keepOnSplit: false }

/**
 * What every block that can take a width carries: the width, and how it was
 * written — including, for the first block lifted out of a `:::wide` wrapper,
 * how the wrapper was written (`layout.ts`).
 */
const BLOCK = [LAYOUT, SOURCE_FORM] as const

const Doc = Node.create({ name: 'doc', topNode: true, content: 'block+' })

const Text = Node.create({ name: 'text', group: 'inline' })

const Paragraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  // `directiveLabel` is the `[Label]` of `:::note[Label]`; `synthetic` marks a
  // paragraph the converter invented to satisfy a content expression.
  addAttributes: () => attributes(...BLOCK, 'directiveLabel', 'synthetic'),
})

const Heading = Node.create({
  name: 'heading',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes: () => ({ level: { default: 1 }, ...attributes(...BLOCK) }),
})

const Blockquote = Node.create({
  name: 'blockquote',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => attributes(...BLOCK),
})

const CodeBlock = Node.create({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  addAttributes: () => attributes('language', 'meta', ...BLOCK),
})

/**
 * A code group (ADR-041): its tabs are code blocks, each named by its own
 * fence meta. The group keeps how it was written — the syntax, the spacing
 * and the opening line — so a document opened and saved unchanged is written
 * back byte for byte (`code-group/code-group.ts`).
 */
const CodeGroup = Node.create({
  name: 'codeGroup',
  group: 'block',
  content: 'codeBlock+',
  defining: true,
  isolating: true,
  addAttributes: () => ({
    syntax: { default: 'directive' },
    attributes: { default: {} },
    spread: { default: false },
    ...attributes('opening', ...BLOCK),
  }),
})

/**
 * A details (ADR-048): a summary line, then the blocks a reader opens it to
 * see. One node whatever it was written as — `:::details`, GitHub's HTML, an
 * Obsidian foldable callout — with the syntax and how it was spelled kept, so
 * a document saved unchanged is written back byte for byte
 * (`details/write.ts`). `attributes` is the shared vocabulary: `open` (open
 * for a reader by default), `name` (an exclusive group) and `type` (drawn as
 * that callout).
 */
const Details = Node.create({
  name: 'details',
  group: 'block',
  content: 'detailsSummary block+',
  defining: true,
  addAttributes: () => ({
    syntax: { default: 'directive' },
    attributes: { default: {} },
    ...attributes('source', ...BLOCK),
  }),
})

/** The summary line a details is opened by: inline Markdown, one line of it. */
const DetailsSummary = Node.create({
  name: 'detailsSummary',
  content: 'inline*',
  defining: true,
  isolating: true,
})

const HorizontalRule = Node.create({
  name: 'horizontalRule',
  group: 'block',
  addAttributes: () => attributes(...BLOCK),
})

const HardBreak = Node.create({
  name: 'hardBreak',
  group: 'inline',
  inline: true,
  selectable: false,
  addAttributes: () => attributes(SOURCE_FORM),
})

// `spread` is mdast's loose/tight distinction; `checked` lets a plain list item
// carry a checkbox, because GFM allows a list where only some items have one and
// a dedicated task list cannot express that (research R3 section 7).
const BulletList = Node.create({
  name: 'bulletList',
  group: 'block',
  content: 'listItem+',
  addAttributes: () => attributes('spread', ...BLOCK),
})

const OrderedList = Node.create({
  name: 'orderedList',
  group: 'block',
  content: 'listItem+',
  addAttributes: () => ({ start: { default: 1 }, ...attributes('spread', ...BLOCK) }),
})

const TaskList = Node.create({
  name: 'taskList',
  group: 'block',
  content: 'taskItem+',
  addAttributes: () => attributes('spread', ...BLOCK),
})

const ListItem = Node.create({
  name: 'listItem',
  content: 'paragraph block*',
  defining: true,
  addAttributes: () => attributes('spread', 'checked', SOURCE_FORM),
})

const TaskItem = Node.create({
  name: 'taskItem',
  content: 'paragraph block*',
  defining: true,
  addAttributes: () => ({ checked: { default: false }, ...attributes('spread', SOURCE_FORM) }),
})

const Image = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  addAttributes: () => attributes('src', 'alt', 'title', 'referenceType', 'identifier', 'label'),
})

const Table = Node.create({
  name: 'table',
  group: 'block',
  content: 'tableRow+',
  isolating: true,
  addAttributes: () => attributes('align', ...BLOCK),
})

const TableRow = Node.create({
  name: 'tableRow',
  content: '(tableCell | tableHeader)*',
  addAttributes: () => attributes(SOURCE_FORM),
})

const TableCell = Node.create({
  name: 'tableCell',
  content: 'block+',
  isolating: true,
})

const TableHeader = Node.create({
  name: 'tableHeader',
  content: 'block+',
  isolating: true,
})

/** YAML front matter, kept verbatim so fields no schema knows survive (ADR-002). */
const FrontMatter = Node.create({
  name: 'frontMatter',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes: () => ({ value: { default: '' } }),
})

const ContainerDirective = Node.create({
  name: 'containerDirective',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({
    name: { default: null },
    attributes: { default: {} },
    // A callout that was written as a GitHub alert (`> [!NOTE]`), and how: it is
    // written back as one. Not drawn: it is how the Markdown was spelled.
    alert: { default: null, rendered: false },
    ...attributes(...BLOCK),
  }),
})

const LeafDirective = Node.create({
  name: 'leafDirective',
  group: 'block',
  content: 'inline*',
  addAttributes: () => ({
    name: { default: null },
    attributes: { default: {} },
    ...attributes(...BLOCK),
  }),
})

const TextDirective = Node.create({
  name: 'textDirective',
  group: 'inline',
  inline: true,
  content: 'inline*',
  addAttributes: () => ({
    name: { default: null },
    attributes: { default: {} },
    ...attributes(SOURCE_FORM),
  }),
})

const HtmlBlock = Node.create({
  name: 'htmlBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  addAttributes: () => attributes(...BLOCK),
})

const HtmlInline = Node.create({
  name: 'htmlInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ value: { default: '' } }),
})

/** A link reference definition has no rendered form but must survive the round trip. */
const Definition = Node.create({
  name: 'definition',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes: () => attributes('identifier', 'label', 'url', 'title'),
})

const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => attributes('identifier', 'label', ...BLOCK),
})

const FootnoteReference = Node.create({
  name: 'footnoteReference',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => attributes('identifier', 'label'),
})

/** The escape hatch: an mdast node this schema does not model, carried as JSON. */
const RawMdast = Node.create({
  name: 'rawMdast',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes: () => attributes('node'),
})

const Bold = Mark.create({ name: 'bold', addAttributes: () => attributes(SOURCE_FORM) })
const Italic = Mark.create({ name: 'italic', addAttributes: () => attributes(SOURCE_FORM) })
const Strike = Mark.create({ name: 'strike' })

/**
 * Inline code must not exclude other marks (research R3 finding 4(a)). Markdown
 * writes a link around inline code and strong around inline code every day, and a
 * mark that excludes everything makes both fail `Node.check()`. A guard test
 * asserts this exclusion list stays empty.
 */
const Code = Mark.create({ name: 'code', excludes: '', code: true })

const Link = Mark.create({
  name: 'link',
  inclusive: false,
  // `literal`: written bare in the source (`autolink-literal.ts`), so a save
  // writes it bare again while its words are still its address.
  addAttributes: () =>
    attributes('href', 'title', 'referenceType', 'identifier', 'label', 'literal'),
})

/**
 * The extension list. The editor application builds on this list rather than
 * redeclaring it, so the schema the converter targets and the schema the editor
 * runs are the same object.
 */
export const extensions: Extensions = [
  Doc,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  CodeGroup,
  Details,
  DetailsSummary,
  HorizontalRule,
  HardBreak,
  BulletList,
  OrderedList,
  TaskList,
  ListItem,
  TaskItem,
  Image,
  Table,
  TableRow,
  TableCell,
  TableHeader,
  FrontMatter,
  ContainerDirective,
  LeafDirective,
  TextDirective,
  HtmlBlock,
  HtmlInline,
  Definition,
  FootnoteDefinition,
  FootnoteReference,
  RawMdast,
  Bold,
  Italic,
  Strike,
  Code,
  Link,
]

export const schema: Schema = getSchema(extensions)
