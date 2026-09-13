import { Link } from '@tanstack/react-router'

import { Callout, textLinkClassName, tv } from '@quill/ui'

export const routeNoticeStyles = tv({
  slots: {
    root: 'mx-auto flex w-full max-w-lg flex-col gap-3',
  },
  variants: {
    /**
     * A notice for a route that has no shell around it (the workspace layout's
     * own failure) fills the viewport; one for a child route sits in the
     * shell's main column, where the sidebar and the header are still there to
     * go somewhere else with.
     */
    full: {
      true: { root: 'min-h-dvh items-center justify-center p-6' },
      false: { root: 'px-8 py-10' },
    },
  },
  defaultVariants: { full: false },
})

export interface RouteNoticeProps {
  readonly title: string
  readonly body: string
  readonly full?: boolean
}

/**
 * What a route says when it cannot show what was asked for: a 404, or a load
 * that failed. Always a way onwards — the home page, which every account can
 * reach — never a blank page and never a raw error.
 */
export function RouteNotice({ title, body, full = false }: RouteNoticeProps) {
  const styles = routeNoticeStyles({ full })

  return (
    <div className={styles.root()}>
      <Callout tone="info" title={title}>
        {body}
      </Callout>
      <p className="text-xs text-muted">
        <Link to="/" className={textLinkClassName()}>
          Go to your workspaces
        </Link>
      </p>
    </div>
  )
}
