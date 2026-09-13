/**
 * The outcome of a rule that can fail for reasons the caller is expected to
 * handle.
 *
 * Domain rules return a `Result` rather than throwing so that an invalid grant
 * or a broken unit tree is part of the signature and cannot be forgotten.
 * Exceptions stay reserved for programmer error, such as a malformed id.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
