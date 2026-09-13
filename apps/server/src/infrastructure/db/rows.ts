/**
 * `noUncheckedIndexedAccess` types every array index as possibly `undefined`.
 * Non-null assertions are banned outside tests (AGENTS.md rule 4), so a spot
 * that is logically guaranteed to have a row (for example, the row just
 * returned by an `INSERT ... RETURNING *` we know matched) narrows with this
 * explicit runtime check instead.
 */
export function requireRow<Row>(row: Row | undefined, message: string): Row {
  if (row === undefined) {
    throw new Error(message)
  }
  return row
}
