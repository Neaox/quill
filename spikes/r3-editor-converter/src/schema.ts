// The ProseMirror schema, built from real TipTap extensions with getSchema().
// Nothing here touches the DOM: getSchema() only reads the extension specs.
import { Extension, Node as TiptapNode, getSchema, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'
import Code from '@tiptap/extension-code'

const json = (name: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => {
    const raw = el.getAttribute('data-' + name)
    return raw ? JSON.parse(raw) : null
  },
  renderHTML: (attrs: Record<string, unknown>) =>
    attrs[name] ? { ['data-' + name]: JSON.stringify(attrs[name]) } : {},
})

const plain = (name: string, def: unknown = null) => ({
  default: def,
  parseHTML: (el: HTMLElement) => el.getAttribute('data-' + name),
  renderHTML: (attrs: Record<string, unknown>) =>
    attrs[name] == null ? {} : { ['data-' + name]: String(attrs[name]) },
})

// --- Quill-specific nodes -------------------------------------------------

// YAML front matter, kept verbatim so unknown fields survive (ADR-002).
const FrontMatter = TiptapNode.create({
  name: 'frontMatter',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes: () => ({ value: plain('value', '') }),
  parseHTML: () => [{ tag: 'div[data-front-matter]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ 'data-front-matter': '' }, HTMLAttributes),
  ],
})

// ":::name{attrs}" — ADR-027 layout wrappers and every other container.
const ContainerDirective = TiptapNode.create({
  name: 'containerDirective',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({ name: plain('name'), attributes: json('attributes') }),
  parseHTML: () => [{ tag: 'div[data-container-directive]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ 'data-container-directive': '' }, HTMLAttributes),
    0,
  ],
})

// "::name[label]{attrs}"
const LeafDirective = TiptapNode.create({
  name: 'leafDirective',
  group: 'block',
  content: 'inline*',
  addAttributes: () => ({ name: plain('name'), attributes: json('attributes') }),
  parseHTML: () => [{ tag: 'div[data-leaf-directive]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ 'data-leaf-directive': '' }, HTMLAttributes),
    0,
  ],
})

// ":name[label]{attrs}"
const TextDirective = TiptapNode.create({
  name: 'textDirective',
  group: 'inline',
  inline: true,
  content: 'inline*',
  addAttributes: () => ({ name: plain('name'), attributes: json('attributes') }),
  parseHTML: () => [{ tag: 'span[data-text-directive]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    mergeAttributes({ 'data-text-directive': '' }, HTMLAttributes),
    0,
  ],
})

const HtmlBlock = TiptapNode.create({
  name: 'htmlBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseHTML: () => [{ tag: 'pre[data-html-block]', preserveWhitespace: 'full' }],
  renderHTML: () => ['pre', { 'data-html-block': '' }, 0],
})

const HtmlInline = TiptapNode.create({
  name: 'htmlInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ value: plain('value', '') }),
  parseHTML: () => [{ tag: 'span[data-html-inline]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    mergeAttributes({ 'data-html-inline': '' }, HTMLAttributes),
  ],
})

// "[id]: url" — a reference definition has no rendered form, but it must
// survive the round trip, so it is a real (invisible) node in the document.
const Definition = TiptapNode.create({
  name: 'definition',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes: () => ({
    identifier: plain('identifier'),
    label: plain('label'),
    url: plain('url'),
    title: plain('title'),
  }),
  parseHTML: () => [{ tag: 'div[data-definition]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ 'data-definition': '' }, HTMLAttributes),
  ],
})

const FootnoteDefinition = TiptapNode.create({
  name: 'footnoteDefinition',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({ identifier: plain('identifier'), label: plain('label') }),
  parseHTML: () => [{ tag: 'div[data-footnote-definition]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ 'data-footnote-definition': '' }, HTMLAttributes),
    0,
  ],
})

const FootnoteReference = TiptapNode.create({
  name: 'footnoteReference',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ identifier: plain('identifier'), label: plain('label') }),
  parseHTML: () => [{ tag: 'sup[data-footnote-reference]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'sup',
    mergeAttributes({ 'data-footnote-reference': '' }, HTMLAttributes),
  ],
})

// Escape hatch: any mdast node the schema does not know is carried as JSON.
const RawMdast = TiptapNode.create({
  name: 'rawMdast',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes: () => ({ node: json('node') }),
  parseHTML: () => [{ tag: 'div[data-raw-mdast]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ 'data-raw-mdast': '' }, HTMLAttributes),
  ],
})

// --- Attributes added to stock TipTap nodes and marks ---------------------
// This is the whole answer to "is TipTap's schema customisation enough?":
// addGlobalAttributes reaches into extensions we did not write.

const LAYOUT_TARGETS = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'taskList',
  'table',
  'image',
  'horizontalRule',
  'htmlBlock',
  'containerDirective',
  'leafDirective',
  'footnoteDefinition',
]

// TipTap's Code mark ships with `excludes: "_"`, so it cannot coexist with any
// other mark. Markdown disagrees: "[`parse()`](./api.md)" is a link around an
// inlineCode and "**`bold code`**" is a strong around an inlineCode. Without
// this override the converter produces documents that fail Node.check().
//
// `Extension.addGlobalAttributes` cannot fix this and neither can
// `extendMarkSchema`: getSchemaByResolvedExtensions() spreads extendMarkSchema
// first and then lets the extension's own `excludes` field win. The mark has to
// be re-declared with `.extend()`, which means importing it directly instead of
// taking StarterKit's copy.
const QuillCode = Code.extend({ excludes: '' })

const QuillAttributes = Extension.create({
  name: 'quillAttributes',
  addGlobalAttributes: () => [
    // ADR-027: layout width as a property of the block itself.
    { types: LAYOUT_TARGETS, attributes: { layout: plain('layout') } },
    // mdast keeps loose/tight list information; the editor must not lose it.
    { types: ['bulletList', 'orderedList', 'taskList'], attributes: { spread: plain('spread') } },
    { types: ['listItem', 'taskItem'], attributes: { spread: plain('spread') } },
    // GFM allows a list where only some items are checkboxes; TipTap's TaskList
    // cannot express that, so a plain listItem carries the state too.
    { types: ['listItem'], attributes: { checked: plain('checked') } },
    // Marks a paragraph the converter had to invent to satisfy a content
    // expression such as listItem = "paragraph block*" or tableCell = "block+".
    { types: ['paragraph'], attributes: { synthetic: plain('synthetic') } },
    // GFM per-column alignment lives on the table node in mdast.
    { types: ['table'], attributes: { align: json('align') } },
    // The info string after the language on a fenced code block.
    { types: ['codeBlock'], attributes: { meta: plain('meta') } },
    // A directive's label paragraph: ":::note[Label]".
    { types: ['paragraph'], attributes: { directiveLabel: plain('directiveLabel') } },
    // Reference-style links and images, plus link titles.
    {
      types: ['link'],
      attributes: {
        title: plain('title'),
        referenceType: plain('referenceType'),
        identifier: plain('identifier'),
        label: plain('label'),
      },
    },
    {
      types: ['image'],
      attributes: {
        referenceType: plain('referenceType'),
        identifier: plain('identifier'),
        label: plain('label'),
      },
    },
  ],
})

export const extensions = [
  StarterKit.configure({
    // Quill has no underline in Markdown; drop it so the schema matches mdast.
    underline: false,
    // Replaced below with a version whose `excludes` is empty.
    code: false,
    link: { openOnClick: false },
  }),
  Image.configure({ inline: true, allowBase64: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
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
  QuillAttributes,
  QuillCode,
]

export const schema = getSchema(extensions)
