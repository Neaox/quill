import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ColumnLeftIcon,
  ColumnRightIcon,
  OptionsIcon,
  RowAboveIcon,
  RowBelowIcon,
  TrashIcon,
} from '@quill/ui'
import type { ReactNode } from 'react'

import {
  COLUMN_REMOVAL,
  COLUMN_TOOLS,
  ROW_REMOVAL,
  ROW_TOOLS,
  TABLE_ALIGN_GROUP,
  TABLE_OPTION_GROUPS,
  TABLE_REMOVAL,
} from '../actions/table-actions.ts'
import type { EditorAction } from '../actions/editor-action.ts'
import type { TableScope } from '../table/table-context.ts'
import type { ContentProps } from './toolbar-contents.tsx'
import {
  ToolbarButton,
  ToolbarGroup,
  ToolbarMenuButton,
  ToolbarSeparator,
} from './toolbar-controls.tsx'

/**
 * The table's toolbar: what is at hand for the thing the author is pointing at.
 *
 * A caret in a cell is pointing at the table, so it holds what is about the
 * whole of it (alignment, the options menu, removal). A row or column picked
 * out by its grip is pointing at that line, so it holds what is about a line:
 * where to put another, where to move it, whether it stays. Nothing here is a
 * long row of words; each tool is an icon named by its label, and everything
 * rarer is in the settings menu, where it has room to say what it does.
 */

const ICONS: Readonly<Record<string, ReactNode>> = {
  'row-above': <RowAboveIcon />,
  'row-below': <RowBelowIcon />,
  'row-up': <ArrowUpIcon />,
  'row-down': <ArrowDownIcon />,
  'row-delete': <TrashIcon />,
  'column-left': <ColumnLeftIcon />,
  'column-right': <ColumnRightIcon />,
  'column-move-left': <ArrowLeftIcon />,
  'column-move-right': <ArrowRightIcon />,
  'column-delete': <TrashIcon />,
  'align-left': <AlignLeftIcon />,
  'align-center': <AlignCenterIcon />,
  'align-right': <AlignRightIcon />,
  'table-delete': <TrashIcon />,
}

interface ToolsProps extends ContentProps {
  readonly label: string
  readonly actions: readonly EditorAction[]
}

function Tools({ label, actions, state, onRun }: ToolsProps) {
  return (
    <ToolbarGroup label={label}>
      {actions.map((action) => {
        /* v8 ignore next -- every action on the toolbar has an icon, which the table editing tests assert. */
        const icon = ICONS[action.id] ?? action.label
        return (
          <ToolbarButton key={action.id} action={action} state={state} onRun={onRun}>
            {icon}
          </ToolbarButton>
        )
      })}
    </ToolbarGroup>
  )
}

export interface TableContentProps extends ContentProps {
  readonly scope: TableScope
}

export function TableToolbarContent({ scope, state, onRun }: TableContentProps) {
  const alignment = (
    <Tools
      label="Column alignment"
      actions={TABLE_ALIGN_GROUP.actions}
      state={state}
      onRun={onRun}
    />
  )
  switch (scope) {
    case 'row':
      return (
        <>
          <Tools label="Row" actions={ROW_TOOLS} state={state} onRun={onRun} />
          <ToolbarSeparator />
          <Tools label="Remove row" actions={ROW_REMOVAL} state={state} onRun={onRun} />
        </>
      )
    case 'column':
      return (
        <>
          <Tools label="Column" actions={COLUMN_TOOLS} state={state} onRun={onRun} />
          <ToolbarSeparator />
          {alignment}
          <ToolbarSeparator />
          <Tools label="Remove column" actions={COLUMN_REMOVAL} state={state} onRun={onRun} />
        </>
      )
    case 'table':
      return (
        <>
          {alignment}
          <ToolbarSeparator />
          <ToolbarGroup label="Table">
            <ToolbarMenuButton
              label="Table settings"
              groups={TABLE_OPTION_GROUPS}
              state={state}
              onRun={onRun}
            >
              <OptionsIcon />
              Table settings
            </ToolbarMenuButton>
          </ToolbarGroup>
          <ToolbarSeparator />
          <Tools label="Remove table" actions={TABLE_REMOVAL} state={state} onRun={onRun} />
        </>
      )
  }
}
