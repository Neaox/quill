import { useState, type ReactNode } from 'react'

import {
  Badge,
  Breadcrumb,
  Button,
  Callout,
  CommandPalette,
  Dialog,
  DialogClose,
  Input,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tooltip,
} from '@quill/ui'

import { ExternalIcon, HistoryIcon, PublishIcon } from './design-icons.tsx'
import { Specimen, specimenAction } from './specimen-layout.tsx'

const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const
const SIZES = ['sm', 'md', 'lg'] as const

/** Button variants, sizes, and states. */
export function ButtonSpecimens() {
  return (
    <>
      <Specimen
        label="Variants"
        note="One primary action per view; it is the only one wearing the accent"
        bodyClassName="flex flex-wrap items-center gap-2.5"
      >
        {VARIANTS.map((variant) => (
          <Button
            key={variant}
            variant={variant}
            onClick={specimenAction(
              'This shows the button; the working control lives in the editor.',
            )}
          >
            {variant[0]?.toUpperCase()}
            {variant.slice(1)}
          </Button>
        ))}
      </Specimen>

      <Specimen
        label="Sizes"
        note="28, 32, and 40 pixels; the smallest still clears the target-size floor"
        bodyClassName="flex flex-wrap items-center gap-2.5"
      >
        {SIZES.map((size) => (
          <Button
            key={size}
            size={size}
            variant="secondary"
            onClick={specimenAction(
              'This shows the button at this size; the working control lives in the editor.',
            )}
          >
            Size {size}
          </Button>
        ))}
      </Specimen>

      <Specimen
        label="Icons, loading, and disabled"
        note="Loading says aria-busy; disabled says unavailable"
        bodyClassName="flex flex-wrap items-center gap-2.5"
      >
        <Button
          iconStart={<PublishIcon />}
          onClick={specimenAction('This shows the button; publishing happens from the editor.')}
        >
          Publish
        </Button>
        <Button
          variant="secondary"
          iconEnd={<ExternalIcon />}
          onClick={specimenAction(
            'This shows the button; opening the public page happens from the editor.',
          )}
        >
          Open public page
        </Button>
        <Button loading iconStart={<PublishIcon />}>
          Publishing
        </Button>
        <Button variant="secondary" loading>
          Loading
        </Button>
        <Button variant="secondary" disabled>
          Unavailable
        </Button>
        <Button
          variant="danger"
          iconStart={<HistoryIcon />}
          onClick={specimenAction(
            'This shows the button; restoring a revision happens from the editor.',
          )}
        >
          Restore revision
        </Button>
      </Specimen>
    </>
  )
}

/** Labelled fields with description, error, and disabled states. */
export function InputSpecimens() {
  return (
    <Specimen
      label="Text fields"
      note="Label, description, and error stay wired together"
      bodyClassName="grid gap-4 sm:grid-cols-2"
    >
      <Input label="Document title" placeholder="Regional failover" />
      <Input
        label="Slug"
        description="Lowercase letters, numbers, and hyphens."
        defaultValue="regional-failover"
      />
      <Input label="Collection" required placeholder="Platform runbooks" />
      <Input
        label="Share link expiry"
        error="Choose a date in the future."
        defaultValue="Yesterday"
      />
      <Input label="Owner" defaultValue="platform-team" disabled />
      <Input label="Search" type="search" placeholder="Search documents" />
    </Specimen>
  )
}

const BADGES = ['neutral', 'accent', 'success', 'warning', 'danger'] as const

/** Status labels, in the metadata face. */
export function BadgeSpecimens() {
  return (
    <Specimen
      label="Badges"
      note="The word carries the meaning; the tone is emphasis"
      bodyClassName="flex flex-wrap items-center gap-2"
    >
      <Badge>Draft</Badge>
      <Badge tone="accent">In review</Badge>
      <Badge tone="success">Published</Badge>
      <Badge tone="warning">Stale</Badge>
      <Badge tone="danger">Locked</Badge>
      {BADGES.map((tone) => (
        <Badge key={`${tone}-code`} tone={tone}>
          {tone}
        </Badge>
      ))}
    </Specimen>
  )
}

/** Callouts in all four tones, with and without a title. */
export function CalloutSpecimens() {
  return (
    <Specimen label="Callouts" bodyClassName="flex flex-col gap-3">
      <Callout>
        Drafts are private to you until you publish. Every publish creates a revision you can return
        to.
      </Callout>
      <Callout tone="success" title="Published to the public collection">
        Anonymous readers can now open this document. The share link you created earlier still
        works.
      </Callout>
      <Callout tone="warning" title="This document has drifted from its source">
        The repository it was imported from has moved on by fourteen commits.
      </Callout>
      <Callout tone="danger" title="Another author holds the draft lock">
        Their lock expires in eleven minutes, or they can release it from their editor.
      </Callout>
    </Specimen>
  )
}

