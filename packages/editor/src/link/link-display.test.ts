import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { linkEmbedsPlugin, recordLinkEmbed } from './link-embeds.ts'
import { linkTargetAt, setLinkChoice, showLinkAs } from './link-display.ts'

const harness = createEditorTestHarness()

/** A caret inside the first text, or the node, that contains `needle`. */
function caretIn(markdown: string, needle: string): EditorState {
  const opened = harness.state(markdown)
  let found = -1
  opened.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(needle) === true) found = pos + 1
    return found < 0
  })
  return opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, found)))
}

function selectLeaf(markdown: string): EditorState {
  const opened = harness.state(markdown)
  let found = -1
  opened.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'leafDirective') found = pos
    return found < 0
  })
  return opened.apply(opened.tr.setSelection(NodeSelection.create(opened.doc, found)))
}

function run(state: EditorState, command: Command): { ok: boolean; markdown: string } {
  let next = state
  const ok = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { ok, markdown: harness.read(documentToMdast(next.doc).tree).trim() }
}

const PLAIN = 'See [the design doc](https://blog.example/post) now.'
const BARE = 'See [https://blog.example/post](https://blog.example/post) now.'

describe('linkTargetAt', () => {
  it('finds a plain link, which shows as a link', () => {
    const target = linkTargetAt(caretIn(PLAIN, 'design'))
    expect(target).toMatchObject({ form: 'mark', href: 'https://blog.example/post' })
    expect(target?.display).toBe('url')
  })

  it('finds an inline link directive and the display it was given', () => {
    const target = linkTargetAt(
      caretIn(
        'See [the design doc](https://blog.example/post)<!-- quill:link display=inline -->.',
        'design',
      ),
    )
    expect(target).toMatchObject({
      form: 'text',
      display: 'inline',
      href: 'https://blog.example/post',
    })
  })

  it('finds a card, and a directive that chose nothing as the default', () => {
    expect(
      linkTargetAt(selectLeaf('<https://blog.example/post> <!-- quill:link display=card -->'))
        ?.display,
    ).toBe('card')
    expect(
      linkTargetAt(caretIn('See <https://blog.example/post><!-- quill:link -->.', 'blog'))?.display,
    ).toBe('inline')
  })

  it('shows a display this release does not know as a plain link', () => {
    expect(
      linkTargetAt(
        caretIn('See [x](https://blog.example/post)<!-- quill:link display=hologram -->.', 'x'),
      )?.display,
    ).toBe('url')
  })

  it('is nothing for text that is not a link, or another directive', () => {
    expect(linkTargetAt(caretIn('Just words.', 'words'))).toBeNull()
    expect(linkTargetAt(caretIn('A :kbd[Ctrl+C] key.', 'Ctrl'))).toBeNull()
  })
})

