import { useState, type FormEvent } from 'react'

import { Button, Dialog, Input } from '@quill/ui'

/**
 * What a new draw.io diagram shows, asked before the editor opens (ADR-043).
 *
 * A diagram is an image in the document, and an image nobody can read is not
 * a document, so its alternative text is asked for first, as the image dialog
 * asks for a picture's. It also names the file the diagram is saved as.
 */

const FORM_ID = 'describe-diagram'

export interface DescribeDiagramDialogProps {
  readonly open: boolean
  onCancel(): void
  onSubmit(description: string): void
}

export function DescribeDiagramDialog({ open, onCancel, onSubmit }: DescribeDiagramDialogProps) {
  const [description, setDescription] = useState('')
  const ready = description.trim() !== ''

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    onSubmit(description.trim())
    setDescription('')
  }

  return (
    <Dialog
      title="New draw.io diagram"
      description="Describe it, then draw it in the draw.io editor."
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={!ready}>
            Open the editor
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} noValidate>
        <Input
          label="What the diagram shows"
          name="description"
          required
          description="Read by anyone who cannot see the diagram, and used to name its file."
          placeholder="How a payment moves from checkout to the ledger"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value)
          }}
        />
      </form>
    </Dialog>
  )
}
