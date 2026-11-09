import { useId, useState } from 'react'

import { Button, CopyIcon, Input } from '@quill/ui'

/**
 * An address a person copies somewhere else — a webhook's, a repository's — as
 * a read-only field and a Copy button, the way a new share link is shown
 * (`share-link-address.tsx`). The field keeps the address on one line and
 * scrolls inside itself, so a long address never breaks mid-word or widens the
 * page; it can be focused and selected by keyboard on a browser that refuses
 * the clipboard, which is what the button says when it is refused.
 */

type CopyState = 'idle' | 'copied' | 'failed'

const COPY_MESSAGE: Readonly<Record<CopyState, string>> = {
  idle: '',
  copied: 'Copied.',
  failed: 'Copying was refused by the browser. Select the address and copy it.',
}

export function CopyableAddress({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  const [state, setState] = useState<CopyState>('idle')
  const statusId = useId()

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-end gap-2">
        <Input
          label={label}
          className="min-w-0 grow"
          readOnly
          value={value}
          aria-describedby={statusId}
          onFocus={(event) => {
            event.currentTarget.select()
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          iconStart={<CopyIcon />}
          aria-label={`Copy the ${label.toLowerCase()}`}
          onClick={() => {
            void copy()
          }}
        >
          Copy
        </Button>
      </div>
      <p id={statusId} role="status" className="text-2xs text-muted empty:hidden">
        {COPY_MESSAGE[state]}
      </p>
    </div>
  )
}
