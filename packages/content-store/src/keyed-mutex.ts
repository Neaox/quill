/**
 * Serialises tasks that share a key, in this process.
 *
 * Publishes within one workspace run one at a time ahead of the
 * compare-and-swap (ADR-014). The compare-and-swap is what makes concurrent
 * publishes *safe*; this is what stops a single server spending its time
 * losing races to itself.
 */

export class KeyedMutex {
  readonly #tails = new Map<string, Promise<unknown>>()

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve()
    const result = previous.then(task)
    // The tail never rejects, so one failed task does not poison the queue.
    const tail = result.then(ignore, ignore)
    this.#tails.set(key, tail)
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key)
    })
    return result
  }

  /** Keys with work queued or running; zero when the queue has drained. */
  get pending(): number {
    return this.#tails.size
  }
}

function ignore(): void {}
