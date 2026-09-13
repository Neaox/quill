import { getRouteApi, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  Button,
  buttonClassName,
  Callout,
  PresentBar,
  PresentGoTo,
  PresentHint,
  PresentKey,
  PresentProgress,
  PresentRail,
  tv,
} from '@quill/ui'

import {
  ApiError,
  useLoadedDocument,
  usePublishedContent,
  useRenderedDocument,
  type OutlineEntry,
} from '../../../lib/api/index.ts'
import { DocumentBody } from '../document-body.tsx'
import { commandForKey, presentReducer, stepFromSearch, type StepEvent } from './present-state.ts'
import { splitSteps } from './present-steps.ts'
import { notesForSteps } from './presenter-notes.ts'
import { PresenterNotesPanel } from './presenter-notes-panel.tsx'
import { useFullscreen } from './use-fullscreen.ts'
import { useIdle } from './use-idle.ts'

const routeApi = getRouteApi('/_authenticated/w/$workspaceSlug_/d/$documentId/present')

/** How long the room has to be still before the chrome gets out of the way. */
const IDLE_AFTER_MS = 2500

/**
 * How many sections either side of the one on screen stay mounted.
 *
 * Every mounted section parses its own HTML and paints the packed token ranges
 * over its code (ADR-030, ADR-031), so mounting a fifty-section deck at once
 * did all of that work before the first slide appeared and again on every
 * revision change. One neighbour either side is what keeps the next step
 * instant — the section the presenter is about to reach is already in the DOM
 * — without paying for the forty-seven they will reach in ten minutes' time.
 */
const MOUNTED_NEIGHBOURS = 1

/** A stable empty outline, so the split below is not redone on every render. */
const NO_OUTLINE: readonly OutlineEntry[] = []

export const presentStyles = tv({
  slots: {
    root: 'relative min-h-dvh bg-background text-foreground',
    /*
     * The section is a focus target, not a control: focus moves here on every
     * step so the heading is announced and the keyboard starts inside the
     * document, and an outline around the whole projector would be furniture
     * rather than information.
     */
    step: 'present-step focus:outline-hidden',
    centre: 'flex min-h-dvh items-center justify-center p-10',
    exit: 'mt-4 inline-flex',
  },
})

/**
 * Presenting a document to a room (quill-plan.md section 14).
 *
 * It is a reading mode, not a second artefact. The body is the same cached
 * HTML the reading view mounts, mounted by the same `DocumentBody` — so the
 * same renderer output, the same heading ids, and the same packed token ranges
 * painted over the code (ADR-030, ADR-031) — split into steps at the
 * top-level sections of the same outline the table of contents reads. What
 * presentation adds is the layer-0 measurements a projector needs
 * (`data-surface="present"`, `packages/ui/src/styles/present.css`) and three
 * pieces of chrome: a progress bar, a section rail, and a presenter bar that
 * fades when nothing is happening.
 *
 * Which section is on screen is URL state (ADR-013): `?step=3` is the whole of
 * it, so a refresh, a second screen, and a link into a chat all land on the
 * same section. Stepping *replaces* rather than pushes, because the back
 * button belongs to leaving the presentation, not to walking backwards
 * through it one section at a time.
 */
