/**
 * The name a mistyped one was probably meant to be: the nearest by edit
 * distance, when it is near enough to be a typo rather than another word.
 * This is how a directive the author misspelt gets a "did you mean" instead
 * of only being told it is unknown (ADR-037).
 */
export function nearestName(typed: string, names: Iterable<string>): string | undefined {
  const allowed = typoAllowance(typed)
  let best: { readonly name: string; readonly distance: number } | undefined
  for (const name of names) {
    const distance = editDistance(typed, name)
    if (distance <= allowed && (best === undefined || distance < best.distance)) {
      best = { name, distance }
    }
  }
  return best?.name
}

/** One slip in a short word, two in a longer one: past that it is a different word. */
function typoAllowance(typed: string): number {
  return typed.length <= 4 ? 1 : 2
}

/**
 * Optimal string alignment distance: insertions, deletions, substitutions,
 * and a swap of two neighbours, each one edit, because swapping two letters is
 * the commonest typo there is (`aribnb`).
 */
function editDistance(from: string, to: string): number {
  const rows = Array.from({ length: from.length + 1 }, (_row, row) =>
    Array.from({ length: to.length + 1 }, (_column, column) =>
      row === 0 ? column : column === 0 ? row : 0,
    ),
  )
  // Every read is inside the table; the fallback only satisfies the index type.
  /* v8 ignore next */
  const at = (row: number, column: number): number =>
    rows[row]?.[column] ?? Number.POSITIVE_INFINITY
  for (let row = 1; row <= from.length; row += 1) {
    for (let column = 1; column <= to.length; column += 1) {
      const same = from[row - 1] === to[column - 1]
      const swapped =
        row > 1 &&
        column > 1 &&
        from[row - 1] === to[column - 2] &&
        from[row - 2] === to[column - 1]
      const cell = rows[row]
      /* v8 ignore next -- every row up to from.length exists. */
      if (cell === undefined) continue
      cell[column] = Math.min(
        at(row - 1, column) + 1,
        at(row, column - 1) + 1,
        at(row - 1, column - 1) + (same ? 0 : 1),
        swapped ? at(row - 2, column - 2) + 1 : Number.POSITIVE_INFINITY,
      )
    }
  }
  return at(from.length, to.length)
}
