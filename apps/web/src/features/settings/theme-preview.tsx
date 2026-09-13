import { useEffect, useRef } from 'react'

import { tv } from '@quill/ui'

import type { TokenMap } from '@quill/theme'

export const themePreviewStyles = tv({
  slots: {
    root: 'grid gap-4 @2xl:grid-cols-2',
    pane: [
      'flex flex-col gap-3 overflow-hidden rounded-md border border-border bg-background p-4',
      'text-foreground',
    ],
    caption: 'meta text-muted',
    title: 'font-display text-lg font-semibold tracking-tight text-foreground',
    body: 'text-sm leading-relaxed text-foreground',
    link: 'text-accent underline underline-offset-2',
    note: 'border-s-2 border-s-accent bg-surface px-3 py-2 text-xs leading-relaxed text-foreground',
    table: 'w-full border-collapse text-xs',
    cell: 'border-b border-border px-2 py-1.5 text-start text-foreground',
    head: 'border-b border-border-strong px-2 py-1.5 text-start font-mono text-2xs tracking-caps text-muted uppercase',
    code: 'rounded-sm bg-code-background px-3 py-2 font-mono text-2xs text-foreground',
    row: 'flex items-center gap-2',
    button: 'rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground',
    badge: 'rounded-sm bg-accent-subtle px-1.5 py-0.5 text-2xs font-medium text-accent',
    muted: 'text-xs text-muted',
  },
})

interface PaneProps {
  readonly scheme: 'light' | 'dark'
  readonly tokens: TokenMap
}

/**
 * One scheme of the theme being edited, painted with that theme's own
 * generated tokens.
 *
 * The tokens are written onto the pane element as CSS custom properties
 * rather than into a `<style>` element. Two reasons, both of them properties
 * of where this runs: the application's Content-Security-Policy is
 * nonce-based with no `unsafe-inline` (ADR-011), so an injected stylesheet
 * would be the one thing on the page that needs an exception; and a scoped
 * `:root`-shaped block would have to reproduce the resolution order
 * `tokens.css` documents, while a custom property set on an element already
 * cascades to exactly the subtree being previewed and nothing else.
 *
 * The values are not sanitised, and do not need to be. A theme document's
 * `overrides` constrain their *keys* to `TOKEN_NAMES` and leave the values as
 * strings, but a custom property is not a rule: the CSSOM drops anything it
 * cannot parse, and nothing written through `setProperty` on one property can
 * reach another declaration, a selector, or a URL the browser would fetch.
 * The worst a bad value can do is fail to paint.
 *
 * The generated palette is otherwise used verbatim — `generateTheme` produced it,
 * and every value below the pane comes from it through the same semantic
 * utilities the real reading surface uses (`bg-surface`, `text-accent`), so
 * what is shown here is what a document will look like, not an approximation
 * of it.
 */
function ThemePreviewPane({ scheme, tokens }: PaneProps) {
  const paneRef = useRef<HTMLDivElement>(null)
  const styles = themePreviewStyles()

  // Synchronises the pane element's inline custom properties — a DOM
  // property React does not render, exactly as `applyThemeId` writes
  // `data-theme-id` onto the document element — with the generated palette of
  // the theme being edited.
  useEffect(() => {
    const pane = paneRef.current
    if (pane === null) return
    const written = Object.entries(tokens)
    for (const [name, value] of written) {
      pane.style.setProperty(name, value)
    }
    /*
     * Clears exactly what this run wrote, so the next one starts from nothing.
     * `toTokenMap` emits a fixed key set today and nothing would be left
     * behind — but `theme.overrides` and the syntax families make that set
     * data-dependent, and a property this effect stopped emitting would
     * otherwise keep its old value on the element for the life of the page.
     * An effect that only ever adds is not a synchronisation.
     */
    return () => {
      for (const [name] of written) {
        pane.style.removeProperty(name)
      }
    }
  }, [tokens])

  return (
    <div
      ref={paneRef}
      data-scheme={scheme}
      /*
       * `scheme-light` / `scheme-dark` are Tailwind 4's own `color-scheme`
       * utilities (they compile to `color-scheme: light|dark` — check
       * `apps/web/dist/assets/*.css` after a build), so the pane's form
       * controls, scrollbars and `::selection` render in the scheme it is
       * previewing rather than the page's.
       */
      className={styles.pane({
        className: scheme === 'dark' ? 'scheme-dark' : 'scheme-light',
      })}
    >
      <p className={styles.caption()}>{scheme === 'dark' ? 'Dark' : 'Light'}</p>

      <h3 className={styles.title()}>Regional failover</h3>
      <p className={styles.body()}>
        What to do when the primary region stops answering, who to tell, and how to decide whether
        to fail back. Read <span className={styles.link()}>the preconditions</span> first.
      </p>

      <p className={styles.note()}>
        Failover is one-way until the primary is healthy. Promotion changes which region accepts
        writes.
      </p>

      <table className={styles.table()}>
        <caption className="sr-only">Latency budgets by region</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.head()}>
              Region
            </th>
            <th scope="col" className={styles.head()}>
              Budget
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className={styles.cell()}>
              eu-west
            </th>
            <td className={styles.cell()}>180 ms</td>
          </tr>
          <tr>
            <th scope="row" className={styles.cell()}>
              us-east
            </th>
            <td className={styles.cell()}>210 ms</td>
          </tr>
        </tbody>
      </table>

      <pre className={styles.code()}>failover promote --region eu-west</pre>

      <div className={styles.row()}>
        <span className={styles.button()}>Publish</span>
        <span className={styles.badge()}>Runbook</span>
        <span className={styles.muted()}>Updated 12 September</span>
      </div>
    </div>
  )
}

export interface ThemePreviewProps {
  readonly light: TokenMap
  readonly dark: TokenMap
}

/**
 * ADR-028's onboarding step 3, as a settings pane: the theme being edited
 * shown "on a real document, not swatches", in light and dark at once.
 *
 * Both schemes are on screen together rather than behind a toggle, because
 * the question an administrator is actually asking is whether their accent
 * works in *both*, and a toggle makes that a memory test.
 */
export function ThemePreview({ light, dark }: ThemePreviewProps) {
  const styles = themePreviewStyles()

  return (
    <div className="@container">
      <div className={styles.root()} aria-label="Theme preview" role="group">
        <ThemePreviewPane scheme="light" tokens={light} />
        <ThemePreviewPane scheme="dark" tokens={dark} />
      </div>
    </div>
  )
}
