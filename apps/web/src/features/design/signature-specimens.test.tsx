import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { themeIdVariants } from '@quill/ui/theme'

import { SignatureSpecimens } from './signature-specimens.tsx'

describe('the signature specimens', () => {
  it('show both forms of every signature variant', () => {
    const { container } = render(
      <SignatureSpecimens variants={themeIdVariants('instrument')} themeId="instrument" />,
    )

    // Header: readout and breadcrumb, side by side.
    expect(container.querySelectorAll('[data-header="readout"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-header="breadcrumb"]')).toHaveLength(1)
    expect(screen.getAllByRole('navigation', { name: 'Breadcrumb' }).length).toBeGreaterThan(0)

    // History: the always-visible timeline and the popover trigger.
    expect(screen.getAllByRole('region', { name: 'Revisions' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument()

    // Comments: the panel, with its count in the region name.
    expect(screen.getAllByRole('region', { name: 'Comments, 3' }).length).toBeGreaterThan(0)
  })
  it('colour the code sample with the real token classes, once the tokenizer arrives', async () => {
    const { container } = render(
      <SignatureSpecimens variants={themeIdVariants('instrument')} themeId="instrument" />,
    )

    // The grammars are a separate chunk (ADR-030), so the code is readable
    // before they load and coloured after.
    await waitFor(() => {
      expect(container.querySelector('.tok-keyword')).not.toBeNull()
    })
  })
})
