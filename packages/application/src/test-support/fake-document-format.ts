import type {
  DocumentFormat,
  DraftContent,
  ExtractedLink,
  FormatWarning,
  FrontMatterIssue,
  NewDocumentContent,
  OutlineEntry,
  PublishableDocument,
  PublishedDocumentView,
  RenderedContent,
} from '../ports/document-format.ts'
import { DRAFT_CONTENT_VERSION, RENDERED_CONTENT_VERSION } from '../ports/document-format.ts'
import type { DocumentId } from '@quill/domain'

/**
 * A `DocumentFormat` with the same contract as the real Markdown pipeline and
 * none of its machinery.
 *
 * A document is front matter as JSON above a body of plain lines, which makes
 * every rule a use case depends on observable in a test: an id is stamped,
 * placeholders warn without blocking, a required section with nothing under
 * it is reported, headings become an outline, and `[text](url)` becomes a
 * link. `packages/markdown` is exercised where it is composed, in the
 * server's own tests.
 */

const SEPARATOR = '\n---\n'
const NEWLINE = '\n'
const PLACEHOLDER = '::placeholder'
const HEADING = /^#+\s+(?<text>.+)$/
const LINK = /\[(?<text>[^\]]*)]\((?<url>[^)]*)\)/g
const AUTO_TITLED = /\[]\(\/d\/(?<id>[0-9a-f-]{36})\)/g
const SUBSTITUTION = /\{\{\s*answers\.(\w+)\s*}}/g
const SCHEME = /^[a-z][a-z\d+.-]*:/i

export interface FakeDocumentFormatOptions {
  /** Front matter every created document carries, over which the caller's own wins. */
  readonly defaults?: Readonly<Record<string, unknown>>
}

export function createFakeDocumentFormat(options: FakeDocumentFormatOptions = {}): DocumentFormat {
  return {
    create({ documentId, title, template }): NewDocumentContent {
      const scaffold =
        template === undefined ? null : { ...parse(template.markdown), answers: template.answers }
      const requiredSections = readStrings(scaffold?.frontMatter['requiredSections'])
      const body = scaffold === null ? `# ${title}` : substitute(scaffold.body, scaffold.answers)
      return {
        content: {
          version: DRAFT_CONTENT_VERSION,
          frontMatter: {
            ...options.defaults,
            ...scaffold?.frontMatter,
            id: documentId,
            title,
            ...(requiredSections.length === 0 ? {} : { requiredSections }),
          },
          ast: { body },
        },
        requiredSections,
        warnings: body.includes(PLACEHOLDER) ? [{ code: 'placeholder-remains', detail: body }] : [],
      }
    },

    prepareForPublish({ documentId, content }): PublishableDocument {
      const body = bodyOf(content)
      const warnings: FormatWarning[] = []
      const published = body
        .split('\n')
        .filter((line) => {
          if (!line.startsWith(PLACEHOLDER)) return true
          warnings.push({ code: 'placeholder-remains', detail: line.slice(PLACEHOLDER.length) })
          return false
        })
        .join('\n')

      const frontMatter: Record<string, unknown> = { ...content.frontMatter, id: documentId }
      const issues: FrontMatterIssue[] = []
      if (typeof frontMatter['title'] !== 'string') {
        issues.push({ path: 'title', message: 'must be a string' })
      }

      return {
        markdown: serialise(frontMatter, published),
        frontMatter,
        title: titleOf(frontMatter, published),
        warnings,
        frontMatterIssues: issues,
        incompleteRequiredSections: incompleteSections(
          published,
          readStrings(frontMatter['requiredSections']),
        ),
      }
    },

    /**
     * The title written into the document, the way the real pipeline writes
     * it: into the front matter key, and into the first heading when that
     * heading is what the document is named by.
     */
    retitle({ content, title }): DraftContent {
      const body = bodyOf(content)
      return {
        version: DRAFT_CONTENT_VERSION,
        frontMatter: { ...content.frontMatter, title },
        ast: { body: retitledBody(body, titleOf(content.frontMatter, body), title) },
      }
    },

    render({ markdown, linkTitles }): RenderedContent {
      const { frontMatter, body } = parse(markdown)
      const headings = [...headingsOf(body)]
      return {
        version: RENDERED_CONTENT_VERSION,
        // The titles are part of the render input, so a body that links to a
        // renamed document renders differently — which is what the cache key
        // covering them is for (ADR-031).
        html: `<article>${titled(body, linkTitles)}</article>`,
        outline: headings.map((text): OutlineEntry => ({
          id: text.toLowerCase().replaceAll(' ', '-'),
          depth: 1,
          text,
          children: [],
        })),
        text: { title: headings[0], headings, body },
        links: [...linksOf(body)],
        slots: [],
        incompleteRequiredSections: incompleteSections(
          body,
          readStrings(frontMatter['requiredSections']),
        ),
      }
    },

    read(markdown): PublishedDocumentView {
      const { frontMatter, body } = parse(markdown)
      return { frontMatter, title: titleOf(frontMatter, body) }
    },

    toDraft(markdown): DraftContent {
      const { frontMatter, body } = parse(markdown)
      return { version: DRAFT_CONTENT_VERSION, frontMatter, ast: { body } }
    },
  }
}

