import type { FindState } from './find-state.ts'

/**
 * What the find bar says about what it found, in the words VS Code uses: "2 of 3" when the selection
 * is on a match, "3 results" when it is not, "No results", and "10,000+" where it stopped looking.
 */
export function matchSummary({ pattern, found, current }: FindState): string {
  if (pattern.kind === 'empty') return ''
  // The engine's own message begins by naming the expression, which is already in the field.
  if (pattern.kind === 'invalid') {
    return `Invalid expression: ${pattern.message.replace(/^Invalid regular expression: .*?: /u, '')}`
  }
  const count = found.matches.length
  if (count === 0) return 'No results'
  const total = `${String(count)}${found.truncated ? '+' : ''}`
  if (current >= 0) return `${String(current + 1)} of ${total}`
  return `${total} ${total === '1' ? 'result' : 'results'}`
}
