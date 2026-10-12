import { ChevronDownIcon, SearchIcon, tv } from '@quill/ui'

import type { PublicMenu, PublicMenuLink, PublicMenuTarget } from '../../../lib/api/index.ts'
import { displayLabel } from './menu-model.ts'

/**
 * The header as a reader will see it, drawn live from the draft.
 *
 * It shows what the public site would render — `resolvePublicMenu`'s rules,
 * applied to the editor's own look-ups: an address link always, a document or
 * collection only while it is on the web, and a dropdown only while something
 * in it is — and says how many links are being left out and why, so a link
 * that silently vanished from the real header is never a surprise. Dropdowns
 * open on click like the real ones, which are `details` as well.
 *
 * It is a picture of the header, not the header: the real one is rendered by
 * the server (`apps/server/src/public-site/templates/header-menu.ts`) in the
 * organisation's own theme, and the reader preview shows it on a real page.
 */

export const menuPreviewStyles = tv({
  slots: {
    frame: 'overflow-hidden rounded-lg border border-border bg-background shadow-raised',
    bar: 'flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2',
    lockup: 'flex items-center gap-2 text-sm font-semibold text-foreground',
    mark: 'grid size-5 place-items-center rounded-sm bg-accent text-2xs text-accent-foreground',
    edition: 'font-medium text-muted',
    list: 'flex flex-wrap items-center gap-0.5',
    link: [
      'flex h-8 cursor-default items-center gap-1 rounded-md px-2.5 text-xs font-medium',
      'text-foreground-soft hover:bg-surface hover:text-foreground',
    ],
    dropdown: 'relative',
    trigger: 'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
    panel: [
      'absolute top-full left-0 z-10 mt-1.5 flex min-w-48 flex-col gap-px rounded-lg border',
      'border-border bg-surface-raised p-1 shadow-raised',
    ],
    panelLink: 'rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground-soft',
    search: [
      'ms-auto flex h-8 w-44 items-center gap-2 rounded-md bg-surface px-2.5 text-xs text-muted',
    ],
    body: 'flex flex-col gap-2 px-4 py-5',
    line: 'h-2 rounded-full bg-surface',
    footnote: 'border-t border-border px-4 py-2 text-2xs text-muted',
  },
})

export interface MenuPreviewProps {
  readonly menu: PublicMenu
  readonly targets: ReadonlyMap<string, PublicMenuTarget>
  readonly siteName: string
}

/** A link as the header would show it, or null when the header leaves it out. */
function shownLabel(link: PublicMenuLink, targets: MenuPreviewProps['targets']): string | null {
  if (link.kind === 'url') return link.label === '' ? null : link.label
  const target = targets.get(link.id)
  return target?.status === 'public' ? displayLabel(link, target) : null
}

/** One item of the previewed header, before it is keyed. */
type PreviewEntry =
  | { readonly kind: 'link'; readonly label: string }
  | {
      readonly kind: 'group'
      readonly label: string
      readonly links: readonly { readonly key: string; readonly label: string }[]
    }

type PreviewItem = PreviewEntry & { readonly key: string }

/** Keys from what each entry says, numbered where two say the same thing. */
function keyed<T>(
  entries: readonly T[],
  say: (entry: T) => string,
): readonly (T & { key: string })[] {
  const seen = new Map<string, number>()
  return entries.map((entry) => {
    const words = say(entry)
    const count = (seen.get(words) ?? 0) + 1
    seen.set(words, count)
    return { ...entry, key: `${words}#${count}` }
  })
}

/** Why the header leaves a link out. */
type HiddenReason = 'not-public' | 'missing'

/** A link the header leaves out, by name, and why. */
interface HiddenLink {
  readonly name: string
  readonly reason: HiddenReason
}

