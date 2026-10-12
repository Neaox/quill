import { useState } from 'react'

import { tv } from '@quill/ui'

import { DocumentBody } from '../documents/document-body.tsx'
import { SegmentedControl } from '../theme/segmented-control.tsx'
import type { TableSpecimen } from './table-specimens.gen.ts'
import { TABLE_SPECIMENS } from './table-specimens.gen.ts'

/*
 * No `overflow: hidden` on the frame: a frozen header sticks to the page, and
 * a clipping ancestor would make it stick to the frame instead.
 */
const frame = tv({
  slots: {
    root: 'rounded-lg border border-border bg-surface',
    caption:
      'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2',
    label: 'meta',
    note: 'text-2xs text-muted',
    body: 'py-6',
    document: '',
    source: 'mx-4 mb-4 text-2xs text-muted',
    code: 'mt-2 overflow-x-auto rounded-md bg-surface-raised p-3 font-mono text-2xs leading-relaxed text-foreground',
  },
  variants: {
    // Stacking is shown in a phone's width, where it happens.
    narrow: { true: { document: 'mx-auto max-w-88' } },
  },
})

type Alignment = 'start' | 'centre'

const ALIGNMENTS = [
  { value: 'start', label: 'Start' },
  { value: 'centre', label: 'Centred' },
] as const

export function TableSpecimenFrame({ specimen }: { readonly specimen: TableSpecimen }) {
  const styles = frame({ narrow: specimen.id === 'stack' })

  return (
    <section className={styles.root()} aria-label={specimen.label}>
      <div className={styles.caption()}>
        <p className={styles.label()}>{specimen.label}</p>
        <p className={styles.note()}>{specimen.note}</p>
      </div>
      <div className={styles.body()}>
        <div className={styles.document()}>
          <DocumentBody html={specimen.html} label={`Specimen: ${specimen.label}`} />
        </div>
      </div>
      <details className={styles.source()}>
        <summary>Markdown</summary>
        <pre className={styles.code()}>
          <code>{specimen.markdown}</code>
        </pre>
      </details>
    </section>
  )
}

/**
 * Every table feature (ADR-040), each as Markdown and the HTML the renderer
 * makes of it (`table-specimens.gen.ts`), mounted as a reader sees it, with
 * the reader's tools. ADR-040 makes keeping these current part of done.
 */
export function TableSpecimens() {
  const [alignment, setAlignment] = useState<Alignment>('start')

  return (
    <div className="flex flex-col gap-6" data-align={alignment}>
      <SegmentedControl
        legend="Reading alignment for the table specimens"
        segments={ALIGNMENTS}
        value={alignment}
        onValueChange={setAlignment}
        className="self-start"
      />
      {TABLE_SPECIMENS.map((specimen) => (
        <TableSpecimenFrame key={specimen.id} specimen={specimen} />
      ))}
    </div>
  )
}
