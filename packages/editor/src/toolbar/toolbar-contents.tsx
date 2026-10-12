import type { EditorState } from '@tiptap/pm/state'
import { BulletListIcon, LinkIcon, NumberedListIcon, QuoteIcon, TaskListIcon } from '@quill/ui'
import type { ReactNode } from 'react'

import {
  CALLOUT_REMOVE_GROUP,
  CALLOUT_WRAP_GROUP,
  CALLOUT_TITLE,
  CALLOUT_TONES,
  CALLOUT_VARIANT_GROUP,
} from '../actions/callout-actions.ts'
import type { EditorAction } from '../actions/editor-action.ts'
import { calloutLabel } from '../callout/callouts.ts'
import type { CalloutContext } from '../callout/callouts.ts'
import { normaliseHref } from '../format/href.ts'
import { activeTextStyle } from '../format/text-styles.ts'
import {
  BLOCK_SWITCHES,
  CLEAR_FORMATTING_GROUP,
  MARK_ACTIONS,
  STYLE_GROUP,
} from '../actions/text-actions.ts'
import type { InlineMark } from '../format/marks.ts'
import {
  ToneSwatch,
  ToolbarButton,
  ToolbarGroup,
  ToolbarMenuButton,
  ToolbarSeparator,
  toolbarStyles,
} from './toolbar-controls.tsx'

/**
 * What each kind of toolbar holds.
 *
 * Each one is a short list of controls over the shared action registries, so the
 * toolbar decides only *arrangement*: which actions are close to hand, and which
 * are behind a menu. The same actions are in the context menu, where nothing is
 * left out for want of room.
 */

export interface ContentProps {
  readonly state: EditorState
  readonly onRun: (action: EditorAction) => void
}

/** How each mark is drawn on its button. */
const MARK_GLYPHS: Readonly<Record<InlineMark['name'], ReactNode>> = {
  bold: <span className="font-bold">B</span>,
  italic: <span className="italic">I</span>,
  strike: <span className="line-through">S</span>,
  code: <span className="font-mono">{'</>'}</span>,
}

export interface TextContentProps extends ContentProps {
  readonly link: EditorAction
  readonly comment: EditorAction | undefined
}

/** What each block switch is drawn as. */
const SWITCH_ICONS: Readonly<Record<string, ReactNode>> = {
  'switch-bullet-list': <BulletListIcon />,
  'switch-ordered-list': <NumberedListIcon />,
  'switch-task-list': <TaskListIcon />,
  'switch-blockquote': <QuoteIcon />,
}

/**
 * Selected text, laid out as every editor lays out a toolbar over it, so that it is
 * where a hand expects: the kind of block, then what the words are made of, then the
 * link, then the block switches (lists and the quote), then the comment, and last
 * what is rarer, behind a "more".
 */
export function TextToolbarContent({ state, onRun, link, comment }: TextContentProps) {
  return (
    <>
      <ToolbarGroup label="Text style">
        <ToolbarMenuButton
          label="Text style"
          // It shows the style the caret is in, which is also the name of that style's own
          // button; it is named for what it is, so the two are never the same name.
          accessibleName={`Text style: ${activeTextStyle(state)?.label ?? 'Text'}`}
          groups={[STYLE_GROUP]}
          state={state}
          onRun={onRun}
        >
          {activeTextStyle(state)?.label ?? 'Text'}
        </ToolbarMenuButton>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup label="Formatting">
        {MARK_ACTIONS.map(({ mark, action }) => (
          <ToolbarButton key={action.id} action={action} state={state} onRun={onRun}>
            {MARK_GLYPHS[mark.name]}
          </ToolbarButton>
        ))}
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup label="Link">
        <ToolbarButton action={link} state={state} onRun={onRun}>
          <LinkIcon />
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup label="Blocks">
        {BLOCK_SWITCHES.map((action) => (
          <ToolbarButton key={action.id} action={action} state={state} onRun={onRun}>
            {SWITCH_ICONS[action.id]}
          </ToolbarButton>
        ))}
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup label="More">
        {comment === undefined ? null : (
          <ToolbarButton action={comment} state={state} onRun={onRun}>
            Comment
          </ToolbarButton>
        )}
        <ToolbarMenuButton
          label="More formatting"
          groups={[CLEAR_FORMATTING_GROUP, CALLOUT_WRAP_GROUP]}
          state={state}
          onRun={onRun}
          iconOnly
        >
          <span aria-hidden="true">⋯</span>
        </ToolbarMenuButton>
      </ToolbarGroup>
    </>
  )
}

export interface LinkContentProps extends ContentProps {
  readonly href: string
  readonly edit: EditorAction
  readonly remove: EditorAction
}

/** A caret in a link: where it goes, and how to change or remove it. */
export function LinkToolbarContent({ state, onRun, href, edit, remove }: LinkContentProps) {
  // Only an address a document may carry becomes something to click; anything
  // else is shown as text, so the toolbar is never a way to follow a bad link.
  const safe = normaliseHref(href) === href
  return (
    <>
      <ToolbarGroup label="Link">
        {safe ? (
          <a
            href={href}
            data-toolbar-item=""
            target="_blank"
            rel="noopener noreferrer"
            className={toolbarStyles().button({ class: 'max-w-64 truncate' })}
          >
            {href}
          </a>
        ) : (
          <span className="max-w-64 truncate px-2 text-sm text-muted">{href}</span>
        )}
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup label="Edit link">
        <ToolbarButton action={edit} state={state} onRun={onRun}>
          Edit
        </ToolbarButton>
        <ToolbarButton action={remove} state={state} onRun={onRun}>
          Remove
        </ToolbarButton>
      </ToolbarGroup>
    </>
  )
}

export interface CalloutContentProps extends ContentProps {
  readonly callout: CalloutContext
}

/** A caret in a callout: which variant it is, whether it has a title of its own, and whether it stays. */
export function CalloutToolbarContent({ state, onRun, callout }: CalloutContentProps) {
  return (
    <ToolbarGroup label="Callout">
      <ToolbarMenuButton
        label="Callout type"
        groups={[CALLOUT_VARIANT_GROUP]}
        state={state}
        onRun={onRun}
      >
        <ToneSwatch tone={CALLOUT_TONES[callout.type]} />
        {calloutLabel(callout.type)}
      </ToolbarMenuButton>
      <ToolbarButton action={CALLOUT_TITLE} state={state} onRun={onRun}>
        Title
      </ToolbarButton>
      <ToolbarMenuButton
        label="Remove callout"
        groups={[CALLOUT_REMOVE_GROUP]}
        state={state}
        onRun={onRun}
      >
        Remove
      </ToolbarMenuButton>
    </ToolbarGroup>
  )
}
