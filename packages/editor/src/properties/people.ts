/**
 * The people an owner can be, as the properties line needs them (a port:
 * `docs/architecture/patterns.md`, ports and adapters).
 *
 * `@quill/editor` makes no requests, so the application supplies the
 * directory: names for the values a document already holds, and a search for
 * the picker. A person is written to front matter as their email address,
 * which is what survives export and Git sync; what anyone reads is their name.
 */

export interface Person {
  /** What is written to front matter: the person's email address. */
  readonly value: string
  readonly name: string
  /** Shown beside the name in the picker, to tell two Alex Chens apart. */
  readonly detail?: string | undefined
}

export interface PeopleDirectory {
  /** The name for a value the document holds, or `undefined` when it is not a known person. */
  nameOf(value: string): string | undefined
  /** People matching what is being typed; aborted when the typing moves on. */
  search(query: string, signal: AbortSignal): Promise<readonly Person[]>
}
