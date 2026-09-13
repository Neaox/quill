import type { ReactNode } from 'react'

import { BRAND } from '@quill/brand'
import { tv } from '@quill/ui'

import type { SharedLink } from '../../lib/api/index.ts'
import { revisionDate } from '../../lib/documents/revision-labels.ts'

/**
 * The frame around a document somebody was sent a link to
 * (`docs/product/surfaces.md`, "Share-link pages").
 *
 * Everything about this surface is decided by what must **never** appear on
 * it: no workspace switcher, no sidebar of other workspaces, no account menu,
 * no comment panel, no lock or presence, no sign-in wall, and no way out of
 * the link's scope. What is left is the site's name, the document, its
 * contents, and one line saying what the reader is holding — so the frame is
 * a header and nothing else, and it is written here rather than assembled
 * from the application's shell, which would keep carrying the things that are
 * forbidden.
 *
 * Light and dark follow the person's own preference with no control of their
 * own: `index.html` applies a remembered choice before first paint and the
 * stylesheet answers `prefers-color-scheme` otherwise, neither of which needs
 * a session.
 */

const styles = tv({
  slots: {
    root: 'flex min-h-dvh flex-col bg-background',
    header: [
      'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border',
      'px-5 py-3 md:px-8',
    ],
    brand: 'font-display text-sm font-semibold tracking-tight text-foreground',
    notice: 'meta text-muted',
    body: 'grow',
    noticeMain: 'mx-auto flex max-w-md grow flex-col justify-center gap-2 px-5 py-16 text-center',
    noticeTitle: 'text-xl font-semibold tracking-tight text-foreground',
    noticeBody: 'text-sm leading-relaxed text-muted',
  },
})()

export interface ShareChromeProps {
  /** The link's own terms: its scope, its role, and when it stops working. */
  readonly link: SharedLink
  readonly children: ReactNode
}

export function ShareChrome({ link, children }: ShareChromeProps) {
  return (
    <div className={styles.root()}>
      <header className={styles.header()}>
        <p className={styles.brand()}>{BRAND.name}</p>
        {/* The one fact about the link a reader needs: that they were given
            it, and for how long it lasts. */}
        <p className={styles.notice()}>
          Shared with you ·{' '}
          {link.expiresAt === null ? (
            'this link does not expire'
          ) : (
            <>
              expires <time dateTime={link.expiresAt}>{revisionDate(link.expiresAt)}</time>
            </>
          )}
        </p>
      </header>
      <div className={styles.body()}>{children}</div>
    </div>
  )
}

/**
 * The one thing this surface says when it cannot show a document.
 *
 * An unknown token, an expired link, a revoked one, a document outside the
 * link's scope, one with nothing published, and a document the platform
 * cannot place at all are a single identical `404` on the wire
 * (`docs/architecture/api-contract-share-links.md`), and they are a single
 * identical page here. Saying more would be the enumeration the token's
 * unguessability rests on not existing — and there is nowhere to send a
 * reader who has no account, so there is no way onwards to offer either.
 */
export function ShareUnavailableNotice() {
  return (
    <main className={styles.noticeMain()}>
      <h1 className={styles.noticeTitle()}>This link is not available</h1>
      <p className={styles.noticeBody()}>
        It may have expired, been revoked, or never have existed. Ask whoever sent it to you for a
        new one.
      </p>
    </main>
  )
}

/**
 * What the surface says when the *request* failed rather than the link.
 *
 * The refusal above is permanent and tells a reader to go and ask for a new
 * link; a `500` from a proxy, or a train going into a tunnel, is neither, and
 * saying so costs nothing — the server has already flattened every
 * authorization outcome into one `404` before anything reaches here, so there
 * is no reason left to be indistinguishable. What it still must not do is
 * offer a way into the application: for a stranger that is a sign-in wall in
 * front of content they were legitimately given.
 */
export function ShareUnavailableError() {
  return (
    <main className={styles.noticeMain()}>
      <h1 className={styles.noticeTitle()}>This page could not be loaded</h1>
      <p className={styles.noticeBody()}>
        Something went wrong on the way. Reload the page to try again; the link itself may be
        perfectly good.
      </p>
    </main>
  )
}

/**
 * Either notice as a whole page, for a failure that happened before there was
 * a link to put a header under: the site's name, and the one sentence. There
 * is no link out, because there is nowhere a reader with no account could be
 * sent.
 */
export function ShareNotAvailable() {
  return (
    <div className={styles.root()}>
      <header className={styles.header()}>
        <p className={styles.brand()}>{BRAND.name}</p>
      </header>
      <ShareUnavailableNotice />
    </div>
  )
}

export function ShareFailed() {
  return (
    <div className={styles.root()}>
      <header className={styles.header()}>
        <p className={styles.brand()}>{BRAND.name}</p>
      </header>
      <ShareUnavailableError />
    </div>
  )
}
