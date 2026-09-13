/**
 * The documents `pnpm --filter @quill/server seed` writes.
 *
 * They are real Markdown of the kind the first users write — an architecture
 * design with a wide table and code, a runbook with numbered steps and a
 * callout, two decision records, a system overview, an on-call guide, a
 * reading-surface showcase, a draft nobody has published yet, and three
 * built-in templates — so that a fresh instance shows the reading view, the
 * outline, syntax highlighting, health signals, backlinks, the not-published
 * state, and the New document dialog's template picker all doing something
 * real.
 */

export interface SeedDocument {
  readonly collection: string
  readonly title: string
  /** Front matter and body; the seed stamps the document's own id over the placeholder. */
  readonly markdown: string
  /** Titles of documents this one links to, resolved to canonical id URLs at seed time. */
  readonly links?: readonly string[]
  /** False for a document the seed creates but deliberately never publishes. Default true. */
  readonly published?: boolean
}

export const SEED_COLLECTIONS = ['Architecture', 'Runbooks', 'Decisions', 'Templates'] as const

const AUTHENTICATION = `---
title: Authentication architecture
type: design
owners: [platform@example.com]
tags: [authentication, security]
review:
  interval: 180d
---

# Authentication architecture

Every request to the platform carries either a session cookie or a bearer token.
This document describes how both are issued, how they are validated, and what
happens when a key is rotated.

:::callout{type=info}
Sessions are server-side rows. The cookie carries an opaque identifier and
never a claim.
:::

## Token shape

Tokens are compact JWTs signed with the current signing key. The payload is
deliberately small: everything else is looked up.

\`\`\`ts
export interface AccessToken {
  readonly sub: UserId
  readonly sid: SessionId
  readonly iat: number
  readonly exp: number
}

export function sign(claims: AccessToken, key: SigningKey): string {
  return jwt.sign(claims, key.privateKey, { algorithm: 'EdDSA', keyid: key.id })
}
\`\`\`

## Key rotation

| Key | Algorithm | Rotates | Grace period | Stored in | Rotated by | Alarms on |
| --- | --- | --- | --- | --- | --- | --- |
| Session signing | EdDSA | 90 days | 7 days | Secret manager | Scheduled job | Age over 100 days |
| Refresh signing | EdDSA | 180 days | 14 days | Secret manager | Scheduled job | Age over 200 days |
| Service mesh | ECDSA P-256 | 30 days | 2 days | Mesh control plane | Mesh operator | Age over 35 days |
| Backup encryption | AES-256-GCM | 365 days | 30 days | Hardware module | Security team | Age over 380 days |

A key is never deleted at rotation. It moves to the verification set for its
grace period, so a token signed a minute before rotation still validates.

## Failure modes

1. **The signing key is unavailable.** New sessions cannot be issued; existing
   ones keep working until they expire.
2. **A key is compromised.** It is removed from the verification set
   immediately, which signs out everyone holding a token signed by it.
3. **Clock skew.** Validation allows sixty seconds either way.
`

const FAILOVER = `---
title: Regional failover
type: runbook
owners: [sre@example.com]
tags: [runbook, incident]
review:
  interval: 90d
---

# Regional failover

Move all traffic out of a region. Expect eight to twelve minutes end to end.

:::callout{type=warning}
Failover is not reversible within the same hour: the database promotion is
one-way until replication has caught up in the other direction.
:::

## Before you start

- Confirm the region is genuinely unhealthy, not merely noisy.
- Announce in the incident channel that you are starting a failover.
- Have a second engineer on the call to confirm each irreversible step.

## Steps

1. **Drain the load balancer.** Set the region's weight to zero and wait for
   connections to finish.

   \`\`\`bash
   quillctl traffic set --region eu-west-1 --weight 0
   quillctl traffic watch --region eu-west-1 --until-drained
   \`\`\`

2. **Promote the standby database.** This is the irreversible step; have it
   confirmed before running it.

   \`\`\`bash
   quillctl db promote --region eu-central-1 --confirm
   \`\`\`

3. **Point the application at the promoted primary.** The deployment restarts
   pods in a rolling fashion; watch for connection errors as it goes.

4. **Verify.** Publish a document in a scratch workspace and read it back.

## After

- Open an incident record and link it here.
- Raise the replication direction ticket before the end of the day.
`

