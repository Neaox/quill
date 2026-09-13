import { useEffect, useState } from 'react'

import type { TokenRange } from '@quill/highlight'

export interface HighlightedCodeProps {
  readonly code: string
  /** A Markdown fence name: `ts`, `bash`, `json`. */
  readonly language: string
}

interface Piece {
  readonly key: string
  readonly text: string
  /**
   * The themed class for this range, or `undefined` for the plain text
   * between ranges. Built here rather than in the JSX because the class *is*
   * the token — data from the tokenizer, not a choice made from state.
   */
  readonly tokenClass: string | undefined
}

/**
 * Ranges tile the text, so the gaps between them are its plain parts. This
 * lives here rather than in `@quill/highlight` because it is a React
 * presentation of the ranges, and that package deliberately touches no DOM.
 */
function piecesOf(code: string, ranges: readonly TokenRange[]): readonly Piece[] {
  const pieces: Piece[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) {
      pieces.push({
        key: `plain-${cursor}`,
        text: code.slice(cursor, range.start),
        tokenClass: undefined,
      })
    }
    pieces.push({
      key: `tok-${range.start}`,
      text: code.slice(range.start, range.end),
      tokenClass: `tok-${range.type}`,
    })
    cursor = range.end
  }
  if (cursor < code.length) {
    pieces.push({ key: `plain-${cursor}`, text: code.slice(cursor), tokenClass: undefined })
  }
  return pieces
}

/**
 * A code sample coloured by the real tokenizer.
 *
 * In the product the server tokenizes at publish time and ships packed ranges,
 * so no grammar reaches a reader (ADR-030). A showcase has no server behind
 * it, so it takes the ADR's other path — highlight on demand — and loads the
 * tokenizer with a dynamic import. That keeps Prism and its grammars out of
 * the first-load bundle in its own chunk, and it means the sample is honestly
 * tokenized rather than hand-marked: the `tok-*` classes below are the same
 * ones the renderer emits, reading the same `--token-*` variables the theme
 * generates.
 *
 * Until the chunk arrives the code is readable in plain monospace, which is
 * exactly what a reader without JavaScript gets.
 */
export function HighlightedCode({ code, language }: HighlightedCodeProps) {
  const [pieces, setPieces] = useState<readonly Piece[] | undefined>(undefined)

  // Loads the tokenizer chunk — a dynamic import, an external system to the
  // render — and applies its result once it arrives (ADR-030).
  useEffect(() => {
    let current = true
    void import('@quill/highlight').then(({ resolveLanguage, tokenize }) => {
      const resolved = resolveLanguage(language)
      if (!current || resolved === null) return
      setPieces(piecesOf(code, tokenize(code, resolved)))
    })
    return () => {
      current = false
    }
  }, [code, language])

  if (pieces === undefined) return code

  return (
    <>
      {pieces.map((piece) =>
        piece.tokenClass === undefined ? (
          piece.text
        ) : (
          <span key={piece.key} className={piece.tokenClass}>
            {piece.text}
          </span>
        ),
      )}
    </>
  )
}
