import { schema } from './src/schema.ts'

console.log('typeof document:', typeof globalThis.document)
console.log('nodes:', Object.keys(schema.nodes).join(' '))
console.log('marks:', Object.keys(schema.marks).join(' '))
console.log('')
for (const name of Object.keys(schema.nodes)) {
  const spec = schema.nodes[name].spec
  console.log(
    name.padEnd(20),
    '| content:',
    String(spec.content ?? '-').padEnd(16),
    '| group:',
    String(spec.group ?? '-').padEnd(8),
    '| attrs:',
    Object.keys(spec.attrs ?? {}).join(','),
  )
}
console.log('')
for (const name of Object.keys(schema.marks)) {
  console.log('mark', name.padEnd(10), Object.keys(schema.marks[name].spec.attrs ?? {}).join(','))
}