const ADR_CONTENT_STORE = `---
title: Documents are stored in a Git object model
type: adr
status: published
owners: [platform@example.com]
tags: [decision, storage]
---

# Documents are stored in a Git object model

## Status

Accepted.

## Context

Documents must be storable on a filesystem, in object storage, and optionally
synchronised with a Git repository, with full history, while nobody using the
product ever sees a commit.

## Decision

The content store implements the Git object model directly over a six-method
object store. Publish is the only write, and every publish is a revision.

## Consequences

A repository written by the platform is readable by the \`git\` command line,
which is checked on every change. Rename detection by similarity is not
available, because history follows the document identifier instead.
`

const ADR_REVIEW = `---
title: Documents carry a review interval
type: adr
status: published
owners: [docs@example.com]
tags: [decision, quality]
review:
  interval: 365d
  lastReviewed: 2026-01-05
---

# Documents carry a review interval

## Status

Accepted.

## Context

Documentation rots quietly. The first users asked for a way to see that a page
has not been looked at since it was written.

## Decision

Front matter carries \`review.interval\`, counted from the last recorded review
or, when there is none, from the last publish. An overdue document shows a
quiet signal beside it, never an error.

## Consequences

A team can answer "what has gone stale?" without a spreadsheet. Nothing is
blocked by a review being overdue.
`

const OVERVIEW = `---
title: System overview
type: design
owners: [platform@example.com]
tags: [overview]
---

# System overview

The platform is a Fastify server, a React application, Postgres for everything
except document content, and a content store for the documents themselves.

## Shape

| Part | Holds | Notes |
| --- | --- | --- |
| Server | API, rendering, background jobs | One process; the job runner polls the outbox |
| Postgres | Units, users, grants, drafts, locks, the revisions index | Never document content |
| Content store | Published Markdown, every revision | A Git object model; users never see it |
| Blob store | Attachments, addressed by hash | Filesystem or S3-compatible |

## Reading a document

A read is two requests: the body, which is cached by content hash, and the
envelope, which is fetched fresh because it carries who is editing, what the
reader may do, and whether the document is overdue for review.

## Where to go next

The authentication design covers how a request is identified. The failover
runbook covers what to do when a region is unhealthy.
`

const ON_CALL = `---
title: On-call guide
type: runbook
owners: [sre@example.com]
tags: [runbook, on-call]
review:
  interval: 180d
---

# On-call guide

One engineer holds the pager for a week, from Wednesday morning to Wednesday
morning.

:::callout{type=tip}
Hand over in writing, in the incident channel, even when nothing happened.
:::

## What you are responsible for

- Acknowledging a page within five minutes during working hours, fifteen
  outside them.
- Deciding whether an alert is an incident. Most are not.
- Writing the incident record while it is fresh.

## The first five minutes

1. Acknowledge the page so nobody else is woken.
2. Read the alert. Check the dashboard it links to before touching anything.
3. Say what you see in the incident channel, even if it is "still looking".
4. If the region is unhealthy, follow the failover runbook rather than
   improvising.

## Escalating

Escalate when you are not making progress after twenty minutes, when customer
data may be affected, or when you are about to do something irreversible.
`