/** The header the draft would render, and the links it leaves out. */
export function previewOf(
  menu: PublicMenu,
  targets: MenuPreviewProps['targets'],
): { readonly items: readonly PreviewItem[]; readonly hidden: readonly HiddenLink[] } {
  const links = menu.flatMap((item) => (item.kind === 'group' ? item.items : [item]))
  const hidden = links.flatMap((link): HiddenLink[] => {
    if (link.kind === 'url') return []
    const target = targets.get(link.id)
    if (target === undefined || target.status === 'public') return []
    const name =
      displayLabel(link, target) ??
      `A deleted ${link.kind === 'collection' ? 'collection' : 'document'}`
    return [{ name, reason: target.status }]
  })
  const items = menu.flatMap((item): PreviewEntry[] => {
    if (item.kind !== 'group') {
      const label = shownLabel(item, targets)
      return label === null ? [] : [{ kind: 'link', label }]
    }
    const shown = item.items.flatMap((link) => {
      const label = shownLabel(link, targets)
      return label === null ? [] : [{ label }]
    })
    return shown.length === 0 || item.label === ''
      ? []
      : [{ kind: 'group', label: item.label, links: keyed(shown, (link) => link.label) }]
  })
  return { items: keyed(items, (item) => `${item.kind}:${item.label}`), hidden }
}

const names = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })

/**
 * One sentence per reason, naming the links: "Templates isn’t shown: it’s
 * not on the web." Named, because "one link is left out" sends somebody
 * looking for which.
 */
export function hiddenSentences(hidden: readonly HiddenLink[]): readonly string[] {
  const because: Record<HiddenReason, readonly [string, string]> = {
    'not-public': ['it’s not on the web', 'they’re not on the web'],
    missing: ['it no longer exists', 'they no longer exist'],
  }
  return (['not-public', 'missing'] as const).flatMap((reason) => {
    const named = hidden.filter((link) => link.reason === reason).map((link) => link.name)
    if (named.length === 0) return []
    const one = named.length === 1
    const [single, plural] = because[reason]
    return [`${names.format(named)} ${one ? 'isn’t' : 'aren’t'} shown: ${one ? single : plural}.`]
  })
}

export function MenuPreview({ menu, targets, siteName }: MenuPreviewProps) {
  const styles = menuPreviewStyles()
  const { items, hidden } = previewOf(menu, targets)

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className={styles.frame()}>
        <div className={styles.bar()}>
          <span className={styles.lockup()}>
            <span aria-hidden="true" className={styles.mark()}>
              {siteName.trim().charAt(0).toLocaleUpperCase()}
            </span>
            <span>
              {siteName} <span className={styles.edition()}>docs</span>
            </span>
          </span>
          {items.length === 0 ? undefined : (
            <ul aria-label="Header menu" className={styles.list()}>
              {items.map((item) =>
                item.kind === 'link' ? (
                  <li key={item.key}>
                    <span className={styles.link()}>{item.label}</span>
                  </li>
                ) : (
                  <li key={item.key}>
                    <details className={styles.dropdown()}>
                      <summary className={styles.link({ className: styles.trigger() })}>
                        {item.label}
                        <ChevronDownIcon className="size-3" />
                      </summary>
                      <ul className={styles.panel()}>
                        {item.links.map((link) => (
                          <li key={link.key} className={styles.panelLink()}>
                            {link.label}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ),
              )}
            </ul>
          )}
          <span aria-hidden="true" className={styles.search()}>
            <SearchIcon className="size-3.5" />
            Search
          </span>
        </div>
        <div aria-hidden="true" className={styles.body()}>
          <span className={styles.line({ className: 'w-2/5' })} />
          <span className={styles.line({ className: 'w-4/5' })} />
          <span className={styles.line({ className: 'w-3/5' })} />
        </div>
        {hidden.length === 0 ? undefined : (
          <p className={styles.footnote()}>{hiddenSentences(hidden).join(' ')}</p>
        )}
      </div>
      <figcaption className="text-2xs text-muted">
        How the header will look. Narrow screens fold it behind a Menu button.
      </figcaption>
    </figure>
  )
}
