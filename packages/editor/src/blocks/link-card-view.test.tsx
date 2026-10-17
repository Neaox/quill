import { parseDocument } from '@quill/markdown'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import type { EditorLinkPreview, LinkPreviewSource } from './link-preview-context.tsx'

const ADDRESS = 'https://blog.example/post'
const PREVIEW = {
  title: 'How we cut build times',
  description: 'Caching and parallelism.',
  siteName: 'Engineering blog',
  thumbnail: { hash: 'a'.repeat(64), width: 600, height: 315 },
  favicon: { hash: 'b'.repeat(64), width: 64, height: 64 },
}

const source = (preview: EditorLinkPreview | null): LinkPreviewSource => ({
  preview: () => preview,
  request: () => undefined,
  imageUrl: ({ hash }) => `/pictures/${hash}`,
})

function open(markdown: string, linkPreviews?: LinkPreviewSource) {
  return render(
    <DocumentEditor
      ast={parseDocument(markdown).ast}
      {...(linkPreviews === undefined ? {} : { linkPreviews })}
    />,
  )
}

const card = (title: string) => screen.findByRole('group', { name: `Link card: ${title}` })

describe('a link card in the writing surface', () => {
  it('is drawn from the preview when there is one, with its pictures as decoration', async () => {
    const { container } = open(`::link{url="${ADDRESS}" display=card}\n`, source(PREVIEW))
    const drawn = await card('How we cut build times')
    expect(drawn).toHaveTextContent('Caching and parallelism.')
    expect(drawn).toHaveTextContent('Engineering blog')
    const pictures = [...drawn.querySelectorAll('img')]
    expect(pictures.map((picture) => picture.getAttribute('src'))).toEqual([
      `/pictures/${'b'.repeat(64)}`,
      `/pictures/${'a'.repeat(64)}`,
    ])
    expect(pictures.every((picture) => picture.getAttribute('alt') === '')).toBe(true)
    await expectNoAccessibilityViolations(container)
  })

  it('holds its place from the address while there is no preview', async () => {
    open(`::link{url="${ADDRESS}" display=card}\n`)
    const drawn = await card(ADDRESS)
    expect(drawn).toHaveTextContent('blog.example')
    expect(drawn.querySelector('img')).toBeNull()
  })

  it('shows the author’s own title and description over the page’s', async () => {
    open(
      `::link{url="${ADDRESS}" display=card title="Our take" description="Why it matters"}\n`,
      source(PREVIEW),
    )
    const drawn = await card('Our take')
    expect(drawn).toHaveTextContent('Why it matters')
    expect(drawn).not.toHaveTextContent('Caching and parallelism.')
  })

  it('drops the picture when the author has', async () => {
    open(`::link{url="${ADDRESS}" display=card image=none}\n`, source(PREVIEW))
    expect((await card('How we cut build times')).querySelectorAll('img')).toHaveLength(1)
  })

  it('hides a description the author has emptied', async () => {
    open(`::link{url="${ADDRESS}" display=card description=""}\n`, source(PREVIEW))
    expect(await card('How we cut build times')).not.toHaveTextContent('Caching and parallelism.')
  })
})

describe('an embed in the writing surface', () => {
  const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  const EMBEDDABLE = { ...PREVIEW, embed: { provider: 'YouTube', aspectRatio: 16 / 9 } }

  it('is an inert placeholder naming the provider and shape, never a live frame', async () => {
    const { container } = open(
      `::link{url="${VIDEO}" display=embed}
`,
      source(EMBEDDABLE),
    )
    const drawn = await screen.findByRole('group', {
      name: 'Embedded YouTube: How we cut build times',
    })
    expect(drawn).toHaveTextContent('YouTube embed')
    expect(drawn).toHaveTextContent('16:9')
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    await expectNoAccessibilityViolations(container)
  })

  it('is drawn as the card the reader will see when the page has no embed', async () => {
    open(
      `::link{url="${VIDEO}" display=embed}
`,
      source(PREVIEW),
    )
    expect(await card('How we cut build times')).toBeInTheDocument()
  })
})