const READING_SURFACE_TOUR = `---
title: Reading surface tour
type: design
owners: [platform@example.com]
tags: [design-system, showcase]
---

# Reading surface tour

A tour of the reading surface: every callout tone, both breakout widths, five
fenced languages, a task list, and a footnote.[^review]

## Callouts

:::callout{type=note}
A note calls out something worth knowing, not something urgent.
:::

:::callout{type=info}
Info carries background a reader can skip if they already know it.
:::

:::callout{type=tip}
A tip is optional advice: skipping it costs nothing.
:::

:::callout{type=warning}
A warning marks something that causes trouble if ignored.
:::

:::callout{type=caution}
Caution is for the step that cannot be undone.
:::

## Layout widths

### A table wide enough to need it

:::wide
| Region | Endpoint | Latency budget | Owner | Alerts on | Runbook |
| --- | --- | --- | --- | --- | --- |
| us-east-1 | api.us-east-1.example | 120ms | Platform | p99 over budget | Regional failover |
| eu-west-1 | api.eu-west-1.example | 140ms | Platform | p99 over budget | Regional failover |
| ap-southeast-2 | api.ap-southeast-2.example | 160ms | SRE | p99 over budget | Regional failover |
:::

### A full-width image

:::full
![System landscape, drawn wide](https://placehold.co/1200x400?text=System+landscape)
:::

## Five languages

\`\`\`ts
export function retryable<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  return fn().catch((error) =>
    attempts <= 1 ? Promise.reject(error) : retryable(fn, attempts - 1),
  )
}
\`\`\`

\`\`\`sql
select workspace_id, count(*) as documents
from documents
where status = 'published'
group by workspace_id
order by documents desc;
\`\`\`

\`\`\`bash
quillctl traffic set --region eu-west-1 --weight 0
\`\`\`

\`\`\`json
{ "documentId": "0000-0000-0000-0000", "status": "published", "review": { "interval": "180d" } }
\`\`\`

\`\`\`diff
- review:
-   interval: 365d
+ review:
+   interval: 180d
\`\`\`

## Before this ships

- [x] Every callout tone renders
- [x] Wide and full widths both hold real content
- [ ] Read on a phone

[^review]: Review intervals are covered in "Documents carry a review interval".
`

const ADR_TEMPLATE = `---
title: Architecture decision record
type: template
template:
  name: Architecture decision record
  category: Engineering
  version: 1
  questions:
    - id: decisionTitle
      label: Title of the decision
      type: text
    - id: status
      label: Initial status
      type: choice
      options: [proposed, accepted]
      default: proposed
    - id: consideredAlternatives
      label: Were alternatives considered?
      type: boolean
      optional: true
      help: Adds a section for the alternatives and why they were not chosen.
  sections:
    - heading: Context
      required: true
    - heading: Decision
      required: true
    - heading: Alternatives considered
      when: consideredAlternatives
      optional: true
---

# {{ answers.decisionTitle }}

:::guidance
Say what is being decided in one sentence before the context. A reader
should never have to reach the alternatives to find out what this is for.
:::

## Context

:placeholder[What forces make this decision necessary now?]

## Decision

:placeholder[What was decided, in one paragraph.]

::::when{question=consideredAlternatives}
## Alternatives considered

:::repeat{title="Alternative option"}
### Alternative

:placeholder[What was considered, and why it was not chosen.]
:::
::::
`

const TECHNICAL_DESIGN_TEMPLATE = `---
title: Technical design
type: template
template:
  name: Technical design
  category: Engineering
  version: 1
  questions:
    - id: summary
      label: One-line summary
      type: text
      optional: true
  sections:
    - heading: Summary
      required: true
    - heading: Design
      required: true
    - heading: Rollout
      optional: true
    - heading: Open questions
      optional: true
---

# Technical design

:::guidance
Write for someone who was not in the room: the problem, the shape of the
change, and what could go wrong.
:::

## Summary

:placeholder[One paragraph: what is being built and why.]

## Design

:placeholder[The approach, the components involved, and why this shape.]

:::optional{title="Rollout"}
## Rollout

:placeholder[How this ships: stages, flags, and the rollback plan.]
:::

:::optional{title="Open questions"}
## Open questions

:placeholder[What is still undecided.]
:::
`

