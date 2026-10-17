import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'

import { Badge, Button, buttonClassName, PresentGoTo, tv } from '@quill/ui'
import '@quill/ui/present.css'

import { DocumentBody } from '../document-body.tsx'
import type { PresentStep } from './present-steps.ts'
import { PresenterNotes } from './presenter-notes-panel.tsx'
import type { PeerState } from './use-present-sync.ts'

export const presenterViewStyles = tv({
  slots: {
    root: 'presenter',
    bar: 'presenter-bar',
    barTitle: 'presenter-bar-title text-sm',
    position: 'shrink-0 font-mono text-xs text-muted tabular-nums',
    clock: 'shrink-0 font-mono text-base tabular-nums',
    stage: 'presenter-stage',
    label: 'meta truncate',
    controls: 'flex flex-wrap items-center gap-2',
    // Wraps the other controls under it where they would not fit beside it, rather than squeezing it.
    steps: 'flex min-w-0 flex-[1_1_16rem] gap-2',
    hint: 'presenter-hint ms-auto text-xs text-muted',
    warning: 'text-xs text-warning',
  },
})

/** What the room's screen is taken to be, in pixels: the width a preview is scaled down from. */
const ROOM_WIDTH = 1600

/**
 * A custom property for the stylesheet, which is where the scale is used (`zoom`). A record rather
 * than a literal, because `CSSProperties` does not list the ones a stylesheet invents.
 */
function vars(values: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return values
}

export interface PresenterViewProps {
  readonly documentTitle: string
  readonly workspaceSlug: string
  readonly documentId: string
  readonly steps: readonly PresentStep[]
  readonly index: number
  /** A slide has been drawn: give it what the room has opened in it. */
  readonly onSlideDrawn: () => void
  readonly notes: Readonly<Record<string, string>>
  readonly notesPending: boolean
  readonly peer: PeerState
  /** The room's screen is black. */
  readonly blank: boolean
  readonly onToggleBlank: () => void
  readonly goToOpen: boolean
  readonly onStep: (event: 'next' | 'previous') => void
  readonly onGoTo: (index: number) => void
  readonly onToggleGoTo: (open: boolean) => void
  /** Opens (or brings forward) the window the room sees. */
  readonly onOpenAudience: () => void
  /** The popup for the audience window was refused by the browser. */
  readonly blocked: boolean
}

/** Time since the presenter window opened, as `m:ss` or `h:mm:ss`, kept by a clock of its own. */
function Clock({ className }: { readonly className: string }) {
  const [seconds, setSeconds] = useState(0)
  // Synchronises with a timer, the external system that makes elapsed time observable.
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((now) => now + 1)
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [])
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  const clock =
    hours === 0
      ? `${String(minutes)}:${rest}`
      : `${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}`
  return (
    <p className={className}>
      <span className="sr-only">Time presenting </span>
      {clock}
    </p>
  )
}

/**
 * A link in a slide is for the room's browser: here it opens beside the presentation, never in
 * place of it, which would take the presenter out of the window they are presenting from.
 */
function keepInThisWindow(event: MouseEvent<HTMLElement>): void {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!(link instanceof HTMLAnchorElement)) return
  event.preventDefault()
  // A link to a place in the section stays in the section, and the browser has nowhere to open.
  if (!link.getAttribute('href')?.startsWith('#')) {
    window.open(link.href, '_blank', 'noopener,noreferrer')
  }
}

/**
 * A section as the room sees it, in a box that is as large as its space allows (`presenter-frame`
 * gives the box, the stylesheet fits a 16:9 slide to it) and scaled to match, so what the presenter
 * sees has the room's line breaks at any size.
 *
 * The current section is `live`: it can be used, because a presenter sharing this window has no
 * other way to open a picture, follow a link, fold a detail or copy some code in front of the room.
 * Its pictures open full screen, its links open beside it, and a section taller than the slide
 * scrolls. The next section is only a picture of what is coming, and is inert and hidden from
 * assistive technology, which would otherwise read the section twice.
 */
function SectionPreview({
  step,
  stepIndex,
  onDrawn,
  label,
  live = false,
}: {
  readonly step: PresentStep
  /** Where the section is in the deck: what the other window names it by, for a live one. */
  readonly stepIndex?: number
  /** The section has been drawn into the page. */
  readonly onDrawn?: () => void
  readonly label: string
  readonly live?: boolean
}) {
  const slide = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.3)
  // Synchronises with the slide's size, which the browser lays out and React does not render.
  useEffect(() => {
    const element = slide.current
    if (element === null) return undefined
    const watch = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      if (width > 0) setScale(width / ROOM_WIDTH)
    })
    watch.observe(element)
    return () => {
      watch.disconnect()
    }
  }, [])

  return (
    <div className="presenter-frame">
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- clicks bubble up from the links inside the slide, which are the interactive elements; the slide only keeps them in this window. */}
      <div
        ref={slide}
        data-surface="present"
        className="presenter-slide"
        style={vars({ '--zoom': String(scale) })}
        {...(live
          ? { 'data-live': 'true', onClickCapture: keepInThisWindow }
          : { 'aria-hidden': 'true' })}
      >
        <section className="present-step" data-step={live ? stepIndex : undefined}>
          <DocumentBody html={step.html} label={label} expandImages={live} onMounted={onDrawn} />
        </section>
      </div>
    </div>
  )
}

