/**
 * The item at an index the caller has already bounded.
 *
 * `noUncheckedIndexedAccess` types every index as possibly missing, and the
 * diff's dynamic programmes index into arrays they have just sized. The
 * fallback is how the types are satisfied without a non-null assertion; it is
 * never taken, which is why it is the one place a branch is ignored.
 */
export function itemAt<T>(items: ArrayLike<T>, index: number, fallback: T): T {
  /* v8 ignore next -- callers stay inside the bounds they have just checked. */
  return items[index] ?? fallback
}
