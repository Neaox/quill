import type { NestedListItem } from '@quill/ui'
import { createContext, useContext } from 'react'

/**
 * The documents beneath the one being written, as the application knows them.
 *
 * The editor makes no requests of its own, so the child-documents block cannot
 * go and find its list: the application hands it over, the same way it hands over
 * everything else the editor cannot invent. It travels by context because the
 * block is drawn deep inside the editor's own tree, by TipTap, where no prop of
 * `DocumentEditor` can reach. `undefined` means the application supplied none, as
 * opposed to an empty list, which means this document has no children.
 */

const ChildDocumentsContext = createContext<readonly NestedListItem[] | undefined>(undefined)

export const ChildDocumentsProvider = ChildDocumentsContext.Provider

export function useChildDocuments(): readonly NestedListItem[] | undefined {
  return useContext(ChildDocumentsContext)
}
