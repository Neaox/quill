import { Button, Input, tv } from '@quill/ui'

import type { PublicNavigationLink } from '../../lib/api/index.ts'

/**
 * The links beside the site name on the public site (ADR-034).
 *
 * `href` is validated here against the **same** pattern the server's schema
 * carries, and for the same reason: these links are rendered into a page
 * nobody has to sign in to reach, so the set of schemes is a whitelist. A
 * rooted path, or an absolute `http(s)` address. Not `javascript:`, not
 * `data:` — script in a tenant's navigation bar is stored XSS — and not
 * protocol-relative `//host`, which reads as a path and is not one.
 *
 * The client check is a courtesy, never the guard: the server refuses the
 * same values with `422 invalid_settings`, which is what actually protects
 * the public site. What it buys is that the reason arrives beside the field
 * that caused it, while the person is still looking at it.
 */

/** `NAVIGATION_HREF_PATTERN` in `@quill/application`'s settings documents. */
const HREF_PATTERN = /^(?:\/(?!\/)\S*|https?:\/\/\S+)$/

export const MAX_PUBLIC_NAVIGATION_LINKS = 8
const MAX_LABEL_LENGTH = 60
const MAX_HREF_LENGTH = 2000

export function navigationHrefError(href: string): string | undefined {
  if (href.trim() === '') return 'Give the link an address.'
  if (href.length > MAX_HREF_LENGTH) return 'That address is too long.'
  if (!HREF_PATTERN.test(href)) {
    return 'Use a path on this site, such as /handbook, or a full https:// address.'
  }
  return undefined
}

export function navigationLabelError(label: string): string | undefined {
  if (label.trim() === '') return 'Give the link a name.'
  if (label.length > MAX_LABEL_LENGTH) return 'That name is too long.'
  return undefined
}

/** True when every link in the list is one the server will accept. */
export function publicNavigationIsValid(links: readonly PublicNavigationLink[]): boolean {
  return links.every(
    (link) =>
      navigationLabelError(link.label) === undefined &&
      navigationHrefError(link.href) === undefined,
  )
}

const editorStyles = tv({
  slots: {
    list: 'flex flex-col gap-3',
    row: 'flex flex-col gap-2 rounded-md border border-border p-3 @lg:flex-row @lg:items-start',
    fields: 'grid grow gap-2 @lg:grid-cols-2',
    controls: 'flex shrink-0 items-center gap-1 @lg:mt-4.5',
    empty: 'text-sm text-muted',
  },
})

export interface PublicNavigationEditorProps {
  readonly links: readonly PublicNavigationLink[]
  readonly onLinksChange: (links: readonly PublicNavigationLink[]) => void
}

/**
 * Add, edit, reorder and remove the public navigation.
 *
 * Reordering is two buttons per row rather than a drag handle: order matters
 * and has to be changeable from the keyboard, a list of at most eight rows is
 * not worth a drag-and-drop implementation, and the buttons are the same
 * affordance for a pointer, a keyboard and a screen reader. Each button names
 * the link it moves, so "Move Handbook up" is what is announced rather than
 * eight identical "Move up"s.
 */
export function PublicNavigationEditor({ links, onLinksChange }: PublicNavigationEditorProps) {
  const styles = editorStyles()

  function replace(index: number, link: PublicNavigationLink) {
    onLinksChange(links.map((existing, at) => (at === index ? link : existing)))
  }

  function remove(index: number) {
    onLinksChange(links.filter((_, at) => at !== index))
  }

  function move(index: number, to: number) {
    if (to < 0 || to >= links.length) return
    const reordered = [...links]
    const [moved] = reordered.splice(index, 1)
    if (moved === undefined) return
    reordered.splice(to, 0, moved)
    onLinksChange(reordered)
  }

  return (
    <div className="@container flex flex-col gap-3">
      {links.length === 0 ? (
        <p className={styles.empty()}>
          No links yet. The public site shows the organisation’s name on its own.
        </p>
      ) : (
        <ol aria-label="Public navigation links" className={styles.list()}>
          {links.map((link, index) => (
            // The position *is* the identity: a link has no id, order is part
            // of what is being edited, and two rows may legitimately share a
            // label while one is being typed.
            <li key={index} className={styles.row()}>
              <div className={styles.fields()}>
                <Input
                  label="Name"
                  value={link.label}
                  maxLength={MAX_LABEL_LENGTH}
                  {...fieldError(navigationLabelError(link.label))}
                  onChange={(event) => {
                    replace(index, { ...link, label: event.target.value })
                  }}
                />
                <Input
                  label="Address"
                  value={link.href}
                  inputMode="url"
                  placeholder="/handbook"
                  {...fieldError(navigationHrefError(link.href))}
                  onChange={(event) => {
                    replace(index, { ...link, href: event.target.value })
                  }}
                />
              </div>
              <div className={styles.controls()}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  aria-label={`Move ${link.label || 'this link'} up`}
                  onClick={() => {
                    move(index, index - 1)
                  }}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index === links.length - 1}
                  aria-label={`Move ${link.label || 'this link'} down`}
                  onClick={() => {
                    move(index, index + 1)
                  }}
                >
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${link.label || 'this link'}`}
                  onClick={() => {
                    remove(index)
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={links.length >= MAX_PUBLIC_NAVIGATION_LINKS}
          onClick={() => {
            onLinksChange([...links, { label: '', href: '' }])
          }}
        >
          Add a link
        </Button>
        {links.length >= MAX_PUBLIC_NAVIGATION_LINKS ? (
          <p className="mt-1.5 text-xs text-muted">
            Eight is the most the public site’s header holds.
          </p>
        ) : undefined}
      </div>
    </div>
  )
}

/** `error` is omitted rather than passed as `undefined`: its presence is what marks a field invalid. */
function fieldError(message: string | undefined): { readonly error?: string } {
  return message === undefined ? {} : { error: message }
}
