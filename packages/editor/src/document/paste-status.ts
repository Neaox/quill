import { buttonClassName, tv } from '@quill/ui'

/**
 * What a large paste shows while it lands (quill-plan.md section 31;
 * `docs/design/feedback.md`): the inline status of the thing on screen,
 * where the blocks are arriving.
 *
 * A small card in the document's flow at the edge the blocks grow from:
 * "Pasting… 40%" over a progress bar, with Cancel beside it (Escape does the
 * same). It settles into "Pasted 1,200 blocks" for a moment, or into a
 * failure that says what to do, with Try again. It fades in after a beat, so
 * a paste that lands at once never flashes it, and under reduced motion it
 * neither fades nor shimmers.
 *
 * The blocks soon push the card below the fold, so while it is out of sight
 * the same words and buttons float at the bottom of the window. The float is
 * a copy for the eye and the pointer — the card in the document is the one
 * assistive technology reads, and Escape is the keyboard's Cancel — and it
 * lives outside the document, because anything positioned against the
 * document's own scrolling would have the browser lay out every block again
 * on every frame of the paste.
 *
 * Both are plain DOM because the card is a ProseMirror widget: drawn once per
 * paste and updated in place, so its buttons keep focus while the blocks move
 * it down. What it says is announced through a separate live region
 * (`createPasteAnnouncer`), because the card itself goes away.
 */

export type PasteStatusState = 'landing' | 'landed' | 'failed'

export interface PasteStatusActions {
  cancel(): void
  retry(): void
  dismiss(): void
}

export interface PasteStatus {
  /** The card, in the document's flow. */
  readonly element: HTMLElement
  /** The copy that floats at the bottom of the window while the card is out of sight. */
  readonly float: HTMLElement
  /** How far the paste has landed, from 0 to 1. */
  progress(fraction: number): void
  landed(blocks: number): void
  failed(): void
  /** Back to landing, for a paste tried again. */
  landing(): void
  /** Takes the float away and stops watching the card. */
  dispose(): void
}

export const pasteStatusStyles = tv({
  slots: {
    root: [
      'paste-status flex flex-col gap-2 rounded-lg border border-border border-s-2 border-s-accent',
      'bg-surface-raised px-3 py-2 text-xs text-foreground shadow-overlay',
      'data-[state=landed]:border-s-success data-[state=failed]:border-s-danger',
    ],
    row: 'flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1',
    label: 'min-w-0 flex-1 font-medium tabular-nums',
    actions: 'flex shrink-0 items-center gap-1',
    key: 'ms-1.5 font-mono text-2xs text-muted',
    track: 'paste-status-track h-1 w-full overflow-hidden rounded-full bg-border',
    bar: 'paste-status-bar h-full w-full origin-left rounded-full bg-accent rtl:origin-right',
  },
  variants: {
    placement: {
      card: { root: 'my-3' },
      float: {
        root: [
          'paste-status-float fixed inset-x-4 bottom-4 z-40 mx-auto w-auto max-w-sm',
          '[&[hidden]]:hidden',
        ],
      },
    },
  },
})

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 })
const count = new Intl.NumberFormat()

/** What the card and the live region say, in one place. */
export const pasteMessages = {
  landing: 'Pasting…',
  progress: (fraction: number) => `Pasting… ${percent.format(fraction)}`,
  landed: (blocks: number) => `Pasted ${count.format(blocks)} ${blocks === 1 ? 'block' : 'blocks'}`,
  cancelled: 'Paste cancelled',
  failed: 'This paste could not be read as Markdown. Nothing was changed.',
} as const

interface View {
  readonly root: HTMLElement
  readonly label: HTMLElement
  readonly controls: HTMLElement
  readonly track: HTMLElement
  readonly bar: HTMLElement
  readonly buttons: Readonly<Record<'cancel' | 'retry' | 'dismiss', HTMLButtonElement>>
}

function buildView(
  owner: Document,
  actions: PasteStatusActions,
  placement: 'card' | 'float',
): View {
  const styles = pasteStatusStyles({ placement })
  const make = <Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className: string) => {
    const element = owner.createElement(tag)
    element.className = className
    return element
  }
  const button = (text: string, onPress: () => void, shortcut?: string) => {
    const element = make('button', buttonClassName({ variant: 'ghost', size: 'sm' }))
    element.type = 'button'
    element.textContent = text
    if (placement === 'float') element.tabIndex = -1
    if (shortcut !== undefined) {
      element.setAttribute('aria-keyshortcuts', shortcut)
      const key = make('kbd', styles.key())
      key.setAttribute('aria-hidden', 'true')
      key.textContent = 'Esc'
      element.append(key)
    }
    // The editor would otherwise take the press for a click in the document.
    element.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })
    element.addEventListener('click', onPress)
    return element
  }
  const root = make('div', styles.root())
  if (placement === 'card') {
    root.setAttribute('contenteditable', 'false')
    root.setAttribute('role', 'group')
    root.setAttribute('aria-label', 'Paste')
  } else {
    root.setAttribute('aria-hidden', 'true')
    root.hidden = true
  }
  const row = make('div', styles.row())
  const label = make('span', styles.label())
  const controls = make('div', styles.actions())
  const track = make('div', styles.track())
  if (placement === 'card') {
    track.setAttribute('role', 'progressbar')
    track.setAttribute('aria-label', 'Pasting')
    track.setAttribute('aria-valuemin', '0')
    track.setAttribute('aria-valuemax', '100')
  }
  const bar = make('div', styles.bar())
  track.append(bar)
  row.append(label, controls)
  root.append(row, track)
  return {
    root,
    label,
    controls,
    track,
    bar,
    buttons: {
      cancel: button('Cancel', actions.cancel, 'Escape'),
      retry: button('Try again', actions.retry),
      dismiss: button('Dismiss', actions.dismiss, 'Escape'),
    },
  }
}

