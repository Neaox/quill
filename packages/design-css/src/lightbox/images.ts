import { captionOf, openZoomable } from './lightbox.ts'
import type { Opened } from './lightbox.ts'

/**
 * Pictures that open in the lightbox.
 *
 * A picture in a document is drawn at the width of its column, which is often too small to read
 * what is in it, and in a window being shared it is smaller still. So a picture can open in the
 * viewer a diagram does, filling the screen, with the same zoom, pan and close. The picture is the
 * control: it is given the `button` role and a name that says what it does, is reached by Tab, and
 * opens on a click, Enter or Space. A copy is shown in the viewer, so the picture in the text is
 * where it was, and focus returns to it on close.
 *
 * Opt in, by the surface: a reader's page has no need of it, and a presenter's does. A picture that
 * is a link goes where it links, an emoji is text, and a diagram has its own viewer.
 */

/** A picture clearly wider than tall, which a phone is better turned for. */
const WIDE_RATIO = 1.25

const LEFT_ALONE = 'a, button, .diagram, .lightbox, [role]'

function isWide(image: HTMLImageElement): boolean {
  const width = image.naturalWidth || Number(image.getAttribute('width'))
  const height = image.naturalHeight || Number(image.getAttribute('height'))
  return height > 0 && width / height >= WIDE_RATIO
}

function open(image: HTMLImageElement): Opened {
  const doc = image.ownerDocument
  const picture = doc.createElement('img')
  const source = image.currentSrc === '' ? image.getAttribute('src') : image.currentSrc
  if (source !== null) picture.src = source
  picture.alt = image.alt
  const frame = doc.createElement('div')
  frame.className = 'lightbox-picture'
  frame.append(picture)
  const caption = captionOf(image.closest('figure') ?? image)
  return openZoomable(doc, {
    label: caption ?? (image.alt === '' ? 'Image' : image.alt),
    caption,
    frame,
    wide: isWide(image),
    trigger: image,
  })
}

/**
 * Makes each picture under `root` open in the lightbox. Returns what takes it away again, closing
 * an open lightbox first.
 */
export function enhanceImages(root: ParentNode): () => void {
  const undo: (() => void)[] = []
  let opened: Opened | null = null

  for (const image of root.querySelectorAll<HTMLImageElement>('img:not(.emoji)')) {
    if (image.closest(LEFT_ALONE) !== null || image.hasAttribute('data-expandable')) continue
    const show = (): void => {
      opened = open(image)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      // Space scrolls the page, which is not what pressing a button means.
      event.preventDefault()
      show()
    }
    image.setAttribute('role', 'button')
    image.setAttribute('aria-label', image.alt === '' ? 'Open image' : `Open image: ${image.alt}`)
    image.tabIndex = 0
    image.dataset['expandable'] = 'true'
    image.addEventListener('click', show)
    image.addEventListener('keydown', onKey)
    undo.push(() => {
      image.removeEventListener('click', show)
      image.removeEventListener('keydown', onKey)
      for (const name of ['role', 'aria-label', 'tabindex', 'data-expandable']) {
        image.removeAttribute(name)
      }
    })
  }

  return () => {
    if (opened?.dialog.isConnected === true) opened.close()
    for (const step of undo) step()
  }
}
