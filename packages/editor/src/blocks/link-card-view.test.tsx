import { parseDocument } from '@quill/markdown'
import { render, screen, within } from '@testing-library/react'
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

  describe('what a connector adds', () => {
    it('shows the state of a pull request in words, with its tone as emphasis only', async () => {
      const { container } = open(
        `::link{url="${ADDRESS}" display=card}
`,
        source({ ...PREVIEW, status: { label: 'Merged', tone: 'accent' } }),
      )
      const drawn = await card('How we cut build times')
      expect(within(drawn).getByText('Merged')).toBeInTheDocument()
      await expectNoAccessibilityViolations(container)
    })

    it('shows the state on a compact link, too', async () => {
      open(
        `::link{url="${ADDRESS}" display=compact}
`,
        source({ ...PREVIEW, status: { label: 'Open', tone: 'success' } }),
      )
      const drawn = await screen.findByRole('group', {
        name: 'Compact link: How we cut build times',
      })
      expect(within(drawn).getByText('Open')).toBeInTheDocument()
    })

    it('shows no state for a page', async () => {
      open(
        `::link{url="${ADDRESS}" display=card}
`,
        source(PREVIEW),
      )
      const drawn = await card('How we cut build times')
      expect(drawn.querySelector('[data-link-status]')).toBeNull()
    })

    const CODE = {
      language: 'typescript',
      startLine: 12,
      lines: ['const a = 1', 'const b = 2', 'const c = 3', 'const d = 4', 'const e = 5'],
      path: 'src/index.ts',
      repository: 'o/r',
    }

    it('summarises a code permalink: the file, the lines, and the first few of them as text', async () => {
      const { container } = open(
        `::link{url="${ADDRESS}" display=card}
`,
        source({ ...PREVIEW, title: 'src/index.ts', code: CODE }),
      )
      const drawn = await card('src/index.ts')
      expect(drawn).toHaveTextContent('o/r')
      const excerpt = drawn.querySelector('pre')
      expect(excerpt?.textContent).toBe('const a = 1\nconst b = 2\nconst c = 3')
      expect(excerpt).toHaveAttribute('data-first-line', '12')
      await expectNoAccessibilityViolations(container)
    })

    it('does not run or interpret the code', async () => {
      open(
        `::link{url="${ADDRESS}" display=card}
`,
        source({
          ...PREVIEW,
          title: 'x',
          code: { ...CODE, lines: ['<img src=x onerror=alert(1)>'] },
        }),
      )
      const drawn = await card('x')
      expect(drawn.querySelector('img[src="x"]')).toBeNull()
      expect(drawn.querySelector('pre')?.textContent).toBe('<img src=x onerror=alert(1)>')
    })
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

describe('a link card for another document', () => {
  const ADDRESS_OF_DOC = '/d/0192f0a4-7c1e-7a3b-8d1e-4a5b6c7d8e9f'

  it('shows the document’s live title and place, with the document icon, never the address', async () => {
    const { container } = open(
      `::link{url="${ADDRESS_OF_DOC}" display=card}
`,
      source({
        title: 'Deploy runbook',
        description: 'Ship it on Tuesdays.',
        siteName: 'Runbooks',
        thumbnail: null,
        favicon: null,
        layer: 'internal',
      }),
    )
    const drawn = await card('Deploy runbook')
    expect(drawn).toHaveTextContent('Ship it on Tuesdays.')
    expect(drawn).toHaveTextContent('Runbooks')
    expect(drawn).not.toHaveTextContent(ADDRESS_OF_DOC)
    await expectNoAccessibilityViolations(container)
  })

  it('holds its place as a document while the title is on its way', async () => {
    open(`::link{url="${ADDRESS_OF_DOC}" display=card}
`)
    expect(await card(ADDRESS_OF_DOC)).toHaveTextContent('Document')
  })
})

describe('a link card for a file', () => {
  const FILE = 'https://files.example/reports/q3.pdf'
  const pdf: EditorLinkPreview = {
    title: 'Q3 report.pdf',
    description: null,
    siteName: 'files.example',
    thumbnail: null,
    favicon: null,
    file: { mediaType: 'application/pdf', bytes: 482_113, name: 'Q3 report.pdf' },
  }

  it('shows the name, the type and the size, led by an icon for the type', async () => {
    const { container } = open(
      `::link{url="${FILE}" display=card}
`,
      source(pdf),
    )
    const drawn = await card('Q3 report.pdf')
    expect(drawn).toHaveTextContent('PDF document · 470.8 KB')
    expect(drawn).toHaveTextContent('files.example')
    expect(drawn.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(1)
    expect(drawn.querySelector('img')).toBeNull()
    await expectNoAccessibilityViolations(container)
  })

  it('shows a picture for an image, with the type and size beneath its name', async () => {
    open(
      `::link{url="${FILE}" display=card}
`,
      source({
        ...pdf,
        title: 'team.jpg',
        thumbnail: { hash: 'c'.repeat(64), width: 640, height: 480 },
        file: { mediaType: 'image/jpeg', bytes: 2_000_000, name: 'team.jpg' },
      }),
    )
    const drawn = await card('team.jpg')
    expect(drawn.querySelector('img')).toHaveAttribute('src', `/pictures/${'c'.repeat(64)}`)
    expect(drawn).toHaveTextContent('JPEG image · 1.9 MB')
  })

  it('lets the author’s description replace the type and size', async () => {
    open(
      `::link{url="${FILE}" display=card description="The numbers"}
`,
      source(pdf),
    )
    const drawn = await card('Q3 report.pdf')
    expect(drawn).toHaveTextContent('The numbers')
    expect(drawn).not.toHaveTextContent('470.8')
  })
})