export function PresentRoute() {
  const { workspaceSlug, documentId } = routeApi.useParams()
  const { step } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()

  // Both were awaited by the route's loader, so neither has a pending state
  // here. The body is still allowed to have failed: a document that has never
  // been published has none, which is an empty state rather than an error.
  const documentQuery = useLoadedDocument(documentId)
  const rendered = useRenderedDocument(documentId)

  const [goToOpen, setGoToOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  // Notes cost a request, and most presentations never ask for them, so the
  // published source is fetched the first time somebody presses `n` and kept
  // from then on (it is immutable for a revision, so once is enough).
  const [notesAsked, setNotesAsked] = useState(false)
  const notesQuery = usePublishedContent(notesAsked ? documentId : undefined)

  const idle = useIdle(IDLE_AFTER_MS)

  const title = documentQuery.data.title
  const revision = rendered.data?.body.revision ?? ''
  const html = rendered.data?.body.html ?? ''
  const outline = rendered.data?.body.outline ?? NO_OUTLINE

  const steps = useMemo(
    () => splitSteps(html, outline, title, globalThis.document),
    [html, outline, title],
  )
  const notes = useMemo(
    () => notesForSteps(notesQuery.data?.markdown ?? '', steps),
    [notesQuery.data?.markdown, steps],
  )

  const count = steps.length
  const index = stepFromSearch(step, count)
  const current = steps[index]

  const goTo = useCallback(
    (next: number) => {
      void navigate({ to: '.', search: { step: next + 1 }, replace: true })
    },
    [navigate],
  )

  const dispatch = useCallback(
    (event: StepEvent) => {
      const next = presentReducer({ index, count }, event)
      if (next.index !== index) goTo(next.index)
    },
    [index, count, goTo],
  )

  const leave = useCallback(() => {
    void navigate({
      to: '/w/$workspaceSlug/d/$documentId',
      params: { workspaceSlug, documentId },
      search: {},
      ...(current === undefined ? {} : { hash: current.id }),
    })
  }, [navigate, workspaceSlug, documentId, current])

  /*
   * Escape leaves, on every engine.
   *
   * A presentation asks for full screen when it opens, and inside full screen
   * the first Escape belongs to the browser. Chromium hands the `keydown` to
   * the page as well; Firefox and WebKit swallow it, so the presenter there
   * pressed the key the product tells them to press and nothing happened.
   * Leaving on the full-screen exit itself — which every engine reports — is
   * the same gesture read where every engine agrees about it. The bar's own
   * "Leave full screen" is not that gesture: it asked for the exit, so the
   * presentation stays, windowed.
   */
  const fullscreen = useFullscreen({ onBrowserExit: leave })

  const toggleNotes = useCallback(() => {
    setNotesAsked(true)
    setNotesOpen((open) => !open)
  }, [])

  /* Synchronises with the window's keyboard. A presentation is driven from a
     remote or from the keyboard with nothing in particular focused, so the
     window is where the keys arrive; while the go-to overlay is open it owns
     them instead, and this does not listen at all. */
  useEffect(() => {
    if (goToOpen) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = commandForKey(event)
      if (command === undefined) return
      event.preventDefault()
      if (command.kind === 'step') dispatch(command.event)
      else if (command.kind === 'exit') leave()
      else if (command.kind === 'go-to') setGoToOpen(true)
      else toggleNotes()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goToOpen, dispatch, leave, toggleNotes])

  /* Synchronises with the DOM's focus, which React does not render: a new
     step has to put the keyboard inside the section it just showed, or the
     next Tab starts from wherever the last one left off. */
  useEffect(() => {
    if (current === undefined) return
    globalThis.document.getElementById(`present-step-${index}`)?.focus()
  }, [current, index])

  if (rendered.isError) {
    const error: unknown = rendered.error
    const notPublished = error instanceof ApiError && error.status === 404
    return (
      <div className={presentStyles().centre()}>
        <Callout
          tone={notPublished ? 'info' : 'danger'}
          title={notPublished ? 'Nothing published yet' : 'Couldn’t open this presentation'}
        >
          {notPublished
            ? 'A presentation is a published document read at projector size. Publish this one first.'
            : error instanceof ApiError
              ? error.message
              : 'Please try again.'}
          <ReadingViewLink workspaceSlug={workspaceSlug} documentId={documentId} />
        </Callout>
      </div>
    )
  }

  const styles = presentStyles()

  if (count === 0) {
    return (
      <div className={styles.centre()}>
        <Callout tone="info" title="Nothing to present">
          This revision has no content, so there are no sections to step through.
          <ReadingViewLink workspaceSlug={workspaceSlug} documentId={documentId} />
        </Callout>
      </div>
    )
  }

  return (
    <div data-surface="present" className={styles.root()}>
      <PresentProgress value={index + 1} max={count} />

      <main>
        {steps.map((section, position) =>
          Math.abs(position - index) > MOUNTED_NEIGHBOURS ? undefined : (
            <section
              key={`${revision}-${section.id}`}
              id={`present-step-${position}`}
              tabIndex={-1}
              aria-label={section.title}
              hidden={position !== index}
              className={styles.step()}
            >
              <DocumentBody html={section.html} label={section.title} />
            </section>
          ),
        )}
      </main>

      {/* The step change itself, in words, for anyone who cannot see it happen. */}
      <p aria-live="polite" className="sr-only">
        {`Section ${index + 1} of ${count}: ${current?.title ?? ''}`}
      </p>

      <PresentRail items={steps} currentIndex={index} onSelect={goTo} />

      {notesOpen ? (
        <PresenterNotesPanel
          position={index + 1}
          sectionTitle={current?.title ?? ''}
          notes={current === undefined ? undefined : notes[current.id]}
          isPending={notesQuery.isPending}
          onClose={toggleNotes}
        />
      ) : undefined}

      <PresentBar
        title={title}
        position={`${index + 1} of ${count}`}
        idle={idle && !goToOpen && !notesOpen}
      >
        <PresentHint
          keys={
            <>
              <PresentKey>←</PresentKey>
              <PresentKey>→</PresentKey>
            </>
          }
        >
          Sections
        </PresentHint>
        <PresentHint keys={<PresentKey>N</PresentKey>}>Notes</PresentHint>
        <PresentHint keys={<PresentKey>G</PresentKey>}>Go to</PresentHint>
        {fullscreen.supported ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={fullscreen.active ? fullscreen.exit : fullscreen.request}
          >
            {fullscreen.active ? 'Leave full screen' : 'Full screen'}
          </Button>
        ) : undefined}
        <Link
          to="/w/$workspaceSlug/d/$documentId"
          params={{ workspaceSlug, documentId }}
          search={{}}
          hash={current?.id ?? ''}
          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
        >
          Exit
        </Link>
      </PresentBar>

      <PresentGoTo
        open={goToOpen}
        sections={steps}
        currentIndex={index}
        onSelect={(next) => {
          setGoToOpen(false)
          goTo(next)
        }}
        onClose={() => setGoToOpen(false)}
      />
    </div>
  )
}

/** Back to reading, from wherever presenting could not start. */
function ReadingViewLink({
  workspaceSlug,
  documentId,
}: {
  readonly workspaceSlug: string
  readonly documentId: string
}) {
  return (
    <p className={presentStyles().exit()}>
      <Link
        to="/w/$workspaceSlug/d/$documentId"
        params={{ workspaceSlug, documentId }}
        search={{}}
        className={buttonClassName({ variant: 'secondary', size: 'sm' })}
      >
        Back to the document
      </Link>
    </p>
  )
}
