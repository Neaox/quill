import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { newId } from '../../../lib/ids/new-id.ts'
import {
  createPresentChannel,
  type ChannelFactory,
  type PresentChannel,
  type PresentEnvelope,
  type PresentRole,
} from './present-channel.ts'
import type { SlideEntry } from './present-state.ts'

/**
 * Whether the other window of a presentation is there, and on the same deck.
 *
 * `alone` is the single-window presentation; `following` is both windows open and on the same
 * revision; `other-revision` is the other window showing a different version of the document,
 * which is said rather than shown as if it were the same deck.
 */
export type PeerState = 'alone' | 'following' | 'other-revision'

export interface PresentSyncOptions {
  readonly documentId: string
  /** Which window this is. The other role is the peer. */
  readonly role: PresentRole
  /** The revision on screen: windows on different ones are not following the same deck. */
  readonly revision: string
  /** The step this window is on, counted from zero. */
  readonly index: number
  /** Whether the room's screen is black, as this window has it. */
  readonly blank: boolean
  /** The other window moved: go there. Not announced again, which is what ends an echo. */
  readonly onFollow: (index: number, entry: SlideEntry) => void
  /** The other window blanked the room's screen, or brought it back. */
  readonly onBlank: (blank: boolean) => void
  /** The other window opened or folded a section of a slide. */
  readonly onDetails: (step: number, open: readonly boolean[]) => void
  /** What this window has been told is open, to tell a window that has just arrived. */
  readonly openedDetails: () => ReadonlyMap<number, readonly boolean[]>
  /** The presenter window was asked to close. */
  readonly onClosePresenter?: (() => void) | undefined
  /** Stands in for `BroadcastChannel` in a test. */
  readonly channelFactory?: ChannelFactory | undefined
}

export interface PresentSync {
  readonly peer: PeerState
  /** This window moved: tell the other, and which end of the slide it arrived at. */
  readonly announce: (index: number, entry?: SlideEntry) => void
  /** This window blanked the room's screen, or brought it back: tell the other. */
  readonly announceBlank: (blank: boolean) => void
  /** This window opened or folded a section of a slide: tell the other. */
  readonly announceDetails: (step: number, open: readonly boolean[]) => void
  /** Ask the presenter window to close (from the audience window, going back to a single window). */
  readonly closePresenter: () => void
}

/** A name for this window on the channel: unique among every window that has this document open. */
const newWindowId = (role: PresentRole): string => `${role}-${newId()}`

/**
 * Two windows of one presentation, kept on the same step (ADR-050).
 *
 * The channel is the external system this synchronises with, so it is opened and closed in an
 * effect; everything else is event handlers. A window that has just opened says `hello` and is
 * answered with the step the room is on; a window whose step changed says so (`announce`), and one
 * that hears it goes there without announcing it back.
 */
export function usePresentSync({
  documentId,
  role,
  revision,
  index,
  blank,
  onFollow,
  onBlank,
  onDetails,
  openedDetails,
  onClosePresenter,
  channelFactory,
}: PresentSyncOptions): PresentSync {
  const [peer, setPeer] = useState<PeerState>('alone')
  const channel = useRef<PresentChannel | undefined>(undefined)

  const hear = useEffectEvent((message: PresentEnvelope) => {
    switch (message.type) {
      case 'hello': {
        setPeer(message.revision === revision ? 'following' : 'other-revision')
        // The newcomer joins where this window is: it asks nothing, it is told.
        channel.current?.post({ type: 'step', index, revision })
        // …and sees what the room sees, black or not.
        if (blank) channel.current?.post({ type: 'blank', blank })
        // …and which sections the room has opened.
        for (const [step, open] of openedDetails()) {
          channel.current?.post({ type: 'details', step, revision, open })
        }
        break
      }
      case 'blank': {
        onBlank(message.blank)
        break
      }
      case 'step': {
        if (message.revision !== revision) {
          setPeer('other-revision')
          break
        }
        setPeer('following')
        if (message.index !== index) onFollow(message.index, message.entry ?? 'top')
        break
      }
      case 'details': {
        // A window on another version of the document has other sections at those places.
        if (message.revision === revision) onDetails(message.step, message.open)
        break
      }
      case 'close-presenter': {
        if (role === 'presenter') onClosePresenter?.()
        break
      }
      case 'bye': {
        setPeer('alone')
        break
      }
    }
  })

  const greet = useEffectEvent(() => {
    channel.current?.post({ type: 'hello', role, index, revision })
  })

  // Synchronises with the channel to the other window, which is a browser resource: opened with the
  // window's arrival, announced on, and closed with its departure.
  useEffect(() => {
    const opened = createPresentChannel(documentId, newWindowId(role), channelFactory)
    channel.current = opened
    const stop = opened.subscribe(hear)
    const leave = (): void => {
      opened.post({ type: 'bye', role })
    }
    greet()
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      leave()
      stop()
      opened.close()
      channel.current = undefined
    }
  }, [documentId, role, channelFactory])

  const announce = useCallback(
    (next: number, entry: SlideEntry = 'top') => {
      channel.current?.post({ type: 'step', index: next, revision, entry })
    },
    [revision],
  )
  const announceBlank = useCallback((next: boolean) => {
    channel.current?.post({ type: 'blank', blank: next })
  }, [])
  const announceDetails = useCallback(
    (step: number, open: readonly boolean[]) => {
      channel.current?.post({ type: 'details', step, revision, open })
    },
    [revision],
  )
  const closePresenter = useCallback(() => {
    channel.current?.post({ type: 'close-presenter' })
  }, [])

  // Stable while nothing about the pairing changes: what drives the keyboard depends on it, and a
  // listener that is replaced on every render can be removed in the middle of the very key press
  // that caused the render, so the press is lost.
  return useMemo(
    () => ({ peer, announce, announceBlank, announceDetails, closePresenter }),
    [peer, announce, announceBlank, announceDetails, closePresenter],
  )
}
