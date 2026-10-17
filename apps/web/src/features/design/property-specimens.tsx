import { useState } from 'react'

// The entry of its own, not the package's: the package's brings the whole editor.
import { DocumentProperties, type PeopleDirectory } from '@quill/editor/properties'
import { DocumentByline, LifecycleNotice, PlainLink, TokenInput } from '@quill/ui'

import { now as wallClock } from '../../lib/time/clock.ts'
import { Specimen } from './specimen-layout.tsx'

/**
 * Document properties (`docs/design/properties.md`): the byline a reader
 * sees, the same line as the author edits it, and the token field the tags
 * and owners are edited with. Everything here is live; nothing is saved.
 */

const NOW = new Date(wallClock())
const DAY = 24 * 60 * 60 * 1000

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString().slice(0, 10)
}

const PEOPLE = [
  { value: 'alex@example.com', name: 'Alex Chen', detail: 'alex@example.com' },
  { value: 'ada@example.com', name: 'Ada Lovelace', detail: 'ada@example.com' },
  { value: 'grace@example.com', name: 'Grace Hopper', detail: 'grace@example.com' },
  { value: 'mei@example.com', name: 'Mei Tanaka', detail: 'mei@example.com' },
]

const directory: PeopleDirectory = {
  nameOf: (value) => PEOPLE.find((person) => person.value === value)?.name,
  search: async (query) =>
    PEOPLE.filter((person) =>
      `${person.name} ${person.value}`.toLowerCase().includes(query.toLowerCase()),
    ),
}

const SPECIMEN_FRONT_MATTER: Record<string, unknown> = {
  id: '6b1d3c1e-0000-4000-8000-000000000001',
  status: 'draft',
  type: 'Runbook',
  owners: ['alex@example.com', 'platform-team'],
  tags: ['database', 'on-call', 'failover'],
  review: { interval: '6m', lastReviewed: daysAgo(95) },
  service: 'billing-api',
}

function EditableSpecimen() {
  const [frontMatter, setFrontMatter] = useState(SPECIMEN_FRONT_MATTER)
  return (
    <DocumentProperties
      frontMatter={frontMatter}
      headingTitle="Regional failover"
      people={directory}
      tagSuggestions={['database', 'deploys', 'incident', 'on-call', 'security']}
      onChange={setFrontMatter}
    />
  )
}

function TokenSpecimen() {
  const [tags, setTags] = useState<readonly string[]>(['database', 'on-call'])
  const [query, setQuery] = useState('')
  const known = ['database', 'deploys', 'incident', 'on-call', 'security']
  const offered = known.filter((tag) => !tags.includes(tag) && tag.includes(query.toLowerCase()))
  return (
    <div className="max-w-sm">
      <TokenInput
        label="Tags"
        description="Enter or a comma adds a tag. Paste a list to add several."
        tokens={tags.map((tag) => ({ id: tag, label: tag }))}
        query={query}
        onQueryChange={setQuery}
        groups={
          offered.length === 0
            ? []
            : [
                {
                  id: 'tags',
                  label: 'Suggested',
                  options: offered.map((tag) => ({ id: tag, label: tag })),
                },
              ]
        }
        onChoose={(tag) => {
          setTags([...tags, tag])
          setQuery('')
        }}
        onEnterText={(texts) => {
          setTags([...tags, ...texts.filter((text) => !tags.includes(text))])
          setQuery('')
        }}
        onRemove={(tag) => {
          setTags(tags.filter((entry) => entry !== tag))
        }}
      />
    </div>
  )
}

export function PropertySpecimens() {
  return (
    <div className="flex flex-col gap-6">
      <Specimen label="Byline" note="what a reader sees under the title">
        <DocumentByline
          owners={[
            { label: 'Alex Chen', person: true },
            { label: 'platform-team', person: false },
          ]}
          lifecycle={{
            state: 'verified',
            by: 'Grace Hopper',
            at: new Date(NOW.getTime() - 15 * DAY),
          }}
          type="Runbook"
          updatedAt={new Date(NOW.getTime() - 3 * DAY)}
          lastReviewed={new Date(NOW.getTime() - 40 * DAY)}
          reviewDue={{ at: new Date(NOW.getTime() + 140 * DAY), overdue: false }}
          tags={['database', 'on-call']}
          now={NOW}
          tagTarget={(tag) => ({ to: '/design', hash: `tag-${tag}` })}
          linkComponent={PlainLink}
        />
      </Specimen>
      <Specimen
        label="Byline, review overdue"
        note="said in words, with a glyph; never colour alone"
      >
        <DocumentByline
          owners={[{ label: 'Grace Hopper', person: true }]}
          lifecycle={{ state: 'verified', by: 'Grace Hopper', lapsed: true }}
          lastReviewed={new Date(NOW.getTime() - 400 * DAY)}
          reviewDue={{ at: new Date(NOW.getTime() - 35 * DAY), overdue: true }}
          now={NOW}
        />
      </Specimen>
      <Specimen label="Byline, deprecated" note="the notice says where to go instead">
        <div>
          <DocumentByline
            owners={[{ label: 'Alex Chen', person: true }]}
            lifecycle={{ state: 'deprecated' }}
            reviewDue={{ at: new Date(NOW.getTime() + 6 * DAY), overdue: false, soon: true }}
            now={NOW}
          />
          <LifecycleNotice
            replacement={{
              target: { to: '/design', hash: 'runbook-v2' },
              title: 'Failover runbook, v2',
            }}
            linkComponent={PlainLink}
          />
        </div>
      </Specimen>
      <Specimen
        label="Properties, as an author edits them"
        note="press any value; Add property offers what is not set"
      >
        <EditableSpecimen />
      </Specimen>
      <Specimen label="Token field" note="the tags and owners editor">
        <TokenSpecimen />
      </Specimen>
    </div>
  )
}
