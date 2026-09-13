import { buttonClassName } from '@quill/ui'

import { oidcStartPath, useOidcProviders } from '../../lib/api/index.ts'

export interface SignInProvidersProps {
  /** The page that was being asked for, carried through the round trip. */
  readonly redirect: string | undefined
}

/**
 * "Continue with Microsoft", and its siblings (ADR-011's home-realm
 * discovery, first version).
 *
 * Each one is an **anchor**, not a button: the browser has to leave for the
 * provider and come back carrying a cookie, which is a top-level navigation,
 * and a `fetch` could never do it. `buttonClassName` is the design system's
 * supported way to borrow the button's appearance for a link
 * (`packages/ui/src/components/button.tsx`), so these stay in step with every
 * other button without becoming one.
 *
 * They render above the password form because the organisation's provider is
 * the primary route in for the people who have one, and nothing at all is
 * rendered when the instance has no providers — which is most instances.
 */
export function SignInProviders({ redirect }: SignInProvidersProps) {
  const providers = useOidcProviders()
  const list = providers.data?.providers ?? []
  if (list.length === 0) return undefined

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {list.map((provider) => (
          <li key={provider.id}>
            <a
              href={oidcStartPath(provider.id, redirect)}
              className={buttonClassName({ variant: 'secondary', size: 'lg', className: 'w-full' })}
            >
              Continue with {provider.displayName}
            </a>
          </li>
        ))}
      </ul>
      {/*
        A labelled separator rather than a bare rule: the word is the
        information, and a rule alone would carry it by presentation only
        (AGENTS.md rule 14). `aria-hidden` on the lines keeps the label from
        being read twice.
      */}
      <p className="flex items-center gap-3 text-xs text-muted">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        or sign in with your email
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </p>
    </div>
  )
}
