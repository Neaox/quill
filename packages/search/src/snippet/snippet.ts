/**
 * Snippet windows for search results (ADR-010): a short excerpt of a
 * document's body around its matches, trimmed at sentence boundaries, with
 * the matched spans given back as character offsets rather than markup. A
 * caller renders those offsets however its surface needs to — `<mark>` in
 * HTML, a styled `Text` run natively — which is also why this never touches
 * HTML itself. Offsets are UTF-16 code units into `text`, matching how a
 * JavaScript string already indexes, the same convention `@quill/highlight`
 * uses for token ranges; the body is assumed already normalised to `\n` line
 * endings, as every document is once it has been through `@quill/markdown`.
 */

export interface SnippetRange {
  readonly start: number
  readonly end: number
}

export interface Snippet {
  /** The extracted window of body text. `ranges` are offsets into this string, not into the original body. */
  readonly text: string
  readonly ranges: readonly SnippetRange[]
}

export interface SnippetOptions {
  readonly maxLength?: number
}

const DEFAULT_MAX_LENGTH = 200

/**
 * Builds a snippet of `body` around the first matches of `terms`.
 *
 * The window starts at the sentence holding the first match (the whole body
 * as a fallback when nothing matched, so an empty query still gets a useful
 * preview) and grows forward one sentence at a time while it still fits
 * `maxLength`. A single sentence longer than the limit is truncated to a
 * window centred on the match instead of being cut off at zero — a snippet
 * is never empty just because a document's sentences are long.
 */
export function buildSnippet(
  body: string,
  terms: readonly string[],
  options: SnippetOptions = {},
): Snippet {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH
  const matches = findMatches(body, terms)
  const sentences = segmentSentences(body)
  const window = chooseWindow(sentences, matches, maxLength)

  const slice = body.slice(window.start, window.end)
  const leadingTrim = slice.length - slice.trimStart().length
  const text = slice.trim()
  const textStart = window.start + leadingTrim
  const textEnd = textStart + text.length

  const ranges = matches.flatMap((match): readonly SnippetRange[] => {
    const start = Math.max(match.start, textStart)
    const end = Math.min(match.end, textEnd)
    return start < end ? [{ start: start - textStart, end: end - textStart }] : []
  })

  return { text, ranges }
}

interface Span {
  readonly start: number
  readonly end: number
}

/** Every non-overlapping occurrence of every term, case-insensitively, in document order. */
function findMatches(body: string, terms: readonly string[]): readonly Span[] {
  const lowerBody = body.toLowerCase()
  const matches: Span[] = []

  for (const term of terms) {
    const needle = term.toLowerCase()
    if (needle.length === 0) continue

    let from = 0
    for (;;) {
      const at = lowerBody.indexOf(needle, from)
      if (at === -1) break
      matches.push({ start: at, end: at + needle.length })
      from = at + needle.length
    }
  }

  return matches.toSorted((a, b) => a.start - b.start)
}

/** Sentence boundaries via `Intl.Segmenter`, which is Unicode-aware in a way a punctuation regex is not. */
function segmentSentences(body: string): readonly Span[] {
  if (body.length === 0) return []
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
  return Array.from(segmenter.segment(body), (segment) => ({
    start: segment.index,
    end: segment.index + segment.segment.length,
  }))
}

/** The sentence-aligned window to show: the sentence holding the first match, grown forward while it still fits. */
function chooseWindow(
  sentences: readonly Span[],
  matches: readonly Span[],
  maxLength: number,
): Span {
  if (sentences.length === 0) return { start: 0, end: 0 }

  const anchor = matches[0]?.start ?? 0
  // `sentences` covers `body` end to end (Intl.Segmenter's segments are
  // contiguous from 0 to `body.length`) and `anchor` is always a valid
  // position within `body` (0 by default, or a real match start, always
  // less than `body.length`), so some sentence's end is always past it —
  // `findIndex` returning -1 would mean that invariant broke, which no
  // input can trigger; `noUncheckedIndexedAccess` cannot see that from the
  // array alone.
  let index = sentences.findIndex((sentence) => anchor < sentence.end)
  const anchorSentence = sentences[index] as Span
  let start = anchorSentence.start
  let end = anchorSentence.end

  while (end - start < maxLength && index + 1 < sentences.length) {
    const next = sentences[index + 1] as Span
    if (next.end - start > maxLength) break
    end = next.end
    index += 1
  }

  return end - start > maxLength
    ? truncateAroundAnchor(start, end, anchor, maxLength)
    : { start, end }
}

/** A window of at most `maxLength`, centred on `anchor`, clipped to a sentence too long to show whole. */
function truncateAroundAnchor(
  sentenceStart: number,
  sentenceEnd: number,
  anchor: number,
  maxLength: number,
): Span {
  const half = Math.floor(maxLength / 2)
  const start = Math.max(sentenceStart, Math.min(anchor - half, sentenceEnd - maxLength))
  const end = Math.min(sentenceEnd, start + maxLength)
  return { start, end }
}
