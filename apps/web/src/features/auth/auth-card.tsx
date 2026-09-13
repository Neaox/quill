import type { ReactNode } from 'react'

import { BRAND } from '@quill/brand'

export interface AuthCardProps {
  readonly title: string
  readonly description?: string
  readonly children: ReactNode
  readonly footer?: ReactNode
}

/**
 * The shared frame every auth screen sits in: centred, one heading, one
 * task. Every sign-in, sign-up, magic-link, password-reset, and
 * verification screen is built from this so the six of them read as one
 * flow rather than six different pages that happen to be next to each
 * other (rule 15: reusable components, not one-off markup).
 */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-semibold tracking-tight text-muted">
          {BRAND.name}
        </p>
        <main className="rounded-xl border border-border bg-surface-raised p-6 shadow-raised">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
          {description === undefined ? undefined : (
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{description}</p>
          )}
          <div className="mt-6 flex flex-col gap-4">{children}</div>
        </main>
        {footer === undefined ? undefined : (
          <p className="mt-6 text-center text-sm text-muted">{footer}</p>
        )}
      </div>
    </div>
  )
}
