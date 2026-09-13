import { useParams } from '@tanstack/react-router'
import {
  Suspense,
  createContext,
  lazy,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { ProgressBar } from '@quill/ui'

/**
 * Who owns the search dialog, and why it is here rather than in the workspace
 * shell.
 *
 * The palette opens from anywhere somebody is signed in — the workspace shell,
 * the home page, the organisation page — so it is mounted by the authenticated
 * layout route, which is the one thing above all three. The top bars render a
 * `SearchField` that asks this to open; nothing else knows the dialog exists.
 *
 * **The dialog itself is loaded on demand.** `import()` here is what keeps the
 * palette, its query, and everything it renders out of the reading route's
 * bundle (quill-plan.md §31): what the shell pays for is the trigger and this
 * provider. The chunk is fetched on hover or focus of the field, the same
 * "preload on intent" the router's links use, so by the time a click or
 * Ctrl+K lands the wait is usually already over.
 */

const load = () => import('./search-dialog.tsx')

const SearchDialog = lazy(async () => ({ default: (await load()).SearchDialog }))

/** Fetches the palette's chunk before anybody asks for it. Safe to call repeatedly. */
export function preloadSearchDialog(): void {
  void load()
}

export interface SearchDialogControls {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
}

const SearchDialogContext = createContext<SearchDialogControls | undefined>(undefined)

/**
 * The controls for the search dialog, or `undefined` outside the provider.
 *
 * Undefined rather than a no-op pair on purpose: a trigger with nothing to
 * open is not rendered at all, rather than rendered inert
 * (`docs/design/feedback.md`).
 */
export function useSearchDialog(): SearchDialogControls | undefined {
  return useContext(SearchDialogContext)
}

/**
 * Mounts the palette, unless something above already has.
 *
 * Two places provide it, because the signed-in world has two roots: the
 * authenticated layout route, which covers every workspace and the
 * organisation page, and `AppPage`, because the home page deliberately sits
 * *outside* that layout — it redirects a signed-out visit with no return path,
 * so it checks the session itself (`routes/index.tsx`). The organisation page
 * is inside both, which is what this guard is for: a second host there would
 * mean two dialogs answering one Ctrl+K.
 */
export function SearchProvider({ children }: { readonly children: ReactNode }) {
  const existing = useSearchDialog()
  return existing === undefined ? <SearchHost>{children}</SearchHost> : children
}

function SearchHost({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false)
  // The palette prefers the workspace somebody is in, and is happy without one
  // (quill-plan.md §15). `strict: false` because this route sits above the
  // workspace shell and the parameter is only there some of the time.
  const { workspaceSlug } = useParams({ strict: false })

  /*
   * Subscribes to the window's keydown stream — an external system — so the
   * palette answers Ctrl+K and Cmd+K from wherever focus happens to be, which
   * is the whole point of the shortcut.
   *
   * `defaultPrevented` is the one thing that stops it, and it is the platform's
   * own answer to "an input that uses this combination itself": a control that
   * has already handled the key has called `preventDefault` on the way here,
   * and this leaves it alone. Nothing has to be registered anywhere for that to
   * work. The browser's own Ctrl+K — Firefox's search bar — is what the
   * `preventDefault` below overrides, which is what people expect of an
   * application that offers the shortcut.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // `code` is the physical key, so the shortcut survives a layout on
      // which `key` is not a Latin letter at all; `key` is still accepted
      // because a remapped layout may put K somewhere else entirely.
      if (event.code !== 'KeyK' && event.key !== 'k' && event.key !== 'K') return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.defaultPrevented) return
      event.preventDefault()
      setOpen((wasOpen) => !wasOpen)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // A stable pair, so every signed-in page below does not re-render because
  // this one rendered.
  const controls = useMemo(() => ({ open, setOpen }), [open])

  return (
    <SearchDialogContext value={controls}>
      {children}
      {open ? (
        <Suspense fallback={<ProgressBar placement="top" label="Opening search" />}>
          <SearchDialog
            open
            onOpenChange={setOpen}
            {...(workspaceSlug === undefined ? {} : { workspaceSlug })}
          />
        </Suspense>
      ) : undefined}
    </SearchDialogContext>
  )
}