/**
 * The presenter's window (ADR-050): an instrument that fits the window it is in.
 *
 * What the presenter must always have is the notes, the way to step, where they are and the time;
 * what the room is looking at and what comes next are pictures when there is room for them and
 * words when there is not, and the rest of the chrome goes first. The sizes are the stylesheet's
 * (`present.css`); this says what each thing is.
 */
export function PresenterView({
  documentTitle,
  workspaceSlug,
  documentId,
  steps,
  index,
  onSlideDrawn,
  notes,
  notesPending,
  peer,
  blank,
  onToggleBlank,
  goToOpen,
  onStep,
  onGoTo,
  onToggleGoTo,
  onOpenAudience,
  blocked,
}: PresenterViewProps) {
  const styles = presenterViewStyles()
  const current = steps[index]
  const next = steps[index + 1]
  // A section with no notes gives their room to the slides, as a speaker with none is speaking to them.
  const hasNotes =
    notesPending || (current !== undefined && (notes[current.id] ?? '').trim() !== '')

  return (
    <div data-surface="presenter" className={styles.root()}>
      <header className={styles.bar()}>
        <p className={styles.barTitle()}>{documentTitle}</p>
        <p className={styles.position()}>{`Section ${index + 1} of ${steps.length}`}</p>
        <Clock className={styles.clock()} />
        {blank ? <Badge tone="warning">Room’s screen is black</Badge> : undefined}
        {peer === 'following' ? (
          <Badge tone="success">Audience connected</Badge>
        ) : peer === 'other-revision' ? (
          <Badge tone="warning">Audience on another version</Badge>
        ) : (
          <>
            <Badge tone="neutral">No audience window</Badge>
            <Button size="sm" variant="secondary" onClick={onOpenAudience}>
              Open audience window
            </Button>
          </>
        )}
      </header>

      <div className={styles.stage()} data-notes={hasNotes ? 'some' : 'none'}>
        <section className="presenter-now" aria-label="Now showing">
          {current === undefined ? undefined : (
            <>
              <p className={styles.label()}>Now showing · {current.title}</p>
              <SectionPreview
                step={current}
                stepIndex={index}
                onDrawn={onSlideDrawn}
                label={`Now showing: ${current.title}`}
                live
              />
            </>
          )}
        </section>

        <PresenterNotes
          className="presenter-notes"
          position={index + 1}
          sectionTitle={current?.title ?? ''}
          notes={current === undefined ? undefined : notes[current.id]}
          isPending={notesPending}
        />

        <section className="presenter-next" aria-label="Next">
          {next === undefined ? (
            <p className={styles.label()}>This is the last section.</p>
          ) : (
            <>
              <p className={styles.label()}>Next · {next.title}</p>
              <SectionPreview step={next} label={`Next: ${next.title}`} />
            </>
          )}
        </section>
      </div>

      <footer className={styles.controls()}>
        <div className={styles.steps()}>
          <Button
            size="xl"
            variant="secondary"
            className="flex-1"
            disabled={index === 0}
            onClick={() => {
              onStep('previous')
            }}
          >
            Previous
          </Button>
          <Button
            size="xl"
            className="flex-1"
            disabled={next === undefined}
            onClick={() => {
              onStep('next')
            }}
          >
            Next
          </Button>
        </div>
        <Button
          variant={blank ? 'secondary' : 'ghost'}
          aria-pressed={blank}
          onClick={onToggleBlank}
        >
          Black screen
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onToggleGoTo(true)
          }}
        >
          Go to…
        </Button>
        <Link
          to="/w/$workspaceSlug/d/$documentId"
          params={{ workspaceSlug, documentId }}
          search={{}}
          hash={current?.id ?? ''}
          className={buttonClassName({ variant: 'ghost' })}
        >
          Leave
        </Link>
        {blocked ? (
          <p role="alert" className={styles.warning()}>
            Your browser blocked the new window. Allow pop-ups for this site.
          </p>
        ) : undefined}
        <p className={styles.hint()}>
          ← → or Page Up and Down, or the scroll wheel, step the room too.
        </p>
      </footer>

      <PresentGoTo
        open={goToOpen}
        sections={steps}
        currentIndex={index}
        onSelect={(selected) => {
          onToggleGoTo(false)
          onGoTo(selected)
        }}
        onClose={() => {
          onToggleGoTo(false)
        }}
      />
    </div>
  )
}
