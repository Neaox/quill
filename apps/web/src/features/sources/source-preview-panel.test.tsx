import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SourcePreviewDto } from '../../lib/api/index.ts'
import { SourcePreviewPanel } from './source-preview-panel.tsx'

const PREVIEW = {
  revision: '4f1c2a9e8b7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b',
  manifest: {
    path: 'site/manifest.yaml',
    state: 'read',
    problem: null,
    entries: [{ slug: null, collections: 1 }],
    entry: null,
    unknownKeys: [],
    notes: [
      {
        line: 3,
        message: '"collections[0]" has no title, so it is called "Field notes", after its path.',
      },
    ],
  },
  origin: 'manifest',
  collections: [],
  skipped: [],
  assets: 0,
  limits: { files: 1, truncated: false, unread: 0 },
  changes: null,
} as unknown as SourcePreviewDto

describe('the preview panel', () => {
  it('names the manifest it read, and what that manifest was read with by default', () => {
    render(<SourcePreviewPanel preview={PREVIEW} branch="main" />)

    expect(screen.getByText('site/manifest.yaml')).toBeInTheDocument()
    expect(screen.getByText('Read with defaults')).toBeInTheDocument()
    expect(
      screen.getByText(
        '"collections[0]" has no title, so it is called "Field notes", after its path. (line 3)',
      ),
    ).toBeInTheDocument()
  })
})
