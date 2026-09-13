import type { PresentStep } from './present-steps.ts'

/**
 * Presenter notes: what the presenter says, which the room never sees.
 *
 * `:::notes` is a directive `packages/markdown` parses and keeps out of the
 * rendered body, the outline, backlinks, and search text
 * (`directives/strip-presenter-notes.ts`), while publishing keeps it in the
 * Markdown source. So the notes are not in the HTML this surface mounts, by
 * design, and are read here from the published Markdown instead, through the
 * content route the template picker already uses: presentation mode adds no
 * route of its own and nothing new can leak a note into a reader's page.
 * Where a document has no notes, the panel says so rather than pretending.
 * TODO(M4): notes for later are captured against a section while presenting
 * and land as private comment threads; `:::notes` and those share this panel.
 */

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const NOTES_OPEN = /^\s*:::notes\b/
const DIRECTIVE_CLOSE = /^\s*:::\s*$/

/**
 * A heading as the outline spells it: without the inline markup that only
 * changes how it looks. It is what lets a `:::notes` block under
 * `## **Rollout**` find the step the renderer called "Rollout".
 */
function plain(text: string): string {
  return text
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/[*_`~]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}

/**
 * The presenter notes of each step, keyed by step id.
 *
 * Notes are attached to the step whose title the nearest heading above them
 * matches; anything above the first section belongs to the opening step, which
 * is where a presenter's "what this is" note naturally goes. A heading that
 * matches no step leaves its notes where the last matching one did, because a
 * sub-heading inside a section is still that section.
 */
export function notesForSteps(
  markdown: string,
  steps: readonly PresentStep[],
): Readonly<Record<string, string>> {
  const byTitle = new Map(steps.map((step, index) => [plain(step.title), index]))
  const collected: string[][] = steps.map(() => [])

  let step = 0
  let fence: string | undefined
  let note: string[] | undefined

  for (const line of markdown.split('\n')) {
    const fenced = FENCE.exec(line)?.[1]
    if (fence !== undefined) {
      // Inside a fenced code block nothing is a heading and nothing closes a
      // directive; only the block's own closing fence means anything.
      if (fenced?.startsWith(fence) === true) fence = undefined
      note?.push(line)
      continue
    }
    if (fenced !== undefined) {
      fence = fenced
      note?.push(line)
      continue
    }

    if (note !== undefined) {
      if (DIRECTIVE_CLOSE.test(line)) {
        collected[step]?.push(note.join('\n').trim())
        note = undefined
      } else note.push(line)
      continue
    }

    if (NOTES_OPEN.test(line)) {
      note = []
      continue
    }

    const heading = HEADING.exec(line)?.[2]
    if (heading !== undefined) {
      step = byTitle.get(plain(heading.replace(/\s+#+\s*$/, ''))) ?? step
    }
  }

  return Object.fromEntries(
    steps
      .map((current, index) => [current.id, (collected[index] ?? []).join('\n\n')] as const)
      .filter(([, text]) => text !== ''),
  )
}
