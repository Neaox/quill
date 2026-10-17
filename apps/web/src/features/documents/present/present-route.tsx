import { getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BRAND } from '@quill/brand'
import '@quill/ui/styles/present.css'
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
  useDocumentLinksLoader,
  useLoadedDocument,
  usePublishedContent,
  useRenderedDocument,
  type OutlineEntry,
} from '../../../lib/api/index.ts'
import { useFollowLink } from '../../../lib/routing/use-follow-link.ts'
import { DocumentBody } from '../document-body.tsx'
import {
  commandForKey,
  presentReducer,
  stepFromSearch,
  type SlideEntry,
  type StepEvent,
} from './present-state.ts'
import { splitSteps } from './present-steps.ts'
import { enterSlide, scrollSlide, slideScroller } from './slide-scroll.ts'
import { notesForSteps } from './presenter-notes.ts'
import { targetOwnsKey } from './key-owner.ts'
import { PresenterView } from './presenter-view.tsx'
import { useFullscreen } from './use-fullscreen.ts'
import { useIdle } from './use-idle.ts'
import { useWheelStep } from './use-wheel-step.ts'
import { createDetailsStore, useShareDetails } from './shared-details.ts'
import { usePresentSync } from './use-present-sync.ts'

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
  const { step, view } = routeApi.useSearch()
  const isPresenter = view === 'presenter'
  const router = useRouter()
  const navigate = routeApi.useNavigate()

  // Both were awaited by the route's loader, so neither has a pending state
  // here. The body is still allowed to have failed: a document that has never
  // been published has none, which is an empty state rather than an error.
  const documentQuery = useLoadedDocument(documentId)
  const rendered = useRenderedDocument(documentId)
  // A link on a slide to another document moves within the app (ADR-035).
  const followLink = useFollowLink()
  const loadLinks = useDocumentLinksLoader()

  const [goToOpen, setGoToOpen] = useState(false)
  // Which end of a slide the next one shown starts at: the one the person arrived from.
  const arriving = useRef<SlideEntry>('top')
  // The notes are the presenter window's alone (ADR-050): they cost a request, and the window the
  // room sees never asks for them, so it never has them to draw.
  const notesQuery = usePublishedContent(isPresenter ? documentId : undefined)
  // The browser refused the second window; the presenter is told, with what to do about it.
  const [blocked, setBlocked] = useState(false)

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

  // Moves this window, and only this one: what the other window told it to do ends here.
  const moveTo = useCallback(
    (next: number, entry: SlideEntry = 'top') => {
      arriving.current = entry
      void navigate({
        to: '.',
        search: (previous) => ({ ...previous, step: next + 1 }),
        replace: true,
        // Where the new slide starts is this route's to say (`enterSlide`), not the router's, which
        // would put the page back at its top after the slide had been placed.
        resetScroll: false,
      })
    },
    [navigate],
  )

  // Whether the room's screen is black. Both windows have it: the presenter blanks the room from
  // either, and the audience window is the one that draws it (ADR-050).
  const [blank, setBlank] = useState(false)

  // What is open in each slide, kept here so it survives a slide being drawn again and can be told
  // to a window that opens late.
  const [details] = useState(createDetailsStore)

  const sync = usePresentSync({
    documentId,
    role: isPresenter ? 'presenter' : 'audience',
    revision,
    index,
    blank,
    onFollow: moveTo,
    onBlank: setBlank,
    onDetails: details.remember,
    openedDetails: details.remembered,
    onClosePresenter: () => {
      window.close()
    },
  })

  // What a person opens or folds in one window is opened or folded in the other.
  useShareDetails(details, sync.announceDetails)

  // Moves this window and tells the other, which follows it.
  const goTo = useCallback(
    (next: number, entry: SlideEntry = 'top') => {
      moveTo(next, entry)
      sync.announce(next, entry)
    },
    [moveTo, sync],
  )

  /** Blanks the room's screen, or brings it back, here and in the other window. */
  const blankTo = useCallback(
    (next: boolean) => {
      setBlank(next)
      sync.announceBlank(next)
    },
    [sync],
  )

  const dispatch = useCallback(
    (event: StepEvent, entry: SlideEntry = 'top') => {
      // Going on from a black screen brings the room back to the section it was on, and goes on.
      if (blank) blankTo(false)
      const next = presentReducer({ index, count }, event)
      if (next.index !== index) goTo(next.index, entry)
    },
    [index, count, goTo, blank, blankTo],
  )

  // The scroll wheel is a remote too: a turn forward is the next section, unless something under
  // the pointer (the notes, a tall section) still has room to scroll. Going back arrives at the
  // foot of the previous section, so scrolling on up reads it from the end.
  useWheelStep((direction) => {
    dispatch({ type: direction }, direction === 'previous' ? 'bottom' : 'top')
  }, !goToOpen)

  /** Opens the other window of this presentation, or brings it forward when it is already there. */
  const openWindow = useCallback(
    (role: 'audience' | 'presenter') => {
      const href = router.buildLocation({
        to: '/w/$workspaceSlug/d/$documentId/present',
        params: { workspaceSlug, documentId },
        search: {
          step: index + 1,
          ...(role === 'presenter' ? { view: 'presenter' as const } : {}),
        },
      }).href
      const opened = window.open(
        href,
        `${BRAND.slug}-present-${role}-${documentId}`,
        role === 'presenter' ? 'popup,width=1280,height=800' : undefined,
      )
      setBlocked(opened === null)
    },
    [router, workspaceSlug, documentId, index],
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

  /* Synchronises with the window's keyboard. A presentation is driven from a
     remote or from the keyboard with nothing in particular focused, so the
     window is where the keys arrive; while the go-to overlay is open it owns
     them instead, and this does not listen at all. */
  useEffect(() => {
    if (goToOpen) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      // A key that is the focused control's, or the picture viewer's, is not a step.
      if (targetOwnsKey(event.target, event.key)) return
      const command = commandForKey(event)
      if (command === undefined) return
      event.preventDefault()
      if (command.kind === 'step') dispatch(command.event)
      else if (command.kind === 'scroll') {
        // Down and up are one surface made of slides: scroll this one while there is more of it,
        // then arrive at the top of the next, or the foot of the previous.
        const forward = command.direction === 'forward'
        const scrolled = scrollSlide(slideScroller(), command.direction, command.distance)
        // A held key keeps scrolling, but never runs on through the deck.
        if (!scrolled && !command.repeat) {
          dispatch({ type: forward ? 'next' : 'previous' }, forward ? 'top' : 'bottom')
        }
      } else if (command.kind === 'blank') blankTo(!blank)
      else if (command.kind === 'exit') {
        // Escape first brings a black screen back, as it does in every presenting tool.
        if (blank) blankTo(false)
        else if (isPresenter) window.close()
        else leave()
      } else if (command.kind === 'go-to') setGoToOpen(true)
      // The presenter window is where the presenter view already is.
      else if (!isPresenter) openWindow('presenter')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goToOpen, dispatch, leave, openWindow, isPresenter, blank, blankTo])

  /* Synchronises with the DOM's focus, which React does not render: a new
     step has to put the keyboard inside the section it just showed, or the
     next Tab starts from wherever the last one left off. */
  useEffect(() => {
    if (current === undefined) return undefined
    // Without scrolling to it: where the slide starts is what the person arrived from, said next.
    globalThis.document.getElementById(`present-step-${index}`)?.focus({ preventScroll: true })
    const stopWatching = enterSlide(arriving.current)
    arriving.current = 'top'
    return stopWatching
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

  if (isPresenter) {
    return (
      <PresenterView
        documentTitle={title}
        workspaceSlug={workspaceSlug}
        documentId={documentId}
        steps={steps}
        index={index}
        onSlideDrawn={details.draw}
        notes={notes}
        notesPending={notesQuery.isPending}
        peer={sync.peer}
        blank={blank}
        onToggleBlank={() => {
          blankTo(!blank)
        }}
        goToOpen={goToOpen}
        onStep={(event) => {
          dispatch({ type: event })
        }}
        onGoTo={goTo}
        onToggleGoTo={setGoToOpen}
        onOpenAudience={() => {
          openWindow('audience')
        }}
        blocked={blocked}
      />
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
              data-step={position}
              tabIndex={-1}
              aria-label={section.title}
              hidden={position !== index}
              className={styles.step()}
            >
              <DocumentBody
                html={section.html}
                label={section.title}
                onMounted={details.draw}
                onFollowLink={followLink}
                loadLinks={loadLinks}
              />
            </section>
          ),
        )}
      </main>

      {/* The step change itself, in words, for anyone who cannot see it happen. */}
      <p aria-live="polite" className="sr-only">
        {`Section ${index + 1} of ${count}: ${current?.title ?? ''}`}
      </p>

      <PresentRail
        items={steps}
        currentIndex={index}
        onSelect={(selected) => {
          goTo(selected)
        }}
      />

      <PresentBar title={title} position={`${index + 1} of ${count}`} idle={idle && !goToOpen}>
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
        <PresentHint keys={<PresentKey>P</PresentKey>}>Presenter view</PresentHint>
        <PresentHint keys={<PresentKey>G</PresentKey>}>Go to</PresentHint>
        <PresentHint keys={<PresentKey>B</PresentKey>}>Black screen</PresentHint>
        {/* Which way this is being presented, said and chosen in one place (ADR-050). */}
        <div role="group" aria-label="Presenting from" className="inline-flex items-center gap-1">
          <Button
            size="sm"
            variant={sync.peer === 'alone' ? 'secondary' : 'ghost'}
            aria-pressed={sync.peer === 'alone'}
            onClick={sync.closePresenter}
          >
            Single window
          </Button>
          <Button
            size="sm"
            variant={sync.peer === 'alone' ? 'ghost' : 'secondary'}
            aria-pressed={sync.peer !== 'alone'}
            onClick={() => {
              openWindow('presenter')
            }}
          >
            {sync.peer === 'alone' ? 'Presenter view' : 'Presenter view open'}
          </Button>
        </div>
        {blocked ? (
          <span role="alert" className="text-2xs text-warning">
            Your browser blocked the window. Allow pop-ups for this site.
          </span>
        ) : undefined}
        {sync.peer === 'other-revision' ? (
          <span className="text-2xs text-warning">The presenter window shows another version.</span>
        ) : undefined}
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

      {/* Said in words for anyone who cannot see the room's screen go dark (or come back). */}
      <p role="status" className="sr-only">
        {blank ? 'Screen blanked. Press B, Escape or any key to bring it back.' : ''}
      </p>
      {blank ? (
        <button
          type="button"
          aria-label="Bring the screen back"
          className="fixed inset-0 z-50 cursor-none bg-black"
          onClick={() => {
            blankTo(false)
          }}
        />
      ) : undefined}

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