const RUNBOOK_TEMPLATE = `---
title: Runbook
type: template
template:
  name: Runbook
  category: Engineering
  version: 1
  questions:
    - id: service
      label: Which service is this for?
      type: text
  sections:
    - heading: Before you start
      required: true
    - heading: Steps
      required: true
---

# Runbook

:::guidance
Write it so the person running this at 3 a.m. only has to follow, not think.
:::

## Before you start

:placeholder[What to confirm before running any step.]

## Steps

:::repeat{title="Step"}
### Step

:placeholder[One action, and how to tell it worked.]
:::
`

const INCIDENT_REVIEW_DRAFT = `---
title: Incident review template (draft)
type: runbook
owners: [sre@example.com]
tags: [runbook, incident, draft]
---

# Incident review template

:::guidance
Fill this in within two working days of the incident, while the timeline is
still fresh.
:::

## Summary

:placeholder[One paragraph: what broke, for how long, who was affected.]

## Timeline

:placeholder[What happened, in order, with timestamps.]

## Contributing factors

:placeholder[What made this possible, not just what triggered it.]

## Follow-up actions

:placeholder[What changes, and who owns each one.]
`

export const SEED_DOCUMENTS: readonly SeedDocument[] = [
  { collection: 'Architecture', title: 'Authentication architecture', markdown: AUTHENTICATION },
  { collection: 'Architecture', title: 'System overview', markdown: OVERVIEW },
  { collection: 'Architecture', title: 'Reading surface tour', markdown: READING_SURFACE_TOUR },
  { collection: 'Runbooks', title: 'Regional failover', markdown: FAILOVER },
  { collection: 'Runbooks', title: 'On-call guide', markdown: ON_CALL },
  {
    collection: 'Runbooks',
    title: 'Incident review template (draft)',
    markdown: INCIDENT_REVIEW_DRAFT,
    published: false,
  },
  {
    collection: 'Decisions',
    title: 'Documents are stored in a Git object model',
    markdown: ADR_CONTENT_STORE,
  },
  { collection: 'Decisions', title: 'Documents carry a review interval', markdown: ADR_REVIEW },
  {
    collection: 'Templates',
    title: 'Architecture decision record',
    markdown: ADR_TEMPLATE,
  },
  {
    collection: 'Templates',
    title: 'Technical design',
    markdown: TECHNICAL_DESIGN_TEMPLATE,
  },
  { collection: 'Templates', title: 'Runbook', markdown: RUNBOOK_TEMPLATE },
]

/**
 * The links the seed adds once every document has an identifier.
 *
 * Links between documents are canonical id URLs (ADR-031), so they can only be
 * written after the documents they point at exist — which is also what makes
 * the seed populate the link index with something real.
 */
export const SEED_LINKS: Readonly<Record<string, readonly string[]>> = {
  'System overview': ['Authentication architecture', 'Regional failover'],
  'On-call guide': ['Regional failover'],
  'Regional failover': ['On-call guide'],
}

/**
 * The second workspace: a smaller unit and workspace so the organisational
 * tree has real depth, not just one company with one team under it.
 */
export const SECOND_WORKSPACE_COLLECTIONS = ['Docs'] as const

const PLATFORM_CHARTER = `---
title: Platform team charter
type: design
owners: [platform@example.com]
---

# Platform team charter

The Platform team owns the content store, the render pipeline, and the
infrastructure every workspace runs on. Feature teams own their own
documents; Platform owns what makes documents possible at all.

## What we support

- The Fastify API and its background jobs.
- The Postgres schema and its migrations.
- The content store and the render cache.

## Where to reach us

File an issue in the Engineering workspace and tag \`platform\`.
`

export const SECOND_WORKSPACE_DOCUMENTS: readonly SeedDocument[] = [
  { collection: 'Docs', title: 'Platform team charter', markdown: PLATFORM_CHARTER },
]
