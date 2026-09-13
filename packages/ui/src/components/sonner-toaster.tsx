import { isValidElement, useEffect, type ReactNode } from 'react'
import { Toaster as SonnerToaster, toast as sonnerToast, type ToastClassnames } from 'sonner'

import { CloseIcon, DangerIcon, InfoIcon, SuccessIcon, WarningIcon } from './icons.tsx'
import { Spinner } from './spinner.tsx'
import { announceAssertively, DANGER_TONE_LABEL, toneTitle, type ToastTone } from './toast-tone.tsx'
import {
  installToastSink,
  type ShowToastOptions,
  type ToastAction,
  type ToastId,
  type ToastPromiseMessage,
  type ToastPromiseOutcome,
  type ToastSink,
} from './toast.ts'
import { toasterStyles, type ToasterPosition } from './toaster-styles.ts'

/**
 * Dependency justification (rule 11): `sonner`, pinned at 2.0.8.
 *
 * A toast stack is stacking, swipe-to-dismiss with real pointer-velocity
 * thresholds, hover-to-pause the auto-dismiss timer, a promise-aware toast
 * that crossfades between states, and an `aria-live="polite"` region
 * announcing each toast as it mounts — a few kilobytes gzipped and already
 * well exercised. Hand-rolling that on top of Radix, which has no toast
 * primitive, would be more code with less polish for the same result.
 *
 * It is mounted fully `unstyled`: every visible pixel comes from this
 * package's tokens through `tv`, so sonner contributes behaviour only.
 *
 * **This module is the only one that imports `sonner`, and it is loaded
 * dynamically** (`toaster.tsx`). That is what keeps the library out of the
 * graph a reader downloads before a document appears (review 2026-09-13, H1)
 * while still mounting the host — and its live region — immediately after the
 * application paints, long before any toast is raised. `toast.ts` holds the
 * few calls that could arrive in that window and replays them the moment the
 * sink below is installed.
 */

const shared = toasterStyles()

/**
 * One merged class string per sonner `type`, not per our `tone`: sonner keys
 * its own `toastOptions.classNames` by the toast's current type, and a
 * promise toast changes type in place as it settles from `loading` to
 * `success` or `error`. Reading the merged tone class off that same key is
 * what lets one `toast.promise` call re-tone the same element through every
 * phase without this package tracking the transition itself.
 *
 * Each value is the whole `toast` slot, base classes included: sonner
 * concatenates `classNames.toast` with `classNames[type]` as plain strings,
 * not through `cx`, so the two would each contribute their own border-colour
 * utility and leave the stylesheet's rule order to decide which one painted.
 * Leaving `classNames.toast` unset and putting the full merge here avoids
 * that entirely.
 */
const toastClassNameByType: Pick<
  ToastClassnames,
  'default' | 'success' | 'info' | 'warning' | 'error' | 'loading'
> = {
  default: toasterStyles({ tone: 'neutral' }).toast(),
  success: toasterStyles({ tone: 'success' }).toast(),
  info: toasterStyles({ tone: 'info' }).toast(),
  warning: toasterStyles({ tone: 'warning' }).toast(),
  error: toasterStyles({ tone: 'danger' }).toast(),
  loading: toasterStyles({ tone: 'neutral' }).toast(),
}

/**
 * The icon slot carries no colour of its own: every icon here is drawn with
 * `stroke="currentColor"`, and the tone lives on the toast element itself
 * (`text-success`, `text-danger`, …), so the icon simply inherits it. `title`
 * and `description` are never affected because both set their own colour.
 */
const toastClassNames: ToastClassnames = {
  icon: shared.icon(),
  content: shared.content(),
  title: shared.title(),
  description: shared.description(),
  actionButton: shared.action(),
  cancelButton: shared.cancel(),
  closeButton: shared.close(),
  ...toastClassNameByType,
}

/**
 * `window.matchMedia` is missing in Node (this package also renders on the
 * server, ADR-019) and unimplemented in jsdom, so this reads the same way
 * `theme.ts` reads storage: try the real thing, fall back when the
 * environment does not have it, never branch on `typeof window` first.
 */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** The stack's own icons, so nothing here is drawn by the library. */
const ICONS = {
  success: <SuccessIcon />,
  info: <InfoIcon />,
  warning: <WarningIcon />,
  error: <DangerIcon />,
  loading: <Spinner />,
  close: <CloseIcon />,
}

function toSonnerAction(action: ToastAction) {
  return { label: action.label, onClick: action.onClick }
}

function isPromiseOutcome<Value>(value: unknown): value is ToastPromiseOutcome<Value> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isValidElement(value) &&
    'title' in value
  )
}

interface ResolvedOutcome {
  readonly title: ReactNode
  readonly action?: ToastAction
}

function resolveOutcome<Value>(message: ToastPromiseMessage<Value>, value: Value): ResolvedOutcome {
  const resolved = typeof message === 'function' ? message(value) : message
  if (!isPromiseOutcome<Value>(resolved)) return { title: resolved }

  const title = typeof resolved.title === 'function' ? resolved.title(value) : resolved.title
  const action = typeof resolved.action === 'function' ? resolved.action(value) : resolved.action
  return action === undefined ? { title } : { title, action }
}

