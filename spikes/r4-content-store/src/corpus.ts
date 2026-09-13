/** Synthetic workspace corpus: nested directories, ~2 KB Markdown per doc. */

const SECTIONS = [
  'handbook',
  'engineering',
  'product',
  'design',
  'operations',
  'security',
  'support',
  'marketing',
]
const SUBSECTIONS = [
  'architecture',
  'runbooks',
  'guides',
  'reference',
  'policies',
  'onboarding',
  'postmortems',
  'decisions',
]

const LOREM =
  'The content store is the only place published document content lives. ' +
  'It is a Git-compatible object engine used as a library against a bare repository. ' +
  'There is no working directory, no index, no checkout, and a single branch. '

export interface Doc {
  id: string
  path: string
  title: string
  content: string
}

/** Deterministic path: <section>/<subsection>/<bucket>/<slug>.md — 4 levels deep. */
export function docPath(i: number): string {
  const s = SECTIONS[i % SECTIONS.length] as string
  const sub = SUBSECTIONS[Math.floor(i / SECTIONS.length) % SUBSECTIONS.length] as string
  const bucket = `g${Math.floor(i / (SECTIONS.length * SUBSECTIONS.length)) % 64}`
  return `workspace/${s}/${sub}/${bucket}/doc-${i}.md`
}

export function makeDoc(i: number, revision = 0): Doc {
  const id = `doc_${String(i).padStart(6, '0')}`
  const title = `Document ${i}`
  const body: string[] = [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    `order: ${(i % 1000) * 10}`,
    'status: published',
    '---',
    '',
    `# ${title}`,
    '',
    `Revision marker: ${revision}`,
    '',
  ]
  // pad to ~2 KB
  let size = body.join('\n').length
  let p = 0
  while (size < 2048) {
    const para = `${LOREM}(paragraph ${p} of document ${i}, revision ${revision})`
    body.push(para, '')
    size += para.length + 2
    p++
  }
  return { id, path: docPath(i), title, content: body.join('\n') }
}
