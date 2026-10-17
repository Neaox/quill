import {
  AnchoredPopover,
  Button,
  Combobox,
  CopyIcon,
  ExternalIcon,
  Input,
  UnlinkIcon,
} from '@quill/ui'
import type { ListboxGroup } from '@quill/ui'
import type { Editor } from '@tiptap/react'
import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { tv } from 'tailwind-variants'

import type { ContextMenuEnvironment } from '../context-menu/context-menu-registry.ts'
import type { LinkOverlay, OverlayStore } from '../context-menu/overlay-store.ts'
import type { DocumentLinkTarget } from '../slash/slash-item.ts'
import { applyLink, documentHref, linkAt, normaliseHref, unlink } from './link-commands.ts'

/**
 * Making and editing a link (Ctrl+K, the toolbar's Link, the link card's Edit).
 *
 * One field takes either an address or words to find a document by: what is
 * typed is offered as an address, and the application's document search
 * answers under it, so linking to another page is typing its title. A
 * document is linked by its id (`/d/<id>`, AGENTS.md rule 8). The link's
 * words are a field of their own, so a bare address need not be what the
 * reader sees. An existing link can be opened, copied or taken off from here
 * too, so the keyboard reaches everything the pointer's link card offers.
 */

const styles = tv({
  slots: {
    form: 'flex flex-col gap-3',
    actions: 'flex flex-wrap items-center gap-1.5',
    end: 'ms-auto',
  },
})()

/** How long typing rests before the document search is asked. */
export const LINK_SEARCH_DELAY_MS = 150

const ADDRESS_OPTION = 'address'

export interface LinkPopoverProps {
  readonly editor: Editor
  readonly overlay: LinkOverlay
  readonly store: OverlayStore
  readonly environment: ContextMenuEnvironment
  searchDocuments?(query: string, signal: AbortSignal): Promise<readonly DocumentLinkTarget[]>
}

/** Whether what was typed is an address, rather than words to find a document by. */
export function looksLikeAddress(typed: string): boolean {
  const value = typed.trim()
  return normaliseHref(value) !== value || /^([a-z][a-z\d+.-]*:|\/|#)/i.test(value)
}

interface Answer {
  readonly query: string
  readonly targets: readonly DocumentLinkTarget[]
}

export function LinkPopover({
  editor,
  overlay,
  store,
  environment,
  searchDocuments,
}: LinkPopoverProps) {
  const id = useId()
  const existing = linkAt(editor.state, overlay.from)
  const editing =
    existing !== undefined && existing.from <= overlay.from && existing.to >= overlay.to
  const [address, setAddress] = useState(editing ? existing.href : '')
  const [text, setText] = useState(() =>
    editing ? existing.text : editor.state.doc.textBetween(overlay.from, overlay.to, ' '),
  )
  const [answer, setAnswer] = useState<Answer>({ query: '', targets: [] })
  const [error, setError] = useState<string | undefined>(undefined)
  const range = editing ? existing : overlay
  const searchable =
    searchDocuments !== undefined && address.trim() !== '' && !looksLikeAddress(address)
  // What the search said about what is typed now; an answer to older words is not one.
  const found = searchable && answer.query === address ? answer.targets : []
  const searching = searchable && answer.query !== address

  // Asks the application's search — a request, an external system — once
  // typing rests, abandoning an answer the next keystroke has made stale.
  useEffect(() => {
    if (!searchable) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const settle = (targets: readonly DocumentLinkTarget[]): void => {
        if (!controller.signal.aborted) setAnswer({ query: address, targets })
      }
      searchDocuments(address, controller.signal).then(settle, () => {
        settle([])
      })
    }, LINK_SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [address, searchable, searchDocuments])

  const close = (): void => {
    store.close()
  }

  const link = (href: string, words: string): void => {
    // Only ever an address or a document's: never empty, so it always applies.
    applyLink({ from: range.from, to: range.to, href, text: words })(
      editor.state,
      editor.view.dispatch,
    )
    close()
  }

  const typedAddress = looksLikeAddress(address) ? normaliseHref(address) : ''

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (typedAddress === '') {
      setError('Paste an address, or choose a document from the list')
      return
    }
    link(typedAddress, text)
  }

  const groups: ListboxGroup[] = [
    ...(typedAddress === ''
      ? []
      : [
          {
            id: 'address',
            label: 'Address',
            options: [{ id: ADDRESS_OPTION, label: `Link to ${typedAddress}` }],
          },
        ]),
    ...(found.length === 0
      ? []
      : [
          {
            id: 'documents',
            label: 'Documents',
            options: found.map((target) => ({
              id: target.id,
              label: target.title,
              ...(target.context === undefined ? {} : { detail: target.context }),
            })),
          },
        ]),
  ]

  const choose = (optionId: string): void => {
    if (optionId === ADDRESS_OPTION) {
      link(typedAddress, text)
      return
    }
    for (const target of found) {
      if (target.id === optionId) link(documentHref(target.id), text === '' ? target.title : text)
    }
  }

  return (
    <AnchoredPopover
      open
      anchor={overlay.anchor}
      label={editing ? 'Edit link' : 'Add link'}
      onOpenChange={close}
      onCloseFocus={() => {
        if (!editor.isDestroyed) editor.view.focus()
      }}
    >
      <form className={styles.form()} onSubmit={submit} aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="sr-only">
          {editing ? 'Edit link' : 'Add link'}
        </h2>
        <Combobox
          label="Link to"
          placeholder="Paste an address or find a document"
          value={address}
          onValueChange={(value) => {
            setAddress(value)
            setError(undefined)
          }}
          groups={groups}
          onSelect={choose}
          busy={searching}
          opens="on-request"
          error={error}
          status={
            searching
              ? undefined
              : found.length === 0
                ? undefined
                : `${String(found.length)} documents`
          }
          onDismiss={close}
        />
        <Input
          label="Text"
          value={text}
          placeholder="What the link reads as"
          onChange={(event) => {
            setText(event.target.value)
          }}
        />
        <div className={styles.actions()}>
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                iconStart={<ExternalIcon />}
                onClick={() => {
                  environment.openLink?.(existing.href)
                }}
                disabled={environment.openLink === undefined}
              >
                Open
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconStart={<CopyIcon />}
                onClick={() => {
                  void environment.copyText?.(existing.href)
                }}
                disabled={environment.copyText === undefined}
              >
                Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconStart={<UnlinkIcon />}
                onClick={() => {
                  unlink(existing.from, existing.to)(editor.state, editor.view.dispatch)
                  close()
                }}
              >
                Unlink
              </Button>
            </>
          ) : null}
          <Button type="submit" size="sm" className={styles.end()}>
            {editing ? 'Save' : 'Link'}
          </Button>
        </div>
      </form>
    </AnchoredPopover>
  )
}