/**
 * An auto-titled link — `[](/d/<id>)` — shows whatever title its target
 * carries now, which is the one thing a rendered body depends on beyond its
 * own source (ADR-031).
 */
function titled(body: string, linkTitles: ReadonlyMap<DocumentId, string>): string {
  return body.replaceAll(AUTO_TITLED, (match: string, id: string) => {
    const title = linkTitles.get(id as DocumentId)
    return title === undefined ? match : `[${title}](/d/${id})`
  })
}

/** The Markdown a document with this front matter and body would be written as. */
export function serialise(frontMatter: Record<string, unknown>, body: string): string {
  return `${JSON.stringify(frontMatter)}${SEPARATOR}${body}`
}

function parse(markdown: string): { frontMatter: Record<string, unknown>; body: string } {
  const separator = markdown.indexOf(SEPARATOR)
  if (separator === -1) return { frontMatter: {}, body: markdown }
  const head = markdown.slice(0, separator)
  const body = markdown.slice(separator + SEPARATOR.length)
  const parsed: unknown = JSON.parse(head)
  return {
    frontMatter:
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {},
    body,
  }
}

function bodyOf(content: DraftContent): string {
  const ast = content.ast
  if (typeof ast !== 'object' || ast === null) return ''
  const body = (ast as { body?: unknown }).body
  return typeof body === 'string' ? body : ''
}

/** The body with the heading that names the document rewritten, if it has one. */
function retitledBody(body: string, current: string | undefined, title: string): string {
  const lines = body.split(NEWLINE)
  const naming = lines.findIndex((line) => headingText(line) === current)
  return lines
    .map((line, index) =>
      index === naming ? `${line.slice(0, line.indexOf(' '))} ${title}` : line,
    )
    .join(NEWLINE)
}

function titleOf(frontMatter: Record<string, unknown>, body: string): string | undefined {
  const declared = frontMatter['title']
  if (typeof declared === 'string') return declared
  return [...headingsOf(body)][0]
}

/**
 * The text of a heading line, or undefined when the line is not a heading.
 *
 * Every group in the patterns above is mandatory, so a match always carries
 * its groups; the fallback in `group` keeps the types honest rather than
 * describing a case that can happen.
 */
function headingText(line: string): string | undefined {
  const match = HEADING.exec(line)
  return match === null ? undefined : group(match, 'text').trim()
}

function group(match: RegExpExecArray | RegExpMatchArray, name: string): string {
  /* v8 ignore next -- see headingText: a match always carries its groups. */
  return match.groups?.[name] ?? ''
}

function* headingsOf(body: string): Generator<string> {
  for (const line of body.split('\n')) {
    const text = headingText(line)
    if (text !== undefined) yield text
  }
}

function* linksOf(body: string): Generator<ExtractedLink> {
  for (const match of body.matchAll(LINK)) {
    const url = group(match, 'url')
    yield { kind: 'link', url, text: group(match, 'text'), external: SCHEME.test(url) }
  }
}

/** A required heading with no content beneath it before the next heading. */
function incompleteSections(body: string, required: readonly string[]): readonly string[] {
  if (required.length === 0) return []
  const lines = body.split('\n')
  return required.filter((heading) => {
    const start = lines.findIndex((line) => headingText(line) === heading)
    if (start === -1) return true
    const after = lines.slice(start + 1)
    const next = after.findIndex((line) => HEADING.test(line))
    const section = next === -1 ? after : after.slice(0, next)
    return section.every((line) => line.trim().length === 0)
  })
}

function substitute(body: string, answers: Readonly<Record<string, unknown>>): string {
  return body.replaceAll(SUBSTITUTION, (match: string, id: string) => {
    const answer = answers[id]
    return answer === undefined ? match : String(answer)
  })
}

function readStrings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
}
