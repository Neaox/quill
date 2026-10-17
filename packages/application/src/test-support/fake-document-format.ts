import type {
  ComparedChange,
  ComparedContent,
  ComparedSource,
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
  RenderInput,
} from '../ports/document-format.ts'
import {
  COMPARED_CONTENT_VERSION,
  DRAFT_CONTENT_VERSION,
  RENDERED_CONTENT_VERSION,
} from '../ports/document-format.ts'
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

    render({ markdown, linkTitles, drawings, labels, emoji, labelEmoji }): RenderedContent {
      const { frontMatter, body } = parse(markdown)
      const headings = [...headingsOf(body)]
      return {
        version: RENDERED_CONTENT_VERSION,
        // The titles are part of the render input, so a body that links to a
        // renamed document renders differently — which is what the cache key
        // covering them is for (ADR-031).
        html: `<article>${titled(body, linkTitles)}${drawn(drawings)}${labelled(labels)}${emojiShown(emoji, labelEmoji)}</article>`,
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

    /**
     * Line by line and position by position: a line that differs in place is
     * changed, one only the newer body has is added, one only the older has
     * is removed. Enough to see a use case hand the right two texts over.
     */
    compare({ before, after, patches, draft, authorship }): ComparedContent {
      const older = parse(before)
        .body.split(NEWLINE)
        .filter((line) => line !== '')
      const newer = parse(after)
        .body.split(NEWLINE)
        .filter((line) => line !== '')
      const changes = Array.from(
        { length: Math.max(older.length, newer.length) },
        (_, index): ComparedChange | undefined => {
          const was = older[index]
          const now = newer[index]
          const text = now ?? was
          if (text === undefined || was === now) return undefined
          return {
            id: `c${index + 1}`,
            change: was === undefined ? 'added' : now === undefined ? 'removed' : 'changed',
            block: 'paragraph',
            excerpt: text,
            wordsAdded: now === undefined ? 0 : 1,
            wordsRemoved: was === undefined ? 0 : 1,
            ...(patches === true ? { html: text } : {}),
            ...(draft === undefined ? {} : { revertible: true }),
            ...(draft === undefined || !isFakeStamp(authorship)
              ? {}
              : { author: { userId: authorship.by, at: authorship.at } }),
          }
        },
      ).filter((change) => change !== undefined)
      const count = (kind: ComparedChange['change']) =>
        changes.filter((change) => change.change === kind).length
      return {
        version: COMPARED_CONTENT_VERSION,
        html: newer.join(NEWLINE),
        sections: [],
        changes,
        summary: {
          sections: changes.length === 0 ? 0 : 1,
          added: count('added'),
          removed: count('removed'),
          changed: count('changed'),
          moved: 0,
          wordsAdded: changes.reduce((total, change) => total + change.wordsAdded, 0),
          wordsRemoved: changes.reduce((total, change) => total + change.wordsRemoved, 0),
        },
        properties: [],
      }
    },

    /**
     * By position, as `compare` pairs lines: a changed line goes back to what it was, an
     * added one is taken out, a removed one is put back at its place.
     */
    revert({ before, draft, changes }): DraftContent {
      const older = parse(before)
        .body.split(NEWLINE)
        .filter((line) => line !== '')
      const lines = bodyOf(draft)
        .split(NEWLINE)
        .filter((line) => line !== '')
      const places = changes.map((id) => Number(id.slice(1)) - 1).toSorted((a, b) => b - a)
      for (const place of places) {
        const was = older[place]
        if (was === undefined) lines.splice(place, 1)
        else lines.splice(place, place < lines.length ? 1 : 0, was)
      }
      return { ...draft, ast: { body: lines.join(NEWLINE) } }
    },

    /** One stamp for the whole body: the fake has no blocks to tell apart. */
    stampAuthorship({ next, by, at }): unknown {
      return { version: 1, body: bodyOf(next), by, at }
    },

    compareSource(before, after): ComparedSource {
      const older = before.split(NEWLINE)
      const newer = new Set(after.split(NEWLINE))
      const kept = new Set(older)
      return {
        lines: [
          ...older.map((text, index) => ({
            change: newer.has(text) ? ('equal' as const) : ('removed' as const),
            before: index + 1,
            segments: [{ change: 'equal' as const, text }],
          })),
          ...after
            .split(NEWLINE)
            .filter((text) => !kept.has(text))
            .map((text) => ({
              change: 'added' as const,
              segments: [{ change: 'added' as const, text }],
            })),
        ],
        wordsAdded: 0,
        wordsRemoved: 0,
      }
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

/** The drawings a body was handed, shown so a test can see which ones reached the renderer. */
function drawn(drawings: RenderInput['drawings']): string {
  return [...(drawings ?? new Map())]
    .map(([url, drawing]) => `<drawing src="${url}">${drawing.markup}</drawing>`)
    .join('')
}

/** The label names a body was rendered with, so a test can see they arrived (ADR-037). */
function labelled(labels: RenderInput['labels']): string {
  return [...(labels ?? [])].map((name) => `<label name="${name}"/>`).join('')
}

/** The emoji a body was rendered with, and each label's leading one (ADR-038). */
function emojiShown(emoji: RenderInput['emoji'], leading: RenderInput['labelEmoji']): string {
  const images = [...(emoji ?? new Map())].map(
    ([name, image]) => `<emoji name="${name}" src="${image.src}"/>`,
  )
  const leads = [...(leading ?? new Map())].map(
    ([label, name]) => `<lead label="${label}" emoji="${name}"/>`,
  )
  return [...images, ...leads].join('')
}

function isFakeStamp(value: unknown): value is { by: string; at: string } {
  return typeof value === 'object' && value !== null && 'by' in value && 'at' in value
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
