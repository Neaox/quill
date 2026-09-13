import { useState, type FormEvent } from 'react'

import { Button, Dialog, Input } from '@quill/ui'

export interface ImageUrlDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** Called with the trimmed address when the form is submitted. */
  readonly onSubmit: (source: string) => void
}

/**
 * Where an image comes from, asked properly.
 *
 * The slash menu asks for an address rather than inserting a broken image;
 * uploads arrive with the attachment client. Until then this is the honest
 * question — a labelled field in the product's own `Dialog`, which traps
 * focus, closes on Escape, restores focus to the editor, and is styled and
 * announced like every other dialog, rather than `window.prompt`'s unlabelled,
 * unstyled, browser-chrome box that some browsers suppress outright.
 */
export function ImageUrlDialog({ open, onOpenChange, onSubmit }: ImageUrlDialogProps) {
  const [source, setSource] = useState('')

  function close() {
    onOpenChange(false)
    setSource('')
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = source.trim()
    if (trimmed === '') return
    onSubmit(trimmed)
    close()
  }

  return (
    <Dialog
      title="Insert an image"
      description="Paste the address of an image on the web. Uploading your own files is not built yet."
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="insert-image-form" disabled={source.trim() === ''}>
            Insert
          </Button>
        </>
      }
    >
      <form id="insert-image-form" onSubmit={handleSubmit} noValidate>
        <Input
          label="Image address"
          name="source"
          type="url"
          required
          placeholder="https://example.com/diagram.png"
          value={source}
          onChange={(event) => {
            setSource(event.target.value)
          }}
        />
      </form>
    </Dialog>
  )
}