/** Sonner's own "extended result" shape for a settled promise toast. */
function toSonnerOutcome(tone: ToastTone, outcome: ResolvedOutcome) {
  return {
    message: toneTitle(tone, outcome.title),
    ...(outcome.action === undefined
      ? {}
      : { action: toSonnerAction(outcome.action), duration: Number.POSITIVE_INFINITY }),
  }
}

function show(
  id: ToastId,
  { title, description, tone, action, cancel, duration }: ShowToastOptions,
) {
  const titleNode = toneTitle(tone ?? 'neutral', title)

  // `exactOptionalPropertyTypes` distinguishes an omitted key from one set to
  // `undefined`, and sonner's own types are not `| undefined`, so each key is
  // spread in only when it has a value (`docs/architecture/styling.md`'s
  // "no conditional class strings" cousin, for props rather than classes).
  const options = {
    id,
    ...(description === undefined ? {} : { description }),
    ...(action === undefined ? {} : { action: toSonnerAction(action) }),
    ...(cancel === undefined ? {} : { cancel: toSonnerAction(cancel) }),
    // An action means "stays until dismissed" (`docs/design/feedback.md`),
    // unconditionally: it is a rule about the action, not a default a caller
    // can quietly override by also passing `duration`.
    ...(action === undefined
      ? duration === undefined
        ? {}
        : { duration }
      : { duration: Number.POSITIVE_INFINITY }),
  }

  switch (tone ?? 'neutral') {
    case 'success':
      sonnerToast.success(titleNode, options)
      return
    case 'info':
      sonnerToast.info(titleNode, options)
      return
    case 'warning':
      sonnerToast.warning(titleNode, options)
      return
    case 'danger':
      sonnerToast.error(titleNode, options)
      return
    case 'neutral':
      sonnerToast.message(titleNode, options)
  }
}

/** The adapter behind `toast.*`: the one place the library's own API is called. */
export const sonnerSink: ToastSink = {
  show,
  promise: (id, input, messages) => {
    sonnerToast.promise(input, {
      id,
      loading: toneTitle('neutral', messages.loading),
      success: (data) => toSonnerOutcome('success', resolveOutcome(messages.success, data)),
      error: (error: unknown) => {
        const outcome = resolveOutcome(messages.error, error)
        // The same urgency `toast.danger` gets: a promise that failed is a
        // danger toast, whatever tone it started in.
        if (typeof outcome.title === 'string') {
          announceAssertively(`${DANGER_TONE_LABEL}: ${outcome.title}`)
        }
        return toSonnerOutcome('danger', outcome)
      },
    })
  },
  dismiss: (id) => {
    sonnerToast.dismiss(id)
  },
}

export interface SonnerToastHostProps {
  readonly position?: ToasterPosition
  readonly closeButton?: boolean
  readonly className?: string | undefined
}

/**
 * The toast stack itself.
 *
 * `theme` is pinned to `"light"` rather than wired to the reader's actual
 * scheme. Sonner ships exactly one rule that is not gated behind its own
 * `unstyled` flag: `[data-sonner-theme=dark] [data-description]` sets a
 * literal `color`, with higher specificity than the single utility class
 * `.description` uses for its token-driven one. Pinning `light` keeps that
 * selector from ever matching; dark mode is instead the same tokens every
 * other primitive already uses, which flip with `data-theme` on their own
 * (`docs/architecture/styling.md`) — never a prop this component takes.
 *
 * Density is likewise not a prop: every slot's padding and gaps are
 * Tailwind spacing utilities, which already scale with the theme's
 * `--spacing` (ADR-019). Sonner's own stacking maths (`--gap`, `--width`)
 * stays at its sensible defaults, because overriding it would mean fighting
 * the inline styles it sets for its own offset animation.
 *
 * Swiping is dropped when the reader prefers reduced motion: sonner's
 * injected stylesheet already collapses its transition durations under
 * `prefers-reduced-motion`, but a swipe's drag-follow has no transition to
 * collapse — it is a direct pointer-to-transform mapping — so the gesture
 * itself is turned off instead. The explicit close button is what keeps every
 * toast dismissible without it.
 */
export function SonnerToastHost({
  position = 'bottom-right',
  closeButton = true,
  className,
}: SonnerToastHostProps): ReactNode {
  /*
   * Synchronises `toast.ts`'s sink — a module-level slot outside React — with
   * this host's lifetime, so calls made before this chunk arrived are replayed
   * into a mounted stack rather than dropped, and calls made after it unmounts
   * are held rather than sent into nothing.
   */
  useEffect(() => installToastSink(sonnerSink), [])

  return (
    <SonnerToaster
      position={position}
      theme="light"
      closeButton={closeButton}
      // Omitted keeps sonner's own position-aware default (it swipes towards
      // whichever edge the stack is anchored to); only reduced motion
      // overrides that, by turning the gesture off outright.
      {...(prefersReducedMotion() ? { swipeDirections: [] } : {})}
      {...(className === undefined ? {} : { className })}
      icons={ICONS}
      toastOptions={{
        unstyled: true,
        classNames: toastClassNames,
        closeButtonAriaLabel: 'Dismiss notification',
      }}
    />
  )
}

export default SonnerToastHost
