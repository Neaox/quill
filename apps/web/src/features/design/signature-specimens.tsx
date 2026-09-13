import {
  Badge,
  CodeBlock,
  CommentsPanel,
  CopyIcon,
  DocumentHeader,
  IconRail,
  RevisionTimeline,
  Tree,
} from '@quill/ui'

import type { BuiltinThemeId, ThemeVariants } from '@quill/theme'

import { HighlightedCode } from './highlighted-code.tsx'
import {
  COMMENTS,
  RAIL_ITEMS,
  REVISIONS,
  SAMPLE_CODE,
  STATUS,
  TREE_SECTIONS,
} from './showcase-data.tsx'
import { Specimen } from './specimen-layout.tsx'
import { Avatar, WorkspaceMark } from './workspace-mark.tsx'

export interface SignatureSpecimensProps {
  /** The identity on screen, so each specimen can say which variant is its own. */
  readonly variants: ThemeVariants
  readonly themeId: BuiltinThemeId
}

const IS_THIS_THEME = 'this identity'
const NOT_THIS_THEME = 'the other variant'

const noteFor = (chosen: string, shown: string): string =>
  chosen === shown ? IS_THIS_THEME : NOT_THIS_THEME

/**
 * The bounded set of signature variants (ADR-028, layer 1), each shown in both
 * of its forms so the choice a theme makes is visible rather than described.
 * The one the identity on screen has chosen says so.
 */
export function SignatureSpecimens({ variants, themeId }: SignatureSpecimensProps) {
  return (
    <>
      <Specimen
        label="Header · readout"
        note={noteFor(variants.header, 'readout')}
        bodyClassName="p-0"
      >
        <DocumentHeader
          status={STATUS}
          variant="readout"
          mark={<WorkspaceMark />}
          actions={<Badge tone="accent">v12</Badge>}
          className="border-b-0"
        />
      </Specimen>

      <Specimen
        label="Header · breadcrumb"
        note={noteFor(variants.header, 'breadcrumb')}
        bodyClassName="p-0"
      >
        <DocumentHeader
          status={STATUS}
          variant="breadcrumb"
          mark={<WorkspaceMark />}
          actions={<Badge tone="accent">v12</Badge>}
          className="border-b-0"
        />
      </Specimen>

      <Specimen
        label="Navigation · tree"
        note={`${noteFor(variants.navigation, 'tree')} · indent guides, one accent bar`}
        bodyClassName="p-0"
      >
        <div className="flex">
          <IconRail
            label="Rail, example"
            items={RAIL_ITEMS}
            currentId="documents"
            footer={<Avatar />}
            className="border-e-0"
          />
          <Tree
            label="Tree variant, example"
            sections={TREE_SECTIONS}
            currentId="foundations"
            variant="tree"
            className="w-62 border-s border-border"
          />
        </div>
      </Specimen>

      <Specimen
        label="History · timeline and menu"
        note={`this identity uses the ${variants.history}`}
        bodyClassName="flex flex-wrap items-start gap-10"
      >
        <RevisionTimeline revisions={REVISIONS} currentId="v12" variant="timeline" />
        <div className="flex flex-col gap-2">
          <p className="meta">menu</p>
          <RevisionTimeline revisions={REVISIONS} currentId="v12" variant="menu" />
        </div>
      </Specimen>

      <Specimen
        label="Comments · panel"
        note={`${noteFor(variants.comments, 'panel')} · sidenotes are not built yet`}
        bodyClassName="max-w-72"
      >
        <CommentsPanel comments={COMMENTS} />
      </Specimen>

      <Specimen
        label="Code"
        note="tokenized by the real grammar; colours are the theme's --token-* variables"
        bodyClassName="p-0"
      >
        <CodeBlock
          label="verify.ts"
          source={`src/auth/verify.ts @ 8f31c72 L42-71 · ${themeId}`}
          actions={<CopyIcon className="text-muted" />}
          className="rounded-none border-0"
        >
          <HighlightedCode code={SAMPLE_CODE} language="ts" />
        </CodeBlock>
      </Specimen>
    </>
  )
}
