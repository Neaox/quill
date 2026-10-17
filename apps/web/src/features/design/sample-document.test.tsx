import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SampleDocument } from './sample-document.tsx'

describe('the sample document', () => {
  it('has a content paragraph, a wide table, and a full image', () => {
    render(<SampleDocument />)

    const article = screen.getByRole('article', { name: 'Sample document: regional failover' })
    expect(article).toHaveClass('layout-grid', 'prose')

    const table = within(article).getByRole('table')
    expect(table.closest('.layout-wide')).not.toBeNull()

    const image = within(article).getByRole('img', { name: /system landscape/i })
    expect(image.closest('.layout-full')).not.toBeNull()
  })

  it('colours its commands with the real token classes, once the tokenizer arrives', async () => {
    const { container } = render(<SampleDocument />)

    // The grammars are a separate chunk (ADR-030), so the code is readable
    // before they load and coloured after.
    await waitFor(() => {
      expect(container.querySelector('.tok-comment')).not.toBeNull()
    })
  })
})
