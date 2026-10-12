import { useCallback, useState } from 'react'

import { Combobox, type ListboxGroup } from '@quill/ui'

import {
  queryTooLong,
  useCollectionCandidates,
  useSearch,
  type PublicMenuLink,
} from '../../../lib/api/index.ts'
import { SearchHitDetail } from '../../search/search-hit.tsx'
import { useDebouncedValue } from '../../search/use-debounced-value.ts'
import { labelForAddress, looksLikeAddress, urlError } from './menu-model.ts'

/** The pause between the last keystroke and the search, as the palette uses. */
const DEBOUNCE_MS = 180

/** How many documents the picker offers at once; collections are capped by their own route. */
const DOCUMENT_LIMIT = 6

const ADDRESS_OPTION = 'address'
const documentOption = (id: string) => `document:${id}`
const collectionOption = (id: string) => `collection:${id}`

export interface MenuTargetPickerProps {
  /** The field's visible label: "Add a link", "Link to". */
  readonly label: string
  readonly onPick: (link: PublicMenuLink) => void
  /** Escape on a closed popup: the caller closes the picker. */
  readonly onDismiss?: (() => void) | undefined
  /**
   * Takes focus when it appears: it was opened by a button whose whole
   * purpose was to start typing here, so focus follows the person's intent.
   */
  readonly focusOnMount?: boolean | undefined
}

/**
 * What a menu link points at, chosen by typing: a document or a collection in
 * any of the organisation's workspaces, or an address.
 *
 * Documents come from the product's own search (`GET /search`, the palette's
 * request), collections from the menu's candidates route, and each result
 * says which workspace and collection it is in, because two "Overview"s are
 * otherwise one choice. Typing something that starts like an address —
 * `https://`, or a `/` for a path on this site — offers it as an address
 * instead, checked against the same rule the server holds it to.
 *
 * Keyboard first: it is the design system's `Combobox`, so the arrows walk
 * the results without leaving the field and Enter chooses.
 */
export function MenuTargetPicker({
  label,
  onPick,
  onDismiss,
  focusOnMount = false,
}: MenuTargetPickerProps) {
  const [query, setQuery] = useState('')
  // A stable callback, so React calls it once, when the field is attached.
  const focusField = useCallback((field: HTMLInputElement | null) => {
    field?.focus()
  }, [])
  const debounced = useDebouncedValue(query.trim(), DEBOUNCE_MS)
  const address = looksLikeAddress(query)
  const searching = !address && debounced !== '' && !queryTooLong(debounced)

  const documents = useSearch({
    query: searching ? debounced : '',
    workspaceId: null,
    limit: DOCUMENT_LIMIT,
  })
  const collections = useCollectionCandidates(searching ? debounced : '')

  const hits = searching
    ? [
        ...(documents.data?.current ?? []),
        ...(documents.data?.elsewhere ?? []).flatMap((group) => group.hits),
      ]
    : []
  const candidates = searching ? (collections.data ?? []) : []
  const addressProblem = address ? urlError(query.trim()) : undefined

  const groups: ListboxGroup[] = []
  if (address && addressProblem === undefined) {
    groups.push({
      id: 'address',
      label: 'Address',
      options: [{ id: ADDRESS_OPTION, label: query.trim(), detail: 'Link to this address' }],
    })
  }
  if (hits.length > 0) {
    groups.push({
      id: 'documents',
      label: 'Documents',
      options: hits.map((hit) => ({
        id: documentOption(hit.documentId),
        label: hit.title,
        detail: <SearchHitDetail hit={hit} />,
      })),
    })
  }
  if (candidates.length > 0) {
    groups.push({
      id: 'collections',
      label: 'Collections',
      options: candidates.map((candidate) => ({
        id: collectionOption(candidate.id),
        label: candidate.name,
        detail: `${candidate.workspaceName} · ${candidate.isPublic ? 'Published to the web' : 'Not published'}`,
      })),
    })
  }

  const settling =
    searching && (documents.isFetching || collections.isFetching || debounced !== query.trim())
  const count = hits.length + candidates.length

  const notice = pickerNotice({
    typed: query.trim(),
    searched: debounced,
    addressProblem,
    failed: documents.isError || collections.isError,
    settled: !settling,
    searching,
    count,
  })

  function pick(optionId: string): void {
    if (optionId === ADDRESS_OPTION) {
      const href = query.trim()
      onPick({ kind: 'url', href, label: labelForAddress(href) })
    } else {
      const [kind, id] = optionId.split(':')
      if (id === undefined) return
      onPick(kind === 'collection' ? { kind: 'collection', id } : { kind: 'document', id })
    }
    setQuery('')
  }

  return (
    <Combobox
      label={label}
      value={query}
      onValueChange={setQuery}
      placeholder="Search, or paste https://…"
      groups={groups}
      onSelect={pick}
      busy={settling}
      notice={notice}
      status={searching && !settling ? `${count} ${count === 1 ? 'result' : 'results'}` : undefined}
      onDismiss={onDismiss}
      inputRef={focusOnMount ? focusField : undefined}
    />
  )
}

interface PickerState {
  readonly typed: string
  readonly searched: string
  readonly addressProblem: string | undefined
  readonly failed: boolean
  readonly settled: boolean
  readonly searching: boolean
  readonly count: number
}

/**
 * What the popup says when it has no options to show, or nothing at all when
 * the options speak for themselves — so an open popup is never an empty box,
 * and a search that found nothing says so rather than looking unfinished.
 */
function pickerNotice(state: PickerState): string | undefined {
  if (state.typed === '') {
    return 'Search documents and collections in every workspace, or paste an https:// address.'
  }
  if (state.addressProblem !== undefined) return state.addressProblem
  if (state.failed) return 'Search is not answering. Try again in a moment, or paste an address.'
  if (!state.searching || state.count > 0) return undefined
  return state.settled
    ? `Nothing matches “${state.searched}”. Try other words, or paste an address.`
    : 'Searching…'
}
