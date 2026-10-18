import { documentFacts, publicDocumentFacts } from '@quill/domain'
import type {
  DocumentId,
  DocumentLifecycle,
  DocumentStatus,
  PublicDocumentFacts,
} from '@quill/domain'

import type { DocumentRow, UnitOfWork, UserRow } from '../ports/persistence.ts'
import { createReviewerAccessProbe } from './review-access.ts'
import type { ReadPublishedDependencies } from './read-published.ts'
import { readSource } from './read-published.ts'

/**
 * The facts a document states about itself, as each kind of reader is shown
 * them (`docs/design/properties.md`, ADR-059).
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

/**
 * The shortest query the directory answers. One letter would page through
 * everyone who can view a document in twenty-six requests.
 */
export const MIN_PEOPLE_QUERY = 2

/**
 * How many matches a search looks at before it narrows to those who can view
 * the document, as the reviewer search does (`review.ts`).
 */
const PEOPLE_SCAN = 50

interface DirectoryDependencies {
  readonly uow: UnitOfWork
}

/**
 * The directory answers only for people who can view the document it is
 * asked about: the same question, through the same resolver, as tagging a
 * reviewer asks (`review-access.ts`). Anyone else is never found and never
 * named, so a writer cannot learn of an account outside the people they
 * already share the document with, by search or by guessing an address.
 */
async function whoCanView(
  deps: DirectoryDependencies,
  documentId: DocumentId,
  users: readonly UserRow[],
): Promise<readonly UserRow[]> {
  if (users.length === 0) return []
  const probe = await createReviewerAccessProbe(deps.uow.repos, documentId)
  if (probe === null) return []
  const verdicts = await Promise.all(
    users.map(async (user) => probe.canView({ kind: 'user', id: user.id })),
  )
  return users.filter((_user, index) => verdicts[index] === true)
}

/** The verified people behind these addresses who can view the document, keyed by the address as written. */
export async function namePeople(
  deps: DirectoryDependencies,
  documentId: DocumentId,
  emails: readonly string[],
): Promise<readonly PersonView[]> {
  if (emails.length === 0) return []
  const found = await deps.uow.repos.users.findVerifiedByEmails(emails)
  const visible = await whoCanView(deps, documentId, found)
  const byAddress = new Map(visible.map((user) => [user.email.toLowerCase(), user]))
  return emails.flatMap((value) => {
    const user = byAddress.get(value.toLowerCase())
    return user === undefined ? [] : [{ value, name: user.displayName, detail: user.email }]
  })
}

/** Verified people who can view the document, matched by name or address. */
export async function searchPeople(
  deps: DirectoryDependencies,
  documentId: DocumentId,
  query: string,
): Promise<readonly PersonView[]> {
  const wanted = query.trim()
  if (wanted.length < MIN_PEOPLE_QUERY) return []
  const found = await deps.uow.repos.users.searchVerified(wanted, PEOPLE_SCAN)
  const visible = await whoCanView(deps, documentId, found)
  return visible
    .slice(0, PEOPLE_SEARCH_LIMIT)
    .map((user) => ({ value: user.email, name: user.displayName, detail: user.email }))
}

/**
 * The facts a front matter record states, owners named as people where they
 * are: verified, and able to view the document (`namePeople`).
 */
export async function factsOf(
  deps: DirectoryDependencies,
  documentId: DocumentId,
  frontMatter: Readonly<Record<string, unknown>>,
): Promise<FactsView> {
  const facts = documentFacts(frontMatter)
  const verifier = facts.lifecycle?.state === 'verified' ? facts.lifecycle.verifiedBy : undefined
  // The owners and the verifier in one lookup, never one per person.
  const addresses = [...facts.owners, ...(verifier === undefined ? [] : [verifier])]
  const people = await namePeople(
    deps,
    documentId,
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
