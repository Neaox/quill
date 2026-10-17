import { Combobox } from '@quill/ui'
import type { ListboxGroup } from '@quill/ui'
import { resolveCodeLanguage } from '@quill/highlight/languages'
import { Fragment, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { tv } from 'tailwind-variants'

import { highlight } from '../slash/slash-rank.ts'
import type { MatchRange } from '../slash/slash-rank.ts'
import type { SlashRecents } from '../slash/slash-recents.ts'
import {
  changesLanguage,
  fenceNameOf,
  languageName,
  languageOptions,
  PLAIN_TEXT,
} from './language-options.ts'
import type { LanguageOption, LanguageOptionGroup } from './language-options.ts'

/**
 * The language picker a code block and a code group's tab share (ADR-041).
 *
 * The design system's `Combobox`, inline: it shows the block's language and,
 * focused, searches every language the reader colours by name, fence name or
 * file extension, grouped by category, with the ones used recently first and
 * plain text always on offer. Enter or Alt+ArrowDown opens it, the arrows walk
 * it, Enter chooses, and Escape gives the keyboard back to the code. A fence
 * name it does not know can still be chosen, as written: the document's name
 * for its language is the document's.
 */

export interface LanguagePickerProps {
  /** The block's language attribute, as the document has it. */
  readonly language: unknown
  /** Writes a fence name onto the block; false when it could not be written. */
  readonly onChoose: (name: string | null) => boolean
  /** Escape: the keyboard goes back to the code. */
  readonly onDismiss: () => void
  readonly recent: SlashRecents
}

export const LANGUAGE_PICKER_LABEL = 'Code block language'

const styles = tv({
  slots: {
    // What matched, marked as the slash menu marks it.
    mark: 'bg-transparent font-semibold text-accent',
    via: 'font-normal text-muted',
  },
})()

/** `text` with the characters in `range` marked. */
function marked(text: string, range: MatchRange | undefined): ReactNode {
  if (range === undefined) return text
  return highlight(text, [range]).map((part) =>
    part.matched ? (
      <mark key={part.start} className={styles.mark()}>
        {part.text}
      </mark>
    ) : (
      <Fragment key={part.start}>{part.text}</Fragment>
    ),
  )
}

/** An option's label, and — when it was found by a fence name or extension — that name, quietly. */
function optionLabel(option: LanguageOption): ReactNode {
  const label = marked(option.label, option.labelMatch)
  if (option.via === undefined) return label
  return (
    <>
      {label}
      <span className={styles.via()}> · {marked(option.via.text, option.via.match)}</span>
    </>
  )
}

function listboxGroups(groups: readonly LanguageOptionGroup[]): ListboxGroup[] {
  return groups.map((group) => ({
    ...group,
    options: group.options.map((option) => ({ ...option, label: optionLabel(option) })),
  }))
}

export function LanguagePicker({ language, onChoose, onDismiss, recent }: LanguagePickerProps) {
  // What is being typed, or null while the field shows the block's language.
  const [query, setQuery] = useState<string | null>(null)
  const groups = listboxGroups(languageOptions(query ?? '', recent.read()))
  const count = groups.reduce((total, group) => total + group.options.length, 0)
  const searching = query !== null && query.trim() !== ''

  function choose(optionId: string): void {
    setQuery(null)
    const name = fenceNameOf(optionId)
    if (name === undefined || !changesLanguage(language, name)) return
    if (!onChoose(name)) return
    const known = name === null ? undefined : resolveCodeLanguage(name)
    if (known !== undefined) recent.remember(known.id)
  }

  /**
   * Escape gives up at once — the popup and the edit both — rather than the
   * combobox's two steps, because the field is a waypoint on the way back to
   * the code. Enter on something that names nothing puts the language back.
   */
  function onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setQuery(null)
      onDismiss()
    } else if (event.key === 'Enter' && searching && count === 0) {
      event.preventDefault()
      setQuery(null)
    }
  }

  return (
    <div
      className="code-block-language"
      onKeyDownCapture={onKeyDownCapture}
      onBlurCapture={() => {
        setQuery(null)
      }}
    >
      <Combobox
        variant="inline"
        opens="on-request"
        label={LANGUAGE_PICKER_LABEL}
        value={query ?? languageName(language) ?? ''}
        onValueChange={setQuery}
        placeholder={PLAIN_TEXT.label}
        groups={groups}
        onSelect={choose}
        notice={searching && count === 0 ? `No language called “${query.trim()}”` : undefined}
        status={searching ? `${count} ${count === 1 ? 'language' : 'languages'}` : undefined}
      />
    </div>
  )
}
