import { Suspense, lazy, useState, type ComponentType } from 'react'

import { ProgressBar } from '@quill/ui'

/** What a dialog must take to be loaded on demand: the pair every dialog already has. */
interface OpenableProps {
  readonly open?: boolean | undefined
}

/**
 * A dialog whose code is fetched the first time it is opened.
 *
 * A dialog is the clearest case of code a reader does not need to read: it
 * is behind a press, its form, its mutation and the Radix dialog machinery
 * are not on the page until somebody asks. Left as static imports they sit in
 * the reading route's first-render bundle (`docs/operations/bundle-budget.md`).
 * The search palette (`search-provider.tsx`) set the pattern; this is the same
 * pattern for dialogs that take `open` and `onOpenChange` as props.
 *
 * Nothing is rendered until `open` has been true once; from then on the dialog
 * stays mounted, so closing it is the dialog's own exit and not an unmount.
 * While the chunk is arriving there is a labelled progress bar, because a
 * press that appears to do nothing is the feedback gap `docs/design/feedback.md`
 * rules out.
 *
 * Pattern: virtual proxy — it stands in for the dialog with the same props.
 */
export function lazyDialog<Props extends OpenableProps>(
  load: () => Promise<{ readonly default: ComponentType<Props> }>,
  opening: string,
): ComponentType<Props> {
  const Dialog = lazy(load)

  return function LazyDialog(props: Props) {
    const [requested, setRequested] = useState(props.open === true)
    // Derived from props during render, the documented way to remember "has
    // ever been true" without an effect.
    if (props.open === true && !requested) setRequested(true)
    if (!requested) return null

    return (
      <Suspense fallback={<ProgressBar placement="top" label={opening} />}>
        <Dialog {...props} />
      </Suspense>
    )
  }
}
