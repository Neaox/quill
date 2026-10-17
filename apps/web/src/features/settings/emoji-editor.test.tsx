import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateTheme, instrument } from '@quill/theme'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import {
  EmojiEditor,
  emojiNameProblem,
  nameFromFile,
  type CustomEmojiList,
  type ServedEmoji,
} from './emoji-editor.tsx'

const HASH = '0123456789abcdef'.repeat(4)
const ACME = {
  name: 'acme',
  hash: HASH,
  mediaType: 'image/svg+xml',
  description: 'Acme logo',
  width: 64,
  height: 64,
} as const

const UPLOAD = 'POST /api/settings/organisation/emoji-images'

const NO_SERVED: ReadonlyMap<string, ServedEmoji> = new Map()

function Harness({
  initial,
  served = NO_SERVED,
}: {
  readonly initial?: CustomEmojiList | undefined
  readonly served?: ReadonlyMap<string, ServedEmoji>
}) {
  const [emoji, setEmoji] = useState<CustomEmojiList | undefined>(initial)
  const generated = generateTheme(instrument)
  return (
    <>
      <EmojiEditor
        emoji={emoji}
        served={served}
        light={generated.light}
        dark={generated.dark}
        onEmojiChange={setEmoji}
      />
      <output data-testid="emoji">{JSON.stringify(emoji ?? null)}</output>
    </>
  )
}

const saved = (): unknown => JSON.parse(screen.getByTestId('emoji').textContent ?? 'null')

function renderEditor(props: Parameters<typeof Harness>[0] = {}, routes: FakeRoutes = {}) {
  return render(<Harness {...props} />, { wrapper: createHookWrapper(routes) })
}

const svgFile = (name = 'Acme logo.svg', size = 120) =>
  new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'.padEnd(size, ' ')], name, {
    type: 'image/svg+xml',
  })