/** Breadcrumb, tabs, tooltip, and dialog. */
export function NavigationSpecimens() {
  const [tab, setTab] = useState('content')

  return (
    <>
      <Specimen label="Breadcrumb" note="The last item is the current page">
        <Breadcrumb
          items={[
            { label: 'Platform', link: { to: '#platform' } },
            { label: 'Runbooks', link: { to: '#runbooks' } },
            { label: 'Regional failover' },
          ]}
        />
      </Specimen>

      <Specimen label="Tabs" note="Arrow keys move, Tab leaves the list" bodyClassName="p-4 pt-3">
        <Tabs defaultValue="content" value={tab} onValueChange={setTab}>
          <TabList label="Document view">
            <Tab value="content">Content</Tab>
            <Tab value="history">History</Tab>
            <Tab value="comments">Comments</Tab>
            <Tab value="settings" disabled>
              Settings
            </Tab>
          </TabList>
          <TabPanel value="content" className="text-xs leading-relaxed text-muted">
            The document body, at the reading measure, with breakout blocks where a table or a
            diagram needs the room.
          </TabPanel>
          <TabPanel value="history" className="text-xs leading-relaxed text-muted">
            Every publish is a revision. Nobody stages, commits, branches, or pushes.
          </TabPanel>
          <TabPanel value="comments" className="text-xs leading-relaxed text-muted">
            Comments are anchored to the text they discuss and survive an edit above them.
          </TabPanel>
          <TabPanel value="settings">Settings.</TabPanel>
        </Tabs>
      </Specimen>

      <Specimen
        label="Tooltip and dialog"
        note="Both dismiss on Escape; the dialog traps focus"
        bodyClassName="flex flex-wrap items-center gap-2.5"
      >
        <Tooltip content="Creates a revision that readers can see">
          <Button
            variant="secondary"
            iconStart={<PublishIcon />}
            onClick={specimenAction(
              'This shows the button; the working control lives in the editor.',
            )}
          >
            Hover or focus me
          </Button>
        </Tooltip>

        <Dialog
          title="Discard this draft?"
          description="The published revision is untouched. Your unpublished changes are lost."
          trigger={<Button variant="danger">Discard draft</Button>}
          footer={
            <>
              <DialogClose>
                <Button variant="secondary">Keep editing</Button>
              </DialogClose>
              <DialogClose>
                <Button variant="danger">Discard</Button>
              </DialogClose>
            </>
          }
        >
          <p>
            You have edited this draft in three sessions since the last publish. Discarding returns
            the document to the revision published on 4 September.
          </p>
          <Input label="Type the document title to confirm" placeholder="Regional failover" />
        </Dialog>
      </Specimen>
    </>
  )
}

/** The three groups the palette specimen offers, so the grouping is what is shown. */
const PALETTE_GROUPS = [
  {
    id: 'current',
    label: 'In this workspace',
    options: [
      {
        id: 'failover',
        label: 'Regional failover',
        detail: <PaletteTrail>Engineering / Runbooks</PaletteTrail>,
      },
      {
        id: 'auth',
        label: 'Authentication architecture',
        detail: <PaletteTrail>Engineering / Architecture</PaletteTrail>,
      },
    ],
  },
  {
    id: 'platform',
    label: 'Platform docs',
    options: [
      {
        id: 'charter',
        label: 'Platform team charter',
        detail: <PaletteTrail>Platform docs / Docs</PaletteTrail>,
      },
    ],
  },
]

function PaletteTrail({ children }: { readonly children: ReactNode }) {
  return <span className="text-2xs text-muted">{children}</span>
}

/**
 * The command palette: a field over a grouped list, driven entirely from the
 * keyboard. The rows here are fixed, because what the specimen is for is the
 * shape and the keys — arrows move the active option without moving focus,
 * Enter chooses, Escape closes.
 */
export function CommandPaletteSpecimen() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  return (
    <Specimen
      label="Command palette"
      note="Arrows move the active row; focus never leaves the field"
      bodyClassName="flex flex-wrap items-center gap-2.5"
    >
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true)
        }}
      >
        Open the palette
      </Button>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        title="Search documentation"
        inputLabel="Search documentation"
        placeholder="Search documentation"
        value={query}
        onValueChange={setQuery}
        groups={PALETTE_GROUPS}
        onSelect={specimenAction('This shows the palette; the working one is in the app shell.')}
        footer={<p className="text-2xs text-muted">A specimen: nothing here opens a document.</p>}
      />
    </Specimen>
  )
}
