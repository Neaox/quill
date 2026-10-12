import type { ReactNode } from 'react'

import { tv } from '@quill/ui'

import { AuthLayout } from './auth-layout.tsx'

const authCard = tv({
  slots: {
    title: 'text-2xl leading-tight font-semibold tracking-tight text-balance text-foreground',
    description: 'mt-2 text-sm leading-relaxed text-pretty text-muted',
    body: 'mt-8 flex flex-col gap-5',
    footer: 'mt-8 border-t border-border pt-6 text-sm text-muted',
  },
})

export interface AuthCardProps {
  readonly title: string
  readonly description?: string
  readonly children: ReactNode
  readonly footer?: ReactNode
}

/**
 * One step of the signed-out flow: its heading, a line saying what it needs,
 * the form or the outcome, and the way to the neighbouring step under a
 * hairline. Every sign-in, sign-up, magic-link, password-reset, and
 * verification screen is built from this, standing on `AuthLayout`, so they
 * read as one flow rather than six pages that happen to be next to each other
 * (AGENTS.md rule 16: reusable components, not one-off markup).
 *
 * The step sits on the paper rather than in a raised card: it is the only
 * thing in its column, so a box around it would add an edge and say nothing.
 */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  const styles = authCard()
  return (
    <AuthLayout>
      <h1 className={styles.title()}>{title}</h1>
      {description === undefined ? undefined : (
        <p className={styles.description()}>{description}</p>
      )}
      <div className={styles.body()}>{children}</div>
      {footer === undefined ? undefined : <p className={styles.footer()}>{footer}</p>}
    </AuthLayout>
  )
}