describe('showLinkAs', () => {
  it('turns a plain link into an inline one, keeping the author’s words', () => {
    const { ok, markdown } = run(caretIn(PLAIN, 'design'), showLinkAs('inline'))
    expect(ok).toBe(true)
    expect(markdown).toBe(
      'See [the design doc](https://blog.example/post)<!-- quill:link display=inline --> now.',
    )
  })

  it('turns a bare address into an inline one that spells the address', () => {
    const { markdown } = run(caretIn(BARE, 'blog'), showLinkAs('inline'))
    expect(markdown).toBe('See <https://blog.example/post><!-- quill:link display=inline --> now.')
  })

  it('turns a link alone in its paragraph into a card', () => {
    const { markdown } = run(
      caretIn('[https://blog.example/post](https://blog.example/post)', 'blog'),
      showLinkAs('card'),
    )
    expect(markdown).toBe('<https://blog.example/post> <!-- quill:link display=card -->')
  })

  it('takes a card out of the middle of a paragraph, leaving the words either side', () => {
    const { markdown } = run(caretIn(PLAIN, 'design'), showLinkAs('card'))
    expect(markdown).toBe(
      'See\n\n[the design doc](https://blog.example/post) <!-- quill:link display=card -->\n\nnow.',
    )
  })

  it('turns a card back into the plain link', () => {
    const { markdown } = run(
      selectLeaf('<https://blog.example/post> <!-- quill:link display=card layout=top -->'),
      showLinkAs('url'),
    )
    // The address spelled as itself is the autolink, which is the same link.
    expect(markdown).toBe('<https://blog.example/post>')
  })

  it('turns an inline link back into the plain link with the author’s words', () => {
    const { markdown } = run(
      caretIn(
        'See [the design doc](https://blog.example/post)<!-- quill:link display=inline --> now.',
        'design',
      ),
      showLinkAs('url'),
    )
    expect(markdown).toBe('See [the design doc](https://blog.example/post) now.')
  })

  it('turns an inline link into a card, and a card into an inline link', () => {
    const asCard = run(
      caretIn('See <https://blog.example/post><!-- quill:link display=inline -->.', 'blog'),
      showLinkAs('card'),
    )
    expect(asCard.markdown).toContain(
      '<https://blog.example/post> <!-- quill:link display=card -->',
    )
    const asInline = run(
      selectLeaf('<https://blog.example/post> <!-- quill:link display=card -->'),
      showLinkAs('inline'),
    )
    expect(asInline.markdown).toContain(
      '<https://blog.example/post><!-- quill:link display=inline -->',
    )
  })

  it('is the same link when it is asked to be shown as it already is', () => {
    expect(run(caretIn(PLAIN, 'design'), showLinkAs('url')).ok).toBe(false)
  })

  it('does nothing away from a link', () => {
    expect(run(caretIn('Just words.', 'words'), showLinkAs('card')).ok).toBe(false)
  })

  describe('as an embed', () => {
    const ADDRESS = 'https://blog.example/post'
    const HINT = { provider: 'YouTube', aspectRatio: 16 / 9 }

    /** The same state, told by the application that this address has a frame. */
    function told(state: EditorState, href: string): EditorState {
      const plugged = EditorState.create({
        doc: state.doc,
        selection: state.selection,
        plugins: [linkEmbedsPlugin()],
      })
      const record = recordLinkEmbed(plugged, href, HINT)
      return record === null ? plugged : plugged.apply(record)
    }

    it('is refused for an address nothing has said can be embedded', () => {
      expect(run(caretIn(PLAIN, 'design'), showLinkAs('embed')).ok).toBe(false)
    })

    it('is refused for an address that was told about, but not this one', () => {
      expect(
        run(told(caretIn(PLAIN, 'design'), 'https://elsewhere.example/'), showLinkAs('embed')).ok,
      ).toBe(false)
    })

    it('writes the embed as a directive of its own, for an address that has a frame', () => {
      const { ok, markdown } = run(told(caretIn(PLAIN, 'design'), ADDRESS), showLinkAs('embed'))
      expect(ok).toBe(true)
      expect(markdown).toContain(
        '[the design doc](https://blog.example/post) <!-- quill:link display=embed -->',
      )
    })

    it('is a block, so it cannot go where a line cannot be split', () => {
      const heading = told(
        caretIn('# A [heading link](https://blog.example/post)', 'heading'),
        ADDRESS,
      )
      expect(run(heading, showLinkAs('embed')).ok).toBe(false)
    })

    it('can be taken back to a card, an inline link or a plain link', () => {
      const embedded = told(selectLeaf(`::link{url="${ADDRESS}" display="embed"}`), ADDRESS)
      expect(run(embedded, showLinkAs('card')).markdown).toContain('display=card')
      expect(run(embedded, showLinkAs('inline')).markdown).toContain('display=inline')
    })
  })
})

describe('setLinkChoice', () => {
  const CARD = '<https://blog.example/post> <!-- quill:link display=card -->'

  it('writes the choices of a card in the order the file keeps them', () => {
    const { ok, markdown } = run(
      selectLeaf(CARD),
      setLinkChoice({ layout: 'top', showImage: false, title: 'Mine', description: '' }),
    )
    expect(ok).toBe(true)
    expect(markdown).toBe(
      '<https://blog.example/post> <!-- quill:link display=card layout=top image=none title=Mine description -->',
    )
  })

  it('puts a replaced title back when it is cleared', () => {
    const state = selectLeaf(
      `<https://blog.example/post> <!-- quill:link display=card title=Mine -->`,
    )
    expect(run(state, setLinkChoice({ title: null })).markdown).toBe(CARD)
  })

  it('does nothing for a plain link, which has no choices to keep', () => {
    expect(run(caretIn(PLAIN, 'design'), setLinkChoice({ layout: 'top' })).ok).toBe(false)
  })

  it('keeps what this release does not know', () => {
    const state = selectLeaf(
      '<https://blog.example/post> <!-- quill:link display=card future=yes -->',
    )
    expect(run(state, setLinkChoice({ layout: 'top' })).markdown).toContain('future=yes')
  })
})
