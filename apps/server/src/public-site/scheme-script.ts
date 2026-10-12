import type { Hasher } from '@quill/application'

import { PUBLIC_ASSET_PREFIX } from './stylesheet.ts'

/**
 * The public site's one script: the reader's colour scheme (ADR-028 gives the
 * scheme to the reader, and no tenant setting may take it away).
 *
 * **What it does.** In `<head>`, before anything is drawn, it applies a
 * remembered Light or Dark as `data-theme` on the document element, which the
 * generated theme already answers (`@quill/theme`'s `toCss`). System is the
 * *absence* of the attribute, so the stylesheet's `prefers-color-scheme` rules
 * stay in charge and follow the operating system live with no listener. Once
 * the page has parsed it wires the System / Light / Dark switch, reveals it —
 * the switch is `hidden` in the markup, so without scripts there is no dead
 * control and the page simply follows the system — follows a choice made in
 * another tab, folds the document list on a narrow screen, and gives the
 * header menu's dropdowns the keyboard and pointer behaviour a disclosure in
 * a bar is expected to have (`templates/header-menu.ts`).
 *
 * **Why an external file rather than an inline script.** The CSP is strict
 * (ADR-011): an inline script needs a nonce, and a nonce is minted per
 * response. A public page is answered with an `ETag` and revalidated with a
 * `304`, and a `304` updates the stored headers — so a revalidated page would
 * pair a fresh nonce in the header with the old one in the cached body, and
 * the script would be refused exactly when the cache was working. A
 * same-origin file is admitted by `script-src 'self'`, needs no nonce, and is
 * addressed by its own hash and served `immutable`, like the stylesheet: it
 * blocks the first paint once, from the network, and from then on from the
 * cache, which is what "before first paint" needs.
 *
 * **The storage key is the application's** (`THEME_STORAGE_KEY` in
 * `@quill/ui`, which the server may not import), so a member's choice in the
 * app follows them onto their organisation's public site on the same origin.
 * Every storage access is wrapped: site data can be blocked, and a preference
 * that cannot be remembered must still apply to the page in front of them.
 */

export const SCHEME_STORAGE_KEY = 'theme-preference'

/**
 * How a member asked for animated images to play (ADR-047), mirrored by the
 * application under this key (`ANIMATED_IMAGES_STORAGE_KEY` in `@quill/ui`,
 * restated for the same reason as the scheme's). The script puts it on the
 * document element as `data-animated-images`, where the image enhancer reads
 * it; only the three values the application writes are ever applied, and an
 * absent attribute means the default, `brief`.
 */
export const ANIMATED_IMAGES_STORAGE_KEY = 'animated-images-preference'

/** The narrow-screen breakpoint, the same `60rem` `public-site.css` folds the columns at. */
const NARROW = '(width < 60rem)'

export const SCHEME_SCRIPT = `(() => {
  const KEY = '${SCHEME_STORAGE_KEY}'
  const CHOICES = ['system', 'light', 'dark']
  const root = document.documentElement
  const read = () => {
    try {
      const stored = localStorage.getItem(KEY)
      return CHOICES.includes(stored) ? stored : 'system'
    } catch {
      return 'system'
    }
  }
  const apply = (choice) => {
    if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice)
    else root.removeAttribute('data-theme')
  }
  apply(read())

  try {
    const motion = localStorage.getItem('${ANIMATED_IMAGES_STORAGE_KEY}')
    if (['brief', 'hover', 'never'].includes(motion)) {
      root.setAttribute('data-animated-images', motion)
    }
  } catch {}

  const wire = () => {
    const inputs = [...document.querySelectorAll('input[name="site-scheme"]')]
    const show = (choice) => {
      for (const input of inputs) input.checked = input.value === choice
    }
    show(read())
    for (const input of inputs) {
      input.addEventListener('change', () => {
        if (!CHOICES.includes(input.value)) return
        try {
          localStorage.setItem(KEY, input.value)
        } catch {}
        apply(input.value)
      })
    }
    addEventListener('storage', (event) => {
      if (event.key !== KEY) return
      const choice = read()
      apply(choice)
      show(choice)
    })
    const control = document.querySelector('.site-scheme')
    if (control !== null) control.hidden = false

    // The header menu's dropdowns and its narrow-screen Menu are \`details\`,
    // which open and close with no script. What a disclosure in a bar is
    // also expected to do is added here: one open at a time, Escape closes
    // it and puts focus back on its trigger, and a click or a tab away from
    // it closes it.
    const disclosures = [...document.querySelectorAll('.site-dropdown, .site-compact')]
    for (const details of disclosures) {
      details.addEventListener('toggle', () => {
        if (!details.open) return
        for (const other of disclosures) if (other !== details) other.open = false
      })
      details.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !details.open) return
        details.open = false
        details.querySelector('summary')?.focus()
      })
      details.addEventListener('focusout', (event) => {
        const next = event.relatedTarget
        if (details.open && next !== null && !details.contains(next)) details.open = false
      })
    }
    if (disclosures.length > 0) {
      document.addEventListener('click', (event) => {
        for (const details of disclosures) {
          if (details.open && !details.contains(event.target)) details.open = false
        }
      })
    }

    const menu = document.querySelector('.site-menu')
    const narrow = matchMedia('${NARROW}')
    if (menu !== null) {
      if (narrow.matches) menu.open = false
      narrow.addEventListener('change', (event) => {
        if (!event.matches) menu.open = true
      })
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire)
  else wire()
})()
`

export interface SchemeScript {
  readonly hash: string
  readonly href: string
  readonly source: string
}

/** The script, and the address that is its own hash. */
export function createSchemeScript(hasher: Hasher): SchemeScript {
  const hash = hasher.contentHash(SCHEME_SCRIPT).slice(0, 32)
  return { hash, href: `${PUBLIC_ASSET_PREFIX}/scheme-${hash}.js`, source: SCHEME_SCRIPT }
}
