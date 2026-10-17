import { documentFacts, publicDocumentFacts } from '@quill/domain'
import type { DocumentLifecycle, DocumentStatus, PublicDocumentFacts } from '@quill/domain'

import type { DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import type { ReadPublishedDependencies } from './read-published.ts'
import { readSource } from './read-published.ts'

/**
 * The facts a document states about itself, as each kind of reader is shown
 * them (`docs/design/properties.md`, ADR-052).
 *
 * A member reading in the application sees owners as people: the address an
 * author wrote is looked up, and a verified person is shown by name — never
 * by the address, which a reader has no need of. Only a *verified* address
 * names anyone: an account that has not proved it holds an address could
 * otherwise put any name it liked beside a document that lists that address
 * as its owner. Everyone else on the list is shown as written (a team, a
 * mailbox). Outsiders — a share link, the public site — see the public facts
 * only: no people at all.
 */

export interface OwnerView {
  /** A person's name, or the value as written when it is not a verified person. */
  readonly label: string
  readonly person: boolean
}

/**
 * The lifecycle as a member is told it: who verified the document named as a
 * person on the same terms as an owner. A replacement stays the reference the
 * front matter holds, because whether this reader may follow it, and to
 * which address, is the surface's to decide.
 */
export type LifecycleView =
  | { readonly state: 'in-review' }
  | {
      readonly state: 'verified'
      readonly verifiedBy: OwnerView | undefined
      readonly verifiedAt: string | undefined
    }
  | { readonly state: 'deprecated'; readonly supersededBy: string | undefined }

export interface FactsView {
  /** A legacy status, kept on the wire and shown to nobody (`document-lifecycle.ts`). */
  readonly status: DocumentStatus | undefined
  readonly lifecycle: LifecycleView | undefined
  readonly type: string | undefined
  readonly owners: readonly OwnerView[]
  readonly tags: readonly string[]
  readonly reviewInterval: string | undefined
  readonly lastReviewed: string | undefined
}

export interface PersonView {
  /** What is written to front matter for this person: their address. */
  readonly value: string
  readonly name: string
  /** Shown beside the name in the picker, to tell two people of one name apart. */
  readonly detail: string
}

/** How many people the picker is offered for one query: enough to choose from, few to read. */
export const PEOPLE_SEARCH_LIMIT = 8

interface DirectoryDependencies {
  readonly uow: UnitOfWork
}

/** The verified people behind these addresses, keyed by the address as written. */
export async function namePeople(
  deps: DirectoryDependencies,
  emails: readonly string[],
): Promise<readonly PersonView[]> {
  if (emails.length === 0) return []
  const found = await deps.uow.repos.users.findVerifiedByEmails(emails)
  const byAddress = new Map(found.map((user) => [user.email.toLowerCase(), user]))
  return emails.flatMap((value) => {
    const user = byAddress.get(value.toLowerCase())
    return user === undefined ? [] : [{ value, name: user.displayName, detail: user.email }]
  })
}

export async function searchPeople(
  deps: DirectoryDependencies,
  query: string,
): Promise<readonly PersonView[]> {
  const wanted = query.trim()
  if (wanted === '') return []
  const found = await deps.uow.repos.users.searchVerified(wanted, PEOPLE_SEARCH_LIMIT)
  return found.map((user) => ({ value: user.email, name: user.displayName, detail: user.email }))
}

/** The facts a front matter record states, owners named as people where they are. */
export async function factsOf(
  deps: DirectoryDependencies,
  frontMatter: Readonly<Record<string, unknown>>,
): Promise<FactsView> {
  const facts = documentFacts(frontMatter)
  const verifier = facts.lifecycle?.state === 'verified' ? facts.lifecycle.verifiedBy : undefined
  // The owners and the verifier in one lookup, never one per person.
  const addresses = [...facts.owners, ...(verifier === undefined ? [] : [verifier])]
  const people = await namePeople(
    deps,
    [...new Set(addresses)].filter((value) => value.includes('@')),
  )
  const names = new Map(people.map((found) => [found.value, found.name]))
  const asOwner = (value: string): OwnerView => {
    const name = names.get(value)
    return name === undefined ? { label: value, person: false } : { label: name, person: true }
  }
  return {
    ...facts,
    lifecycle: lifecycleView(facts.lifecycle, asOwner),
    owners: facts.owners.map(asOwner),
  }
}

function lifecycleView(
  lifecycle: DocumentLifecycle | undefined,
  asOwner: (value: string) => OwnerView,
): LifecycleView | undefined {
  if (lifecycle?.state !== 'verified') return lifecycle
  return {
    state: 'verified',
    verifiedBy: lifecycle.verifiedBy === undefined ? undefined : asOwner(lifecycle.verifiedBy),
    verifiedAt: lifecycle.verifiedAt,
  }
}

/**
 * The public facts of a document's head revision at `now`, or null before
 * its first publish. `now` decides whether a verification still stands.
 */
export async function readPublicFacts(
  deps: ReadPublishedDependencies,
  document: Pick<DocumentRow, 'id' | 'workspaceId'>,
  now: Date,
): Promise<PublicDocumentFacts | null> {
  const source = await readSource(deps, document.workspaceId, { documentId: document.id })
  if (source === null) return null
  return publicDocumentFacts(documentFacts(deps.format.read(source.markdown).frontMatter), now)
}
