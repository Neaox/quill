/**
 * Animated images, played briefly (ADR-047, "Animation: brief, stoppable,
 * and never for those who ask for none"): what a page does for an animated
 * emoji once it has loaded.
 *
 * The renderer draws one as a `<picture class="emoji">` whose `<source>`
 * offers its still under `(prefers-reduced-motion: reduce)`, and carries its
 * frame count and loop length as `data-frames` and `data-loop-ms`
 * (`@quill/markdown`, `emojiElement`). That alone is the reduced-motion rule,
 * with no script: a reader who asks for less motion is shown the still by the
 * browser, and nothing here ever overrides it. Without this script, everyone
 * else sees the animation as the file says, and the file itself stops after
 * three plays (ADR-047, "Bounded in the file too").
 *
 * With it, the picture is swapped between its animation and its still by
 * changing which readers its `<source>` applies to — the reduced-motion query
 * while it plays, everyone while it rests — so the still is the same image,
 * at the same size (`width` and `height` stay fixed), and nothing shifts:
 *
 * - **It plays when it first comes into view**, for at most five seconds or
 *   three loops, whichever is shorter, then rests on its still: a poster
 *   frame chosen at upload, never the last frame (WCAG 2.2.2).
 * - **It plays again on hover, on focus of what holds it, or on a tap**,
 *   with the same limit each time. Focus on the enhanced root itself does
 *   not count: an editor is focused all the while it is written in.
 * - **It is paused while off-screen**, through one IntersectionObserver for
 *   the page, **and while the page is hidden**, and plays out what was left
 *   of its turn when it is back.
 * - **The person's setting** — play briefly, on hover only, or never — is
 *   read from `data-animated-images` on the document element, where the
 *   application and the public site's script put it. Reduced motion always
 *   wins over it.
 *
 * An animation with no still — an animated WebP or AVIF, until ADR-047's
 * image pipeline derives theirs — is drawn as a bare `<img>`, which this
 * leaves alone: it plays as it was uploaded.
 *
 * Pictures drawn after this starts (the editor's emoji, which come and go as
 * the document is written) are taken up as they arrive and let go of as they
 * leave.
 */

/** Where the person's setting is read from, on the document element. */
export const ANIMATED_IMAGES_ATTRIBUTE = 'data-animated-images'

/** The person's setting: play briefly (the default), on hover only, or never. */
export const ANIMATED_IMAGE_PREFERENCES = ['brief', 'hover', 'never'] as const
export type AnimatedImagesPreference = (typeof ANIMATED_IMAGE_PREFERENCES)[number]

/** The longest a play may run: WCAG 2.2.2's five seconds. */
export const BRIEF_PLAY_MILLISECONDS = 5000
/** The most loops a play may run, when they are shorter than five seconds. */
export const BRIEF_PLAY_LOOPS = 3

/** `@quill/markdown`'s, restated so the reader's bundle does not take the pipeline with it. */
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const LOOP_ATTRIBUTE = 'data-loop-ms'
/** The still is offered to every reader while the animation rests. */
const EVERYONE = 'all'
const SELECTOR = 'picture.emoji'

interface Animated {
  readonly picture: Element
  readonly source: HTMLSourceElement
  /** How long one play may run. */
  readonly limit: number
  readonly root: Element | Document
  inView: boolean
  /** Whether it has entered view once, which is when it plays unasked. */
  seen: boolean
  /** What is left of its current turn, in milliseconds of the page's monotonic clock; nought while it rests. */
  remaining: number
  startedAt: number
  timer: ReturnType<typeof setTimeout> | undefined
}

/** How long one play of a picture may run: five seconds, or three loops when they are shorter. */
function playLimit(picture: Element): number {
  const loop = Number(picture.getAttribute(LOOP_ATTRIBUTE))
  return Number.isInteger(loop) && loop > 0
    ? Math.min(BRIEF_PLAY_MILLISECONDS, BRIEF_PLAY_LOOPS * loop)
    : BRIEF_PLAY_MILLISECONDS
}

/** The source a picture offers its still through, if it is an animated emoji with one. */
function stillSource(picture: Element): HTMLSourceElement | undefined {
  const source = picture.querySelector(':scope > source')
  return source instanceof HTMLSourceElement &&
    source.getAttribute('media') === REDUCED_MOTION &&
    source.hasAttribute('srcset')
    ? source
    : undefined
}

function picturesIn(node: Node): Element[] {
  if (!(node instanceof Element)) return []
  return [...(node.matches(SELECTOR) ? [node] : []), ...node.querySelectorAll(SELECTOR)]
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches
}

function preferenceOf(document: Document): AnimatedImagesPreference {
  const stated = document.documentElement.getAttribute(ANIMATED_IMAGES_ATTRIBUTE)
  return ANIMATED_IMAGE_PREFERENCES.find((choice) => choice === stated) ?? 'brief'
}

/**
 * What one page shares however many places are enhanced: one
 * IntersectionObserver, one watch on the page's visibility and the person's
 * setting, and every animation being played.
 */
interface Player {
  readonly animated: Map<Element, Animated>
  readonly register: (picture: Element, root: Element | Document) => void
  readonly unregister: (item: Animated) => void
  readonly request: (item: Animated) => void
  readonly release: () => void
  roots: number
}

const players = new WeakMap<Document, Player>()