export function createPasteStatus(owner: Document, actions: PasteStatusActions): PasteStatus {
  const card = buildView(owner, actions, 'card')
  const float = buildView(owner, actions, 'float')
  const views = [card, float]
  owner.body.append(float.root)
  let state: PasteStatusState = 'landing'
  let fraction = 0
  let cardInSight = true

  const showFloat = () => {
    float.root.hidden = cardInSight
  }
  // The float shows only while the card cannot be seen.
  const watch =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver((entries) => {
          for (const entry of entries) cardInSight = entry.isIntersecting
          showFloat()
        })
  watch?.observe(card.root)

  const draw = (text: string, buttons: readonly ('cancel' | 'retry' | 'dismiss')[]) => {
    for (const view of views) {
      const focused = buttons
        .map((name) => view.buttons[name])
        .find((candidate) => candidate === owner.activeElement)
      view.root.dataset['state'] = state
      view.label.textContent = text
      view.track.hidden = state === 'failed'
      view.controls.replaceChildren(...buttons.map((name) => view.buttons[name]))
      focused?.focus()
    }
  }

  const progress = (next: number) => {
    fraction = Math.min(1, Math.max(0, next))
    for (const view of views) {
      view.bar.style.transform = `scaleX(${String(fraction)})`
      if (state === 'landing') {
        view.label.textContent =
          fraction === 0 ? pasteMessages.landing : pasteMessages.progress(fraction)
      }
    }
    card.track.setAttribute('aria-valuenow', String(Math.round(fraction * 100)))
  }

  const status: PasteStatus = {
    element: card.root,
    float: float.root,
    progress,
    landed(blocks) {
      state = 'landed'
      progress(1)
      draw(pasteMessages.landed(blocks), [])
    },
    failed() {
      state = 'failed'
      draw(pasteMessages.failed, ['retry', 'dismiss'])
    },
    landing() {
      state = 'landing'
      draw(pasteMessages.landing, ['cancel'])
      progress(0)
    },
    dispose() {
      watch?.disconnect()
      float.root.remove()
    },
  }
  status.landing()
  return status
}

export interface PasteAnnouncer {
  /** Says `message` politely, or at once when something has gone wrong. */
  announce(message: string, urgency?: 'polite' | 'assertive'): void
  /** Gives up this editor's share of the live regions. */
  release(): void
}

interface Regions {
  live: { readonly polite: HTMLElement; readonly assertive: HTMLElement } | undefined
  /** What each region will say once it has settled into the page, the latest words winning. */
  waiting: Map<HTMLElement, string> | undefined
  users: number
}

const regions = new WeakMap<Document, Regions>()

/** How long a live region is in the page before it is first spoken through, so it is heard. */
export const LIVE_REGION_SETTLE_MS = 100

/**
 * The live regions paste announcements go to: one pair for the page, put in
 * the page by the first large paste — not before, so a page that never pastes
 * one carries no extra status for assistive technology to find — and taken
 * out when the last editor goes. A region has to be in the page before what
 * it announces, so the first words wait a moment for it.
 */
export function createPasteAnnouncer(owner: Document): PasteAnnouncer {
  const shared = regions.get(owner) ?? { live: undefined, waiting: undefined, users: 0 }
  regions.set(owner, shared)
  shared.users += 1
  let released = false
  const region = (role: 'status' | 'alert') => {
    const element = owner.createElement('div')
    element.className = 'sr-only'
    element.setAttribute('role', role)
    element.dataset['pasteAnnouncer'] = role
    owner.body.append(element)
    return element
  }
  return {
    announce(message, urgency = 'polite') {
      if (shared.live === undefined) {
        shared.live = { polite: region('status'), assertive: region('alert') }
        const waiting = new Map<HTMLElement, string>()
        shared.waiting = waiting
        setTimeout(() => {
          shared.waiting = undefined
          for (const [target, words] of waiting) target.textContent = words
        }, LIVE_REGION_SETTLE_MS)
      }
      const target = urgency === 'polite' ? shared.live.polite : shared.live.assertive
      if (shared.waiting !== undefined) {
        shared.waiting.set(target, message)
        return
      }
      // Emptied first, so the same words said twice are said twice.
      target.textContent = ''
      target.textContent = message
    },
    release() {
      if (released) return
      released = true
      shared.users -= 1
      if (shared.users > 0) return
      shared.live?.polite.remove()
      shared.live?.assertive.remove()
      regions.delete(owner)
    },
  }
}