// jsdom has no object URLs; the form makes one per chosen file.
beforeEach(() => {
  URL.createObjectURL = vi.fn<(object: Blob) => string>(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn<(url: string) => void>()
})

describe('EmojiEditor (ADR-038)', () => {
  it('previews a saved emoji at text size, in light and dark, and removes it', async () => {
    const user = userEvent.setup()
    const { container } = renderEditor({
      initial: [ACME],
      served: new Map([['acme', { src: `/api/emoji/acme.${HASH.slice(0, 16)}.svg` }]]),
    })

    expect(screen.getByText(':acme:')).toBeInTheDocument()
    expect(screen.getByText('SVG · 64 × 64')).toBeInTheDocument()
    const preview = screen.getByRole('group', { name: 'Preview of :acme: at text size' })
    expect(within(preview).getByText('Light')).toBeInTheDocument()
    expect(within(preview).getByText('Dark')).toBeInTheDocument()
    expect(within(preview).getAllByRole('img', { name: 'Acme logo' })).toHaveLength(2)
    // Neutral words around it, so any organisation's emoji reads naturally.
    expect(within(preview).getAllByText(/Inline with text/u)).toHaveLength(2)
    await expectNoAccessibilityViolations(container)

    await user.click(screen.getByRole('button', { name: 'Remove the emoji :acme:' }))
    expect(saved()).toBeNull()
  })

  it('previews an animation moving and still, labelled, and offers the still under reduced motion', async () => {
    const STILL = 'fedcba9876543210'.repeat(4)
    const { container } = renderEditor({
      initial: [{ ...ACME, name: 'party', mediaType: 'image/gif', still: STILL }],
      served: new Map([
        [
          'party',
          {
            src: `/api/emoji/party.${HASH.slice(0, 16)}.gif`,
            still: `/api/emoji/party.${STILL.slice(0, 16)}.gif`,
          },
        ],
      ]),
    })

    expect(screen.getByText('GIF, animated · 64 × 64')).toBeInTheDocument()
    const moving = screen.getByRole('group', { name: 'Preview of :party: at text size' })
    const source = moving.querySelector('picture > source')
    expect(source).toHaveAttribute('media', '(prefers-reduced-motion: reduce)')
    expect(source).toHaveAttribute('srcset', `/api/emoji/party.${STILL.slice(0, 16)}.gif`)
    const still = screen.getByRole('group', {
      name: 'Preview of :party: still, for reduced motion',
    })
    expect(within(still).getAllByRole('img', { name: 'Acme logo' })[0]).toHaveAttribute(
      'src',
      `/api/emoji/party.${STILL.slice(0, 16)}.gif`,
    )
    await expectNoAccessibilityViolations(container)
  })

  it('lists the image types it takes, plainly, and the limits an animation has', () => {
    renderEditor()
    expect(screen.getByText('PNG, JPEG, GIF, WebP, AVIF or SVG, up to 256 KB')).toBeInTheDocument()
    expect(screen.getByLabelText('Image')).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml',
    )
    expect(screen.getByText(/at most 300 frames and 10 seconds/u)).toBeInTheDocument()
  })

  it('keeps the still the server cut from an animated upload', async () => {
    const user = userEvent.setup()
    const STILL = 'fedcba9876543210'.repeat(4)
    renderEditor(
      {},
      { [UPLOAD]: () => jsonResponse(201, { hash: HASH, mediaType: 'image/gif', still: STILL }) },
    )
    await user.upload(
      screen.getByLabelText('Image'),
      new File(['GIF89a'], 'party.gif', { type: 'image/gif' }),
    )
    await user.type(screen.getByLabelText('Alt text'), 'A dancing parrot')
    await user.click(screen.getByRole('button', { name: 'Add emoji' }))

    await vi.waitFor(() => {
      expect(saved()).toEqual([
        {
          name: 'party',
          hash: HASH,
          mediaType: 'image/gif',
          still: STILL,
          description: 'A dancing parrot',
          width: 64,
          height: 64,
        },
      ])
    })
  })

  it('shows no preview for an emoji whose image is not served yet under that hash', () => {
    renderEditor({
      initial: [ACME],
      served: new Map([['acme', { src: '/api/emoji/acme.ffffffffffffffff.svg' }]]),
    })
    expect(screen.queryByRole('group', { name: /Preview/u })).toBeNull()
  })

  it('uploads an image, names it from the file, and adds it', async () => {
    const user = userEvent.setup()
    renderEditor(
      {},
      { [UPLOAD]: () => jsonResponse(201, { hash: HASH, mediaType: 'image/svg+xml' }) },
    )

    const add = screen.getByRole('button', { name: 'Add emoji' })
    expect(add).toBeDisabled()
    await user.upload(screen.getByLabelText('Image'), svgFile())
    expect(screen.getByLabelText('Name')).toHaveValue('acme_logo')
    expect(screen.getByText('Acme logo.svg')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'acme_mark')
    // A picture says nothing to someone who cannot see it, so what it shows is asked for.
    expect(add).toBeDisabled()
    await user.type(screen.getByLabelText('Alt text'), 'Acme’s roadrunner mark')
    await user.click(add)

    await vi.waitFor(() => {
      expect(saved()).toEqual([
        {
          name: 'acme_mark',
          hash: HASH,
          mediaType: 'image/svg+xml',
          description: 'Acme’s roadrunner mark',
          width: 64,
          height: 64,
        },
      ])
    })
    // Shown from the file itself until it is saved and served.
    expect(screen.getAllByRole('img', { name: 'Acme’s roadrunner mark' })[0]).toHaveAttribute(
      'src',
      'blob:preview',
    )
  })

  it('lets the alt text of a saved emoji be written, and said in words from its name until it is', async () => {
    const user = userEvent.setup()
    const { name, hash, mediaType, width, height } = ACME
    renderEditor({
      initial: [{ name, hash, mediaType, width, height }],
      served: new Map([['acme', { src: `/api/emoji/acme.${HASH.slice(0, 16)}.svg` }]]),
    })
    const field = screen.getByLabelText('Alt text for :acme:')

    // Undescribed, it is read out as its name, which the field offers as the place to start.
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', 'acme')
    expect(screen.getAllByRole('img', { name: 'acme' }).length).toBeGreaterThan(0)

    await user.type(field, 'Acme logo')
    expect(saved()).toEqual([{ ...ACME, description: 'Acme logo' }])
    expect(screen.getAllByRole('img', { name: 'Acme logo' }).length).toBeGreaterThan(0)

    await user.clear(field)
    expect(saved()).toEqual([{ name, hash, mediaType, width, height }])
  })

  it('opens the file picker from its button', async () => {
    const user = userEvent.setup()
    renderEditor()
    const picker = screen.getByLabelText('Image')
    const click = vi.spyOn(picker, 'click')
    await user.click(screen.getByRole('button', { name: 'Choose image…' }))
    expect(click).toHaveBeenCalled()
  })

  it('refuses a file over the cap before sending it, and says why the server refused one', async () => {
    const user = userEvent.setup()
    renderEditor(
      {},
      {
        [UPLOAD]: () =>
          errorResponse(422, 'file_type_mismatch', 'That file was sent as image/svg+xml'),
      },
    )
    await user.upload(screen.getByLabelText('Image'), svgFile('big.svg', 300 * 1024))
    expect(screen.getByText('That image is too large')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeDisabled()

    await user.upload(screen.getByLabelText('Image'), svgFile('logo.svg'))
    await user.type(screen.getByLabelText('Alt text'), 'A logo')
    await user.click(screen.getByRole('button', { name: 'Add emoji' }))
    expect(await screen.findByText('That image could not be added')).toBeInTheDocument()
  })

  it('says why a name cannot be used', async () => {
    const user = userEvent.setup()
    renderEditor({ initial: [ACME] })
    await user.type(screen.getByLabelText('Name'), 'acme')
    expect(screen.getByText('There is already an emoji called “acme”.')).toBeInTheDocument()
  })

  it('stops offering to add once the organisation holds the most it may', () => {
    const many = Array.from({ length: 100 }, (_, index) => ({
      ...ACME,
      name: `e${String(index)}`,
    }))
    renderEditor({ initial: many })
    expect(screen.getByText('An organisation holds at most 100 emoji.')).toBeInTheDocument()
  })
})

describe('emoji names', () => {
  it('are checked in words a form can show', () => {
    expect(emojiNameProblem('acme_mark', [])).toBeUndefined()
    expect(emojiNameProblem('Acme', [])).toContain('lower-case')
  })

  it('start from the file’s name', () => {
    expect(nameFromFile('Acme logo.svg')).toBe('acme_logo')
    expect(nameFromFile('2024 Acme.png')).toBe('acme')
  })
})
