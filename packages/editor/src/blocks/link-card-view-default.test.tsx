import { parseDocument } from '@quill/markdown'
import type { LinkDisplay } from '@quill/markdown'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import type { LinkPreviewSource } from './link-preview-context.tsx'

const ADDRESS = 'https://blog.example/post'
const TITLE = 'How we cut build times'

const source = (defaultDisplay?: LinkDisplay): LinkPreviewSource => ({
  preview: () => ({
    title: TITLE,
    description: 'Caching and parallelism.',
    siteName: 'Engineering blog',
    thumbnail: null,
    favicon: { hash: 'b'.repeat(64), width: 64, height: 64 },
  }),
  request: () => undefined,
  imageUrl: ({ hash }) => `/pictures/${hash}`,
  defaultDisplay,
})

function open(markdown: string, linkPreviews: LinkPreviewSource) {
  return render(<DocumentEditor ast={parseDocument(markdown).ast} linkPreviews={linkPreviews} />)
}

const UNCHOSEN = `::link{url="${ADDRESS}"}\n`

describe('a link on a line of its own, whose author chose no display', () => {
  it('is drawn as the organisation’s default card', async () => {
    open(UNCHOSEN, source('card'))
    expect(await screen.findByRole('group', { name: `Link card: ${TITLE}` })).toHaveTextContent(
      'Caching and parallelism.',
    )
  })

  it('is drawn as a compact line when that is the default', async () => {
    const { container } = open(UNCHOSEN, source('compact'))
    const line = await screen.findByRole('group', { name: `Compact link: ${TITLE}` })
    expect(line).toHaveTextContent('Engineering blog')
    expect(line).not.toHaveTextContent('Caching and parallelism.')
    await expectNoAccessibilityViolations(container)
  })

  it('is drawn as an inline chip when that is the default, as the reader draws it on its own line', async () => {
    const { container } = open(UNCHOSEN, source('inline'))
    const chip = await screen.findByRole('group', { name: `Link: ${TITLE}` })
    expect(chip).toHaveTextContent(TITLE)
    expect(chip).not.toHaveTextContent('Caching and parallelism.')
    await expectNoAccessibilityViolations(container)
  })

  it('is drawn as inline until the application has said what the default is', async () => {
    open(UNCHOSEN, source(undefined))
    expect(await screen.findByRole('group', { name: `Link: ${TITLE}` })).toBeVisible()
  })

  it('is drawn as its plain address when the default is a plain link', async () => {
    open(UNCHOSEN, source('url'))
    const plain = await screen.findByRole('group', { name: `Link: ${ADDRESS}` })
    expect(plain).toHaveTextContent(ADDRESS)
    expect(plain.querySelector('img')).toBeNull()
  })

  it('keeps what the author chose, whatever the default is', async () => {
    open(`::link{url="${ADDRESS}" display=compact}\n`, source('card'))
    expect(await screen.findByRole('group', { name: `Compact link: ${TITLE}` })).toBeVisible()
    expect(screen.queryByRole('group', { name: /^Link card/u })).toBeNull()
  })

  it('draws a display this release does not know as a plain link, as the reader does', async () => {
    open(`::link{url="${ADDRESS}" display=hologram}\n`, source('card'))
    expect(await screen.findByRole('group', { name: `Link: ${ADDRESS}` })).toBeVisible()
  })
})
