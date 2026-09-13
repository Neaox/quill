import { useState } from 'react'

import { Button, Callout, CopyIcon, Input, tv } from '@quill/ui'

import type { ShareLinkScope } from '../../lib/api/index.ts'

/**
 * The address a link was just created at, the once it is ever shown.
 *
 * `POST /documents/:id/share-links` is the only response that carries the raw
 * token — only its SHA-256 is stored, so no later request by anybody holding
 * any permission can produce it again
 * (`docs/architecture/api-contract-share-links.md`). The warning beside it is
 * therefore a statement of what the system is, not a caution: a link lost
 * here is revoked and made again, never recovered.
 *
 * The address is a read-only field rather than a line of text so that it can
 * be focused, selected, and copied by keyboard on a browser that refuses the
 * clipboard API — which is also what the copy control falls back to saying.
 */

const styles = tv({
  slots: {
    row: 'flex items-end gap-2',
    field: 'grow',
    status: 'text-2xs text-muted',
  },
})()

export interface ShareLinkAddressProps {
  readonly url: string
  readonly scope: ShareLinkScope
}

type CopyState = 'idle' | 'copied' | 'failed'

const COPY_MESSAGE: Readonly<Record<CopyState, string>> = {
  idle: '',
  copied: 'Link copied to the clipboard.',
  failed: 'Copying was refused by the browser. Select the address and copy it.',
}

export function ShareLinkAddress({ url, scope }: ShareLinkAddressProps) {
  const [state, setState] = useState<CopyState>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <Callout tone="success" title="Link created">
      <p>
        Copy it now: this is the only time it is shown. It opens{' '}
        {scope === 'subtree' ? 'this document and everything under it' : 'this document'} for anyone
        who has it.
      </p>
      <div className={styles.row()}>
        <Input
          label="Share link"
          className={styles.field()}
          readOnly
          value={url}
          onFocus={(event) => {
            event.currentTarget.select()
          }}
        />
        <Button
          variant="secondary"
          iconStart={<CopyIcon />}
          onClick={() => {
            void copy()
          }}
        >
          Copy
        </Button>
      </div>
      <p role="status" className={styles.status()}>
        {COPY_MESSAGE[state]}
      </p>
    </Callout>
  )
}
