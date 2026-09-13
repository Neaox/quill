import { Button, tv } from '@quill/ui'

import { useMe, useSignOut } from '../../lib/api/index.ts'

export const signedInHeaderStyles = tv({
  slots: {
    root: 'flex items-center gap-3',
    name: 'max-w-40 truncate text-sm font-medium text-foreground',
  },
  variants: {
    /*
     * A bar that is competing for room gives the name up at phone widths:
     * in the document shell's 40px bar the document's own path needs every
     * pixel, and the sign-out control still says whose session this is.
     * A header with room for it never does — the signed-in home's whole
     * subject is the person (`docs/design/home.md`), so a phone that cannot
     * say who is signed in has lost the point of the page.
     */
    compact: { true: { name: 'hidden sm:block' } },
  },
})

export interface SignedInHeaderProps {
  /** True in the document shell's bar, where the path comes first on a phone. */
  readonly compact?: boolean
}

/**
 * The signed-in identity slot for a header: the person's name and a sign-out
 * action. Rendered only inside the authenticated layout, where `me` is already
 * loaded by the route's `beforeLoad`, so this never has to render a loading
 * state of its own.
 */
export function SignedInHeader({ compact = false }: SignedInHeaderProps) {
  const me = useMe()
  const signOut = useSignOut()
  const styles = signedInHeaderStyles({ compact })

  if (me.data === undefined) return undefined

  return (
    <div className={styles.root()}>
      <span className={styles.name()}>{me.data.displayName}</span>
      <Button
        variant="ghost"
        size="sm"
        loading={signOut.isPending}
        onClick={() => {
          signOut.mutate()
        }}
      >
        Sign out
      </Button>
    </div>
  )
}
