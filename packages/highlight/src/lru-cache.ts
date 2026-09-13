/**
 * A least-recently-used cache bounded by a caller-supplied weight (character
 * count, in `highlight.ts`) rather than entry count, since a handful of huge
 * documents and thousands of tiny ones should not cost the same budget.
 *
 * `get` returns the identical value that was stored — never a copy — so a
 * cache hit lets a caller skip downstream work keyed on reference equality
 * (ADR-030).
 */
export class LruCache<V> {
  readonly #maxWeight: number
  readonly #entries = new Map<string, { value: V; weight: number }>()
  #totalWeight = 0

  constructor(maxWeight: number) {
    this.#maxWeight = maxWeight
  }

  /** Current number of entries, for tests and diagnostics. */
  get size(): number {
    return this.#entries.size
  }

  get(key: string): V | undefined {
    const entry = this.#entries.get(key)
    if (entry === undefined) return undefined
    // Re-insert to mark most-recently-used: Map iterates in insertion order,
    // so the least-recently-used entry is always the first one.
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: V, weight: number): void {
    const existing = this.#entries.get(key)
    if (existing !== undefined) {
      this.#totalWeight -= existing.weight
      this.#entries.delete(key)
    }
    this.#entries.set(key, { value, weight })
    this.#totalWeight += weight
    this.#evictToFit()
  }

  #evictToFit(): void {
    while (this.#totalWeight > this.#maxWeight && this.#entries.size > 0) {
      // The loop guard (`size > 0`) guarantees a first entry exists; the
      // iterator's type just can't express that.
      const [oldestKey, oldest] = this.#entries.entries().next().value as [
        string,
        { value: V; weight: number },
      ]
      this.#entries.delete(oldestKey)
      this.#totalWeight -= oldest.weight
    }
  }
}