function stopTimer(item: Animated): void {
  if (item.timer === undefined) return
  clearTimeout(item.timer)
  item.timer = undefined
}

function createPlayer(document: Document): Player {
  const animated = new Map<Element, Animated>()
  const hidden = () => document.visibilityState === 'hidden'

  const show = (item: Animated, playing: boolean) => {
    item.source.setAttribute('media', playing ? REDUCED_MOTION : EVERYONE)
    item.picture.setAttribute('data-state', playing ? 'playing' : 'resting')
  }

  /** Plays what is left of its turn, if it is in view on a page being looked at. */
  const resume = (item: Animated) => {
    if (item.remaining <= 0 || item.timer !== undefined || !item.inView || hidden()) return
    item.startedAt = performance.now()
    item.timer = setTimeout(() => {
      item.timer = undefined
      item.remaining = 0
      show(item, false)
    }, item.remaining)
    show(item, true)
  }

  /** Rests it on its still, keeping what is left of its turn. */
  const pause = (item: Animated) => {
    if (item.timer === undefined) return
    stopTimer(item)
    item.remaining -= performance.now() - item.startedAt
    show(item, false)
  }

  /** A new turn, of the whole limit, unless the reader has asked for none. */
  const request = (item: Animated) => {
    if (prefersReducedMotion() || preferenceOf(document) === 'never') return
    stopTimer(item)
    item.remaining = item.limit
    resume(item)
  }

  const enterView = (item: Animated) => {
    item.inView = true
    if (item.seen) {
      resume(item)
      return
    }
    item.seen = true
    if (preferenceOf(document) === 'brief') request(item)
    else resume(item)
  }

  const View = typeof IntersectionObserver === 'function' ? IntersectionObserver : undefined
  const observer = View
    ? new View((entries) => {
        for (const entry of entries) {
          const item = animated.get(entry.target)
          if (item === undefined) continue
          if (entry.isIntersecting) enterView(item)
          else {
            item.inView = false
            pause(item)
          }
        }
      })
    : undefined

  const onVisibility = () => {
    for (const item of animated.values()) {
      if (hidden()) pause(item)
      else resume(item)
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  // The person's setting can change under a page that is open: "never" stops
  // what is playing at once.
  const setting = new MutationObserver(() => {
    if (preferenceOf(document) !== 'never') return
    for (const item of animated.values()) {
      stopTimer(item)
      item.remaining = 0
      show(item, false)
    }
  })
  setting.observe(document.documentElement, { attributeFilter: [ANIMATED_IMAGES_ATTRIBUTE] })

  return {
    animated,
    roots: 0,
    request,
    register: (picture, root) => {
      const source = stillSource(picture)
      if (source === undefined || animated.has(picture)) return
      const item: Animated = {
        picture,
        source,
        limit: playLimit(picture),
        root,
        inView: false,
        seen: false,
        remaining: 0,
        startedAt: 0,
        timer: undefined,
      }
      animated.set(picture, item)
      show(item, false)
      if (observer === undefined) enterView(item)
      else observer.observe(picture)
    },
    unregister: (item) => {
      stopTimer(item)
      observer?.unobserve(item.picture)
      animated.delete(item.picture)
      item.source.setAttribute('media', REDUCED_MOTION)
      item.picture.removeAttribute('data-state')
    },
    release: () => {
      observer?.disconnect()
      setting.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}

function playerFor(document: Document): Player {
  const existing = players.get(document)
  if (existing !== undefined) return existing
  const player = createPlayer(document)
  players.set(document, player)
  return player
}

/**
 * Plays the animated emoji in `root` briefly, as above. Returns what gives
 * every picture back as it came and stops watching.
 */
export function enhanceAnimatedImages(root: Element | Document): () => void {
  const document = 'documentElement' in root ? root : root.ownerDocument
  const player = playerFor(document)
  player.roots += 1
  const mine = () => [...player.animated.values()].filter((item) => item.root === root)

  for (const picture of picturesIn('documentElement' in root ? root.documentElement : root)) {
    player.register(picture, root)
  }

  // A replay: hover and a tap on the picture, focus on anything that holds it.
  const onPointer = (event: Event) => {
    const picture = event.target instanceof Element ? event.target.closest(SELECTOR) : null
    const item = picture === null ? undefined : player.animated.get(picture)
    if (item !== undefined) player.request(item)
  }
  // Focus on the root itself is not focus on what holds a picture: an
  // editor is focused whenever it is written in, and holds every emoji.
  const onFocus = (event: Event) => {
    const focused = event.target
    for (const item of mine()) {
      if (focused !== root && focused instanceof Node && focused.contains(item.picture)) {
        player.request(item)
      }
    }
  }
  root.addEventListener('pointerover', onPointer)
  root.addEventListener('click', onPointer)
  root.addEventListener('focusin', onFocus)

  const arrivals = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        for (const picture of picturesIn(node)) player.register(picture, root)
      }
    }
    for (const item of mine()) if (!item.picture.isConnected) player.unregister(item)
  })
  arrivals.observe(root, { childList: true, subtree: true })

  return () => {
    arrivals.disconnect()
    root.removeEventListener('pointerover', onPointer)
    root.removeEventListener('click', onPointer)
    root.removeEventListener('focusin', onFocus)
    for (const item of mine()) player.unregister(item)
    player.roots -= 1
    if (player.roots > 0) return
    player.release()
    players.delete(document)
  }
}
