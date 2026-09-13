import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * How a page contributes to the shell it renders inside.
 *
 * The workspace shell (`workspace-layout.tsx`) is rendered once and never
 * unmounts, so a page cannot pass it props. It renders into it instead: the
 * layout keeps one container element per slot and hands them down here, and a
 * page renders a portal into the one it wants. Both sides render in the *same*
 * commit, so switching from one document to the next replaces the contents of
 * the header and the aside without a frame of emptiness in between — which an
 * effect that copied the page's props up into layout state would not manage.
 *
 * The containers are held in the layout's state and set by a callback ref, so
 * they exist from the layout's first paint and keep their identity for the
 * life of the workspace.
 */
export interface ShellSlotNodes {
  /** The end of the header bar, before the theme toggle and the account menu. */
  readonly actions: HTMLElement | null
  /** The complementary column beside the document: revisions, contents, health. */
  readonly aside: HTMLElement | null
}

const ShellSlotsContext = createContext<ShellSlotNodes>({ actions: null, aside: null })

export function ShellSlotsProvider({
  nodes,
  children,
}: {
  readonly nodes: ShellSlotNodes
  readonly children: ReactNode
}) {
  return <ShellSlotsContext value={nodes}>{children}</ShellSlotsContext>
}

/** The slot containers the surrounding shell offers. Empty outside one. */
export function useShellSlots(): ShellSlotNodes {
  return useContext(ShellSlotsContext)
}

/** Puts this page's controls at the end of the shell's header bar. */
export function ShellActions({ children }: { readonly children: ReactNode }) {
  const { actions } = useShellSlots()
  return actions === null ? undefined : createPortal(children, actions)
}

/** Puts this page's complementary column into the shell's aside. */
export function ShellAside({ children }: { readonly children: ReactNode }) {
  const { aside } = useShellSlots()
  return aside === null ? undefined : createPortal(children, aside)
}
