import { useState, type FormEvent } from 'react'

import { Button, Dialog, Input, tv } from '@quill/ui'

import { FormError } from '../../lib/forms/form-error.tsx'

/**
 * Where an image comes from, asked properly.
 *
 * Two sources and one question. A file is uploaded and becomes an attachment
 * (ADR-011); an address is used as it stands, which is still the right answer
 * for a picture that already lives somewhere. Both are on the one form rather
 * than behind a pair of tabs: there are two fields, the labels say which is
 * which, and a tab set would add an interaction — and a whole primitive — for
 * a choice the fields already make.
 *
 * Either way the dialog insists on alternative text before it will insert
 * anything, because an image nobody can read is not a document. That field is
 * what both sources share, so it is asked once, last.
 *
 * The dialog holds no request of its own: the route owns the upload and passes
 * back whether it is in flight and how it failed. Insert is the control that
 * starts the work and so is the control that shows it
 * (`docs/design/feedback.md`).
 */

export const imageDialogStyles = tv({
  slots: {
    form: 'flex flex-col gap-4',
    chosen: 'text-xs text-muted aria-[invalid=true]:text-danger',
    /** The "or" between the two sources, as a rule with a word in it. */
    divider: 'flex items-center gap-3 text-2xs tracking-caps text-muted uppercase',
    rule: 'h-px grow bg-border',
  },
})

export type ImageRequest =
  | { readonly kind: 'upload'; readonly file: File; readonly alt: string }
  | { readonly kind: 'link'; readonly url: string; readonly alt: string }

export interface ImageDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /**
   * The server's size cap, so a file that cannot be accepted is refused here
   * rather than after it has been sent. A courtesy, not the rule: the server
   * counts the bytes as they arrive and is the one that decides.
   */
  readonly maxBytes: number
  /**
   * A file dragged onto the document or pasted into it. Its presence opens the
   * dialog with that file already chosen, so the only thing left to do is
   * describe it.
   */
  readonly file?: File | undefined
  /** True while the upload is in flight; Insert carries the spinner. */
  readonly uploading?: boolean
  /** A refusal from the server — too large, the wrong type, an SVG — shown in place. */
  readonly error?: unknown
  readonly onSubmit: (request: ImageRequest) => void
}

const FORM_ID = 'insert-image-form'

const ACCEPTED = 'image/png,image/jpeg,image/gif,image/webp,image/avif,application/pdf'

const MEGABYTE = 1024 * 1024

/** A size a person reads, rather than a number of bytes. */
function megabytes(bytes: number): string {
  return (bytes / MEGABYTE).toFixed(bytes < MEGABYTE ? 1 : 0)
}

export function ImageDialog({
  open,
  onOpenChange,
  maxBytes,
  file,
  uploading = false,
  error,
  onSubmit,
}: ImageDialogProps) {
  const [source, setSource] = useState('')
  const [alt, setAlt] = useState('')
  const [picked, setPicked] = useState<File | undefined>(undefined)
  const styles = imageDialogStyles()

  /*
   * The file the dialog would upload: whichever was chosen here, and otherwise
   * the one a drop or a paste arrived with. Derived rather than copied into
   * state by an effect, so the two can never disagree.
   */
  const chosen = picked ?? file

  function close() {
    onOpenChange(false)
    setSource('')
    setAlt('')
    setPicked(undefined)
  }

  const address = source.trim()
  const described = alt.trim() !== ''
  // A picture is described; anything else is linked to, and a link needs words
  // rather than alternative text. The file's own type is enough to ask the
  // right question — what the file actually is, the server decides.
  const isPicture = chosen === undefined || chosen.type.startsWith('image/')
  const tooLarge = chosen !== undefined && chosen.size > maxBytes
  // A file wins over an address when somehow both are given: it is the one the
  // person just handed over, and it is the one this instance will still be able
  // to serve next year.
  const ready = described && !tooLarge && (chosen !== undefined || address !== '')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!described) return
    if (chosen !== undefined) {
      onSubmit({ kind: 'upload', file: chosen, alt: alt.trim() })
      return
    }
    if (address === '') return
    onSubmit({ kind: 'link', url: address, alt: alt.trim() })
  }

  return (
    <Dialog
      title="Insert an image"
      description="Upload a picture, or use one that already has an address on the web."
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={uploading}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={!ready} loading={uploading}>
            Insert
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} noValidate className={styles.form()}>
        <Input
          label="Image file"
          name="file"
          type="file"
          accept={ACCEPTED}
          description="PNG, JPEG, GIF, WebP, AVIF or PDF. You can also drag a file onto the document, or paste one."
          onChange={(event) => {
            setPicked(event.target.files?.[0])
          }}
        />
        {/*
          One line, two states, told by an attribute rather than by picking a
          class (`docs/architecture/styling.md`): `aria-invalid` is what a
          screen reader hears and what the colour follows, so the two cannot
          disagree.
        */}
        {chosen === undefined ? undefined : (
          <p
            className={styles.chosen()}
            aria-invalid={tooLarge}
            role={tooLarge ? 'alert' : undefined}
          >
            {tooLarge
              ? `${chosen.name} is ${megabytes(chosen.size)} MB, over the ${megabytes(maxBytes)} MB limit. Choose a smaller file.`
              : `Ready to upload: ${chosen.name}`}
          </p>
        )}

        <p className={styles.divider()} aria-hidden="true">
          <span className={styles.rule()} />
          or
          <span className={styles.rule()} />
        </p>

        <Input
          label="Image address"
          name="source"
          type="url"
          placeholder="https://example.com/diagram.png"
          value={source}
          onChange={(event) => {
            setSource(event.target.value)
          }}
        />

        <Input
          label={isPicture ? 'Alternative text' : 'Link text'}
          name="alt"
          required
          description={
            isPicture
              ? 'What the picture shows, for anyone who cannot see it.'
              : 'What the link should read as in the document.'
          }
          value={alt}
          onChange={(event) => {
            setAlt(event.target.value)
          }}
        />
        <FormError error={error} />
      </form>
    </Dialog>
  )
}
