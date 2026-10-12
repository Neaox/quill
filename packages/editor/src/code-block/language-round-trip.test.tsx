import { CODE_LANGUAGES } from '@quill/highlight/languages'
import { parseDocument, serializeDocument } from '@quill/markdown'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'

/**
 * The fence name is the author's (AGENTS.md rule 7). A block written
 * ```` ```sh ```` is shown as Bash and coloured as Bash, and saved as `sh` — for
 * every fence name the registry knows, through the whole editor: parse, open,
 * write back. Only choosing a different language rewrites it, and then to the
 * registry's canonical name.
 */

/** Every fence name the registry knows, each in a block of its own. */
const EVERY_NAME = CODE_LANGUAGES.flatMap((language) => [language.id, ...language.aliases])

const source = EVERY_NAME.map((name) =>
  ['```' + name, `code in ${name}`, '```', ''].join('\n'),
).join('\n')

function open(markdown: string) {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(markdown).ast} ref={ref} />)
  const written = (): string => {
    const handle = ref.current
    if (handle === null) throw new Error('The editor did not expose a handle.')
    return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
  }
  return { written, user: userEvent.setup() }
}

describe('a block’s fence name, through the editor', () => {
  it('writes back every fence name the registry knows exactly as it was written', () => {
    const { written } = open(source)
    expect(written()).toBe(source)
  })

  it('is rewritten only when a different language is chosen, to its canonical name', async () => {
    const { written, user } = open('```sh\necho hi\n```\n')
    const field = screen.getByRole('combobox', { name: 'Code block language' })

    await user.type(field, 'Bash{Enter}')
    expect(written()).toBe('```sh\necho hi\n```\n')

    await user.clear(field)
    await user.type(field, 'zsh{Enter}')
    expect(written()).toBe('```sh\necho hi\n```\n')

    await user.clear(field)
    await user.type(field, 'golang')
    expect(
      within(screen.getByRole('listbox', { hidden: true })).getAllByRole('option', {
        hidden: true,
      })[0],
    ).toHaveTextContent('Go · golang')
    await user.keyboard('{Enter}')
    expect(written()).toBe('```go\necho hi\n```\n')
  })
})
