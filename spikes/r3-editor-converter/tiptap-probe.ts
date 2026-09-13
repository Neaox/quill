// Headless probe: can TipTap build a ProseMirror schema in Node with no DOM?
import { getSchema, Node as TiptapNode, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'

console.log('typeof window:', typeof globalThis.window)
console.log('typeof document:', typeof globalThis.document)

const ContainerDirective = TiptapNode.create({
  name: 'containerDirective',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      directiveName: { default: null },
      directiveAttributes: { default: null },
      layout: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-directive]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-directive': '' }, HTMLAttributes), 0]
  },
})

const schema = getSchema([
  StarterKit,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem,
  Image,
  ContainerDirective,
])

console.log('\nnodes:', Object.keys(schema.nodes).join(', '))
console.log('\nmarks:', Object.keys(schema.marks).join(', '))
console.log(
  '\ncontainerDirective spec:',
  JSON.stringify({
    content: schema.nodes.containerDirective.spec.content,
    attrs: Object.keys(schema.nodes.containerDirective.spec.attrs ?? {}),
  }),
)

// Build a doc programmatically, no DOM.
const doc = schema.node('doc', null, [
  schema.node(
    'containerDirective',
    { directiveName: 'wide', directiveAttributes: {}, layout: 'wide' },
    [schema.node('paragraph', null, [schema.text('hi', [schema.marks.bold.create()])])],
  ),
])
doc.check()
console.log('\nbuilt + validated doc without a DOM:', JSON.stringify(doc.toJSON()))
