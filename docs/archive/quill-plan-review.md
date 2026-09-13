# Quill

## Open Source Documentation Platform
### Product, Architecture & Engineering Handover for Review

---

## 1. Purpose of This Document

This document captures the current product vision, architectural direction, engineering standards, and proposed delivery plan for **Quill**, an open-source documentation platform.

It is intended as a **handover/review document** rather than a final specification.

The purpose of review is to challenge assumptions, identify missing investigations, validate architectural boundaries, and refine priorities **before substantial implementation begins**.

---

# 2. Vision

Build **Quill**, an open-source, self-hostable documentation platform designed to make excellent documentation the easiest thing to create, maintain, discover, and consume.

Quill should occupy the space between:

- Confluence
- Notion
- GitBook
- Outline
- Docusaurus
- Backstage TechDocs
- modern docs-as-code tooling

without simply becoming a clone of any of them.

Quill should combine:

- Markdown portability
- Rich editing
- Beautiful rendering
- Strong information architecture
- Templates
- Interactive documentation
- Git-aware content
- Source artifacts
- Rich embeds
- Search
- Versioning
- Enterprise permissions
- Extensible integrations
- Self-hosting

The intended feeling is:

> **A thoughtfully designed publishing system for organisational knowledge.**

Not:

> "Enterprise wiki software with a nicer UI."

---

# 3. Product North Star

Every significant product and architectural decision should be evaluated against:

> **Does this make it easier to create, maintain, understand, find, or trust documentation?**

Quill should make:

- Writing feel effortless.
- Structure emerge naturally.
- Documents look excellent by default.
- Information easy to find.
- Relationships between documents obvious.
- Documentation easy to maintain.
- Source provenance visible.
- Interactive procedures useful without becoming applications.
- Rich content powerful without becoming proprietary.
- Enterprise permissions understandable.
- The interface fast and calm.

---

# 4. Core Product Principles

## 4.1 Documentation First

Everything should serve the creation, maintenance, discovery, or consumption of documentation.

Quill should not become a generic:

- Project management platform
- Database builder
- Spreadsheet
- Whiteboard
- Chat application
- Low-code application builder

Features should serve documentation.

---

## 4.2 Beautiful by Default

Users should not need to manually style documents.

Prioritise:

- Typography
- Spacing
- Hierarchy
- Comfortable line lengths
- Tables
- Code
- Images
- Diagrams
- Callouts
- Navigation
- Metadata
- Printability

Visual quality should be part of the product's fundamental value proposition.

---

## 4.3 Simple Until Complexity Earns Its Place

A new user should be able to:

1. Open a workspace.
2. Create a document.
3. Start writing.

Advanced functionality should be available without being forced into the primary workflow.

Use progressive disclosure.

---

## 4.4 Structure Without Bureaucracy

Encourage good information architecture without requiring rigid structures for every document.

A workspace may naturally evolve into:

````text
Workspace
├── Engineering
│   ├── Architecture
│   │   ├── System Overview
│   │   └── Authentication
│   ├── Runbooks
│   └── Incident Management
├── Product
└── Operations
````

The platform should help this structure emerge naturally.

---

## 4.5 Portable by Design

Documentation must not be trapped inside Quill.

Markdown should remain a first-class representation.

Users should be able to:

- Export Markdown
- Put documentation in Git
- Open files in VS Code
- Move documentation elsewhere
- Generate static sites
- Export to HTML/PDF/DOCX
- Keep attachments and source artifacts

---

## 4.6 Source Provenance

Where content originates from elsewhere, preserve that relationship.

Examples include:

- GitHub
- Bitbucket
- GitLab
- SQL
- Mermaid
- Draw.io
- OpenAPI
- External URLs
- Generated charts

The platform should be able to answer:

> "Where did this come from?"

---

## 4.7 Interactive When Useful

Interactive capabilities should improve specific workflows without turning every document into an application.

Particularly useful for:

- Runbooks
- Troubleshooting
- Incident response
- Deployment procedures
- Decision guides
- Onboarding
- Support procedures

---

## 4.8 Open and Extensible

Providers, integrations, storage, search, authentication, and embeds should be replaceable or extendable without modifying the core domain unnecessarily.

---

# 5. Investigation Phase

Before substantial implementation, perform focused investigations and technical spikes.

The objective is to eliminate architectural uncertainty before large amounts of code are written.

Each investigation should produce:

- Findings
- Recommendation
- Trade-offs
- Prototype where appropriate
- ADR

Investigations should be time-boxed and should directly influence implementation decisions.

The investigation phase is part of the plan, not a prelude to "real" work.

---

# 6. Investigation 1 — Competitive Analysis

Study:

- Confluence
- Notion
- Outline
- BookStack
- Wiki.js
- GitBook
- Docusaurus
- MkDocs
- Backstage TechDocs

Assess:

### Information architecture

- Workspaces/spaces
- Collections
- Navigation
- Nested documents
- Breadcrumbs
- Related content

### Authoring

- Editor quality
- Markdown
- Rich text
- Tables
- Code
- Media
- Templates

### Consumption

- Typography
- Navigation
- Search
- Mobile
- Print/export

### Maintenance

- Ownership
- Review cycles
- Staleness
- Broken links
- Versioning

### Administration

- Permissions
- SSO
- Groups
- Audit

### Integrations

- Git
- Embeds
- APIs
- Webhooks

### Operational model

- Self-hosting
- Performance
- Deployment
- Backup/recovery

For each product document:

````text
What it does exceptionally well
What users dislike
What we should borrow
What we should improve
What we should explicitly avoid
````

Deliverable:

````text
docs/research/competitive-analysis.md
````

---

# 7. Investigation 2 — Markdown and AST Architecture

This is one of the most important technical investigations.

Research:

- CommonMark
- GitHub Flavored Markdown
- YAML front matter
- unified
- remark
- rehype
- Markdown directives
- MDX
- AST extensions
- source maps
- lossless serialisation
- round-trip fidelity

Determine the canonical architecture:

````text
Markdown
   ↓
Parser
   ↓
Internal AST
   ↓
Editor / Renderer / Exporters
````

Preferred direction:

> **Markdown is the durable source representation; the AST is the application's working representation.**

The AST should not become a reason to abandon portable Markdown.

Deliverables:

````text
ADR-002 — Markdown as canonical format
ADR-004 — Internal document AST
````

---

# 8. Investigation 3 — Quill Editor Architecture

The project has selected **Quill** as the current working editor/document authoring foundation.

Validate the choice against the actual requirements:

- Markdown fidelity
- Rich formatting
- Custom blocks
- Interactive blocks
- Tables
- Code
- Images
- Embeds
- Source references
- Accessibility
- Performance
- Mobile editing
- Extensibility

Prototype:

````text
Markdown
   ↓
Quill editor
   ↓
AST/content model
   ↓
Markdown
````

with meaningful round-trip preservation.

The editor's internal state must not silently become the domain model.

Deliverable:

````text
ADR-003 — Editor Architecture
````

---

# 9. Investigation 4 — Front Matter and Schema

Use:

**YAML front matter + JSON Schema**

Front matter should represent metadata and document behaviour.

Example:

````yaml
---
title: Authentication Architecture
description: Authentication architecture for platform APIs.
type: technical-design
status: published

owners:
  - platform

tags:
  - architecture
  - security

review:
  interval: 180d
  lastReviewed: 2026-08-15
---
````

Support:

- Core schema
- Workspace schemas
- Template schemas
- Validation
- Schema versions
- UI generation

### Critical rule

Unknown metadata must be preserved.

Never silently discard front matter that Quill does not understand.

Deliverable:

````text
ADR-005 — Front Matter Schema
````

---

# 10. Investigation 5 — Interactive Documentation

Prototype:

- Decision trees
- Troubleshooting
- Guided procedures
- Checklists
- Conditional content
- Lightweight forms
- Progress

Example:

````markdown
:::decision
Are requests reaching the API?

- Yes → service-health
- No → gateway-routing
:::
````

Rendered experience:

````text
Are requests reaching the API?

       [ Yes ]    [ No ]
          ↓         ↓
       Service    Gateway
        Health    Routing
````

### Fundamental requirement

Interactive functionality must have a useful static Markdown representation.

Interactive documents remain documents.

Deliverable:

````text
ADR-006 — Interactive Document Representation
````

---

# 11. Investigation 6 — Source Artifacts

Define the generic concept:

> **Rendered representation + source artifact**

Examples:

````text
Draw.io
 ├── rendered diagram
 └── architecture.drawio

Mermaid
 ├── rendered diagram
 └── architecture.mmd

SQL result
 ├── rendered results
 └── query.sql

Chart
 ├── rendered chart
 └── source/data
````

Investigate:

- Storage
- Relationships
- Versioning
- MIME handling
- Export
- Provenance
- Caching

This should be foundational, not diagram-specific.

Deliverable:

````text
ADR-007 — Source Artifact Model
````

---

# 12. Investigation 7 — Git Provider Architecture

Define provider-neutral concepts:

````text
Repository
SourceFile
Revision
SourceReference
````

Not:

````text
GithubRepository
GithubFile
BitbucketRepository
````

Investigate:

- GitHub
- GitHub Enterprise
- GitLab
- Bitbucket Cloud
- Bitbucket Server/Data Center
- Generic Git

Potential capabilities:

````text
repositories
files
revisions
pullRequests
issues
webhooks
````

Use capability-specific interfaces.

Example:

````ts
interface FileProvider {
  getFile(reference: SourceReference): Promise<SourceFile>
}

interface RevisionProvider {
  getRevision(reference: RevisionReference): Promise<Revision>
}
````

Separate:

````text
Provider = implementation
Integration = configured instance
````

Example:

````yaml
source:
  integration: corporate-github
  repository: platform/payments
  revision: 8f31c72
  path: src/config.ts
  lines:
    start: 42
    end: 71
````

### Architectural test

> Can Bitbucket support be added without changing the document domain?

If not, the abstraction boundary is wrong.

Deliverable:

````text
ADR-008 — Provider Architecture
````

---

# 13. Investigation 8 — Rich Embeds

Define:

````text
URL
 ↓
Provider detection
 ↓
Metadata resolution
 ↓
Rich preview
 ↓
Optional embedded view
````

Research:

- Open Graph
- oEmbed
- JSON-LD
- CSP
- iframe sandboxing
- provider APIs

Potential providers:

- Generic webpages
- Articles
- YouTube
- Figma
- GitHub
- GitLab
- Bitbucket
- Jira
- Linear
- Loom
- Google Docs

Unknown or unavailable providers should gracefully degrade into useful link cards.

Deliverable:

````text
ADR-009 — Embed Architecture
````

---

# 14. Investigation 9 — Search

Evaluate:

- PostgreSQL full-text search
- Meilisearch
- Typesense
- OpenSearch
- Tantivy

Prioritise:

````text
Title
 ↓
Heading
 ↓
Body
````

Support:

- Fuzzy search
- Typo tolerance
- Snippets
- Highlighting
- Filters
- Permission-aware results

Design so semantic/hybrid search could be added later without replacing the initial search architecture.

Deliverable:

````text
ADR-010 — Search Architecture
````

---

# 15. Investigation 10 — Documentation Quality

Investigate:

- Freshness
- Ownership
- Review cycles
- Broken links
- Orphans
- Duplicate content
- Heading structure
- Accessibility metadata
- Documentation health

Potential signals:

````text
Stale
No owner
Broken links
Orphaned
Missing alt text
Incomplete metadata
Poor structure
````

Quality signals should encourage good habits without becoming bureaucratic gates.

---

# 16. Investigation 11 — React Architecture

Preferred stack:

- React
- TypeScript
- Tailwind CSS
- TanStack Router
- TanStack Query
- TanStack Store
- TanStack Table where useful
- TanStack Form where useful
- Vite
- Accessible component primitives

State ownership:

````text
Server state
→ TanStack Query

URL state
→ TanStack Router

Shared client state
→ TanStack Store

Local UI state
→ React state

React-dependent logic
→ Custom hooks

Domain/application logic
→ Plain TypeScript
````

Core principle:

> If logic does not need React, it should not live in React.

---

# 17. Reactive Architecture and Effects

Reactive programming is explicitly allowed and encouraged where appropriate.

The application may use:

- Observers
- Subscriptions
- WebSockets
- Event streams
- External stores
- Browser APIs
- Editor events
- Application events

The concern is indiscriminate use of React's `useEffect` as generic orchestration.

Follow the principles behind React's "You Might Not Need an Effect" guidance.

Prefer:

- Deriving values during rendering
- Event handlers for user-driven actions
- TanStack Query for server-state lifecycle
- External stores/subscriptions for external reactive state

### Effects

`useEffect` is primarily for synchronising React with external systems.

Legitimate examples:

- DOM APIs
- WebSockets
- ResizeObserver
- IntersectionObserver
- Third-party editors
- Browser APIs
- External stores
- Event emitters

Suspicious examples:

````text
state changed
 ↓
useEffect
 ↓
set another state
 ↓
another useEffect
 ↓
business operation
````

The goal is not zero Effects.

The goal is:

> **A small number of well-justified, isolated Effects.**

---

# 18. Investigation Deliverables

Recommended initial repository structure:

````text
docs/
├── research/
│   ├── competitive-analysis.md
│   ├── markdown-analysis.md
│   ├── editor-analysis.md
│   ├── interactive-docs.md
│   ├── source-integrations.md
│   ├── embed-architecture.md
│   ├── search-analysis.md
│   └── documentation-quality.md
│
└── architecture/
    └── decisions/
````

Initial ADRs:

````text
ADR-001 Product philosophy
ADR-002 Markdown as canonical document format
ADR-003 Editor architecture
ADR-004 Internal document AST
ADR-005 Front matter schema
ADR-006 Interactive document representation
ADR-007 Source artifact model
ADR-008 Provider/integration architecture
ADR-009 Embed architecture
ADR-010 Search architecture
ADR-011 Authentication architecture
ADR-012 Permission model
ADR-013 Frontend state architecture
ADR-014 Storage architecture
ADR-015 Versioning architecture
ADR-016 Export architecture
````

---

# 19. Core Architecture

High-level dependency direction:

````text
UI
 ↓
Features
 ↓
Application
 ↓
Domain
 ↓
Infrastructure
````

Domain must not depend on React.

UI must not directly depend on vendor APIs.

External APIs terminate at infrastructure/provider boundaries.

---

# 20. Frontend Project Structure

Start with a clean structure immediately:

````text
src/
├── app/
│   ├── router/
│   ├── providers/
│   ├── layouts/
│   └── config/
│
├── components/
│   ├── primitives/
│   └── ui/
│
├── features/
│   ├── documents/
│   ├── workspaces/
│   ├── search/
│   ├── templates/
│   ├── revisions/
│   ├── permissions/
│   ├── authentication/
│   ├── interactive-docs/
│   └── integrations/
│
├── domain/
│   ├── document/
│   ├── workspace/
│   ├── permission/
│   ├── source/
│   ├── template/
│   └── revision/
│
├── application/
│   ├── documents/
│   ├── publishing/
│   ├── search/
│   └── integrations/
│
├── infrastructure/
│   ├── api/
│   ├── auth/
│   ├── database/
│   ├── storage/
│   ├── search/
│   └── providers/
│
├── lib/
│   ├── markdown/
│   ├── validation/
│   ├── formatting/
│   └── utilities/
│
└── styles/
````

The structure should evolve with genuine boundaries.

Do not create architectural folders solely for appearances.

---

# 21. Component Architecture

Components should be:

- Lean
- Cohesive
- Composable
- Accessible
- Testable

Prefer:

````tsx
<DocumentPage>
  <DocumentHeader />
  <DocumentToolbar />
  <DocumentContent>
    <TableOfContents />
    <DocumentBody />
    <DocumentSidebar />
  </DocumentContent>
</DocumentPage>
````

Avoid giant components.

Avoid meaningless fragmentation.

Extract components around meaningful concepts and responsibilities.

---

# 22. Business Logic

Business logic should remain outside rendering code wherever practical.

Examples:

````ts
canEditDocument()
resolveDocumentPermissions()
buildDocumentTree()
parseFrontMatter()
resolveSourceReference()
calculateInteractiveFlowState()
validateTemplate()
````

These should be framework-independent.

Do not turn every function into a custom hook.

---

# 23. Custom Hooks

Use custom hooks where logic genuinely depends on React.

Examples:

````text
useDocumentEditor()
useDocumentNavigation()
useKeyboardShortcut()
useMediaQuery()
useFocusManagement()
useEditorSubscription()
useInteractiveFlow()
````

Hooks should encapsulate React-specific behaviour.

They should not become application-wide business-logic dumping grounds.

---

# 24. State Architecture

Use the correct mechanism for the correct state.

### TanStack Query

Server state:

````text
Documents
Users
Workspaces
Templates
Search results
Revisions
Integrations
````

### TanStack Router

URL state:

````text
Search query
Filters
Document
Tab
Sort
````

### TanStack Store

Shared client-side state where genuinely necessary.

Potential examples:

- Editor session state
- Shared navigation state
- Complex interactive-document state
- Application-level UI state that spans components

### React state

Local UI state:

- Dialogs
- Temporary input
- Expansion
- Hover/focus
- Ephemeral interaction

### Domain/application logic

Plain TypeScript.

---

# 25. State Principles

State should represent state.

Do not use state as a covert command/event bus.

Avoid patterns such as:

````ts
setShouldPublish(true)
````

followed by:

````ts
useEffect(() => {
  if (shouldPublish) {
    publish()
  }
}, [shouldPublish])
````

Prefer explicit commands or event handlers.

---

# 26. TypeScript

Use strict TypeScript.

Prefer:

- Explicit domain types
- Interfaces where useful
- String unions
- Discriminated unions
- Narrow types
- Type-safe API boundaries

Avoid:

- `any`
- Type assertions used to silence errors
- Excessively clever type-level programming
- Duplicated domain representations

Invalid states should be difficult to represent.

---

# 27. Formatting, Linting and Tooling

Use the modern Ox tooling ecosystem where appropriate:

- **oxfmt** for formatting
- **oxlint** for linting
- TypeScript for type checking

Tooling should be:

- Fast
- Deterministic
- Consistent
- Easy to understand

Provide obvious commands:

````text
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm check
````

`pnpm check` should represent the local quality gate.

CI should use the same core commands developers use locally.

---

# 28. TDD

Development should follow **Test-Driven Development** for meaningful behaviour.

Preferred loop:

````text
Red
 ↓
Green
 ↓
Refactor
````

Write tests before implementation where practical.

Tests should express intended behaviour, not merely implementation details.

---

# 29. Coverage

Aim for **full meaningful coverage**.

The intended quality gate is 100% coverage for applicable unit/application code, subject to explicit and reviewed exclusions where genuinely necessary.

Do not game coverage with meaningless tests.

High-value behavioural coverage is especially important for:

- Permissions
- Document hierarchy
- Markdown parsing
- Front matter
- Interactive flows
- Source references
- Revisions
- Import/export
- Provider adapters

Coverage exclusions should be:

- Rare
- Explicit
- Reviewed
- Documented

---

# 30. Testing Pyramid

## Unit

For:

- Domain logic
- Parsers
- Validation
- Transformations
- Permission rules
- Interactive state

## Integration

For:

- Application services
- Persistence
- Search
- Authentication
- Provider boundaries
- Import/export

## Component

For:

- Rendering
- Interaction
- Accessibility
- UI state

## End-to-End

For critical user journeys.

Example:

````text
Sign in
Create workspace
Create document
Edit document
Create child page
Search
Publish
Change permissions
View revision
Restore revision
Export
Use interactive runbook
````

---

# 31. Testability

If logic is hard to test, first question whether the architecture is too coupled.

Avoid requiring:

- Full application rendering
- Real network services
- Global mutable state
- Hidden singleton dependencies
- Giant provider trees

for tests that should be simple.

---

# 32. Local Development

Local development must be intentionally excellent.

A new contributor should ideally be able to:

````text
clone repository
 ↓
install dependencies
 ↓
run one command
 ↓
application running
````

Provide:

- Local database
- Local object storage
- Local search where required
- Seed data
- Test users
- Example workspace
- Example documents
- Example templates
- Example interactive runbook
- Example source references

Use Docker Compose or equivalent when local infrastructure needs to be reproduced.

Avoid requiring multiple external SaaS systems just to run the project locally.

---

# 33. Development Experience

Optimise the development loop for:

- Fast dependency installation
- Fast startup
- Fast HMR
- Fast tests
- Fast lint
- Fast formatting
- Fast type checking
- Fast CI feedback

Avoid unnecessary services, build steps, and environment ceremony.

Developer experience is a first-class project requirement.

---

# 34. Repository Hygiene

Maintain a clean repository from day one.

Avoid:

- Generic `misc` dumping grounds
- Dead code
- Duplicate implementations
- Ambiguous file ownership
- Abandoned experiments
- Multiple competing abstractions for the same concept

Delete obsolete code.

Keep generated code clearly separated from handwritten code.

---

# 35. Design System

Use Tailwind CSS as the primary styling system.

Use:

- CSS variables
- Semantic design tokens
- Typography scale
- Spacing scale
- Consistent colour tokens
- Reusable primitives

Semantic tokens should look conceptually like:

````text
background
surface
foreground
muted
border
accent
success
warning
danger
````

Avoid arbitrary one-off styling and scattered magic values.

---

# 36. Core UI Primitives

Create reusable accessible primitives for:

- Button
- Input
- Select
- Dialog
- Dropdown
- Tooltip
- Tabs
- Badge
- Table
- Callout
- Breadcrumb
- Tree navigation
- Command palette
- Markdown content
- Code blocks
- Empty states
- Loading states
- Error states

Higher-level feature components should compose these.

---

# 37. Accessibility

Target WCAG 2.2 AA where practical.

Support:

- Keyboard navigation
- Screen readers
- Semantic HTML
- Focus management
- Focus-visible states
- Reduced motion
- Accessible tables
- Alt text
- Accessible editor controls

Accessibility is part of component design, not a later phase.

---

# 38. Cross-Browser Support

Support current versions of:

- Chrome
- Edge
- Firefox
- Safari

Across:

- Desktop
- Tablet
- Mobile

Explicitly test:

- Rich editor behaviour
- Clipboard
- File uploads
- Drag/drop
- Keyboard shortcuts
- Scrolling
- Mobile Safari
- Tables
- Code selection
- Printing
- Dialogs
- Responsive navigation

Browser-specific workarounds should be isolated and documented.

---

# 39. Responsive Design

Do not simply shrink the desktop UI.

Design mobile intentionally.

The following must work well on small screens:

- Document reading
- Search
- Navigation
- Light editing
- Tables
- Images
- Diagrams
- Interactive runbooks
- Dialogs

---

# 40. Document Model

Core concepts:

````text
User
Workspace
WorkspaceMember
Role
Permission
Group

Document
DocumentRevision
DocumentMetadata
DocumentPermission

Template
TemplateSchema

Attachment
MediaAsset
SourceArtifact
SourceReference

Tag
DocumentTag
DocumentLink

Collection
NavigationItem

Integration
Provider

SearchIndex
AuditEvent
````

Refine this during the investigation and architecture phases.

---

# 41. Markdown Document Model

Documents should conceptually consist of:

````text
Front Matter
+
Markdown Body
+
Referenced Assets
````

Internally:

````text
Markdown
 ↓
AST
 ↓
Application Model
````

The AST powers:

- Editing
- Rendering
- Search indexing
- Validation
- Export
- Interactive functionality

---

# 42. Markdown Syntax Principles

Prefer familiar syntax.

Use standard Markdown for:

- Headings
- Links
- Images
- Lists
- Tables
- Code
- Blockquotes

Use extensions only when necessary.

Example:

````markdown
````mermaid
graph TD
    API --> Service
    Service --> Database
````
````

Interactive example:

````markdown
:::decision
Are requests reaching the API?

- Yes → service-health
- No → gateway-routing
:::
````

---

# 43. Markdown Degradation

Every extension must have a meaningful fallback.

An unsupported directive should expose its inner content where possible.

Goal:

> **Markdown evolved, not Markdown replaced.**

A document should remain understandable outside Quill.

---

# 44. Markdown Round-Trip Fidelity

Target:

````text
Markdown
 ↓
Parse
 ↓
AST
 ↓
Edit
 ↓
Serialise
 ↓
Markdown
````

Preserve:

- Front matter
- Unknown metadata
- HTML
- Links
- Reference links
- Images
- Tables
- Code fences
- Comments where meaningful
- Extensions
- Source artifacts

Markdown output should be:

- Human-readable
- Deterministic
- Git-friendly
- Diff-friendly

Avoid unrelated formatting churn.

---

# 45. Front Matter

Use YAML front matter.

Example:

````yaml
---
title: API Authentication
description: Authentication architecture for platform APIs.
type: technical-design
status: published

owners:
  - platform

tags:
  - architecture
  - security

review:
  interval: 180d
  lastReviewed: 2026-08-15
---
````

Support:

- Core metadata
- Custom workspace fields
- Template-defined fields
- Validation
- Schema versioning

Unknown fields must survive round-trip conversion.

---

# 46. Interactive Documents

Interactive documentation is an optional layer over normal documents.

Initial interactive capabilities:

- Decisions
- Troubleshooting branches
- Guided procedures
- Checklists
- Conditional content
- Lightweight forms
- Progress

Interactive documents should never require a separate proprietary content system.

---

# 47. Interactive State

Separate:

````text
Document content
Interactive definition
Interactive user state
Execution state
````

A user's progress should not create a document revision.

Changing the actual flow should.

---

# 48. Interactive Export

Interactive documents must export to understandable static documentation.

Example:

````text
Troubleshooting

1. Are requests reaching the API?
   - Yes → Check service health
   - No → Check gateway routing

2. Is the service healthy?
   - Yes → Check configuration
   - No → Restart the service
````

---

# 49. External Actions

Never allow documents to silently perform dangerous operations.

Distinguish:

````text
Informational
Data collection
External action
````

External actions require:

- Explicit integrations
- Authorisation
- Permissions
- Confirmation
- Auditability

A document should not be able to delete resources, restart production systems, or deploy software simply because a command exists in the document.

---

# 50. Git-Aware Content

Support rendering Git content directly inside documents.

Example:

````text
src/config.ts
@ 8f31c72
Lines 42–71

[Copy]
[View source]
[Open commit]
````

Support:

- Exact commits
- Branches
- Tags
- Line ranges
- Source links
- Syntax highlighting
- Line numbers
- Copy
- Expand

---

# 51. Immutable Git References

Support both:

### Floating reference

````text
main:src/config.ts
````

### Immutable reference

````text
8f31c72:src/config.ts
````

Prefer immutable references in:

- ADRs
- Postmortems
- Historical documentation
- Security documentation
- Change records
- Compliance documentation

A document must not silently change because a branch moved unless that behaviour was deliberately configured.

---

# 52. Generic Source References

Example domain representation:

````ts
interface SourceReference {
  integrationId: string
  repositoryId: string
  path: string
  revision: string
  startLine?: number
  endLine?: number
}
````

Provider-specific APIs map into this model.

---

# 53. Rich Embeds

Support intelligent URL recognition.

Pipeline:

````text
URL
 ↓
Provider detection
 ↓
Metadata resolution
 ↓
Preview
 ↓
Optional embedded view
````

Support:

- Open Graph
- oEmbed
- Provider APIs

Potential providers:

- Articles
- YouTube
- Figma
- GitHub
- GitLab
- Bitbucket
- Jira
- Linear
- Loom
- Google Docs

Authors should be able to override automatic detection where appropriate.

---

# 54. Embed Security

Third-party content is untrusted.

Use:

- Sanitisation
- CSP
- Sandboxed iframes where appropriate
- Provider allowlists
- Workspace policies
- Explicit embed permissions

A broken external service should never make the document unusable.

---

# 55. Source Artifacts

Support generic relationships between content and its source.

Examples:

````text
Diagram
 → rendered SVG
 → source.drawio

Mermaid
 → rendered SVG
 → diagram.mmd

SQL
 → rendered result
 → query.sql
````

This concept should be reusable across future generated content.

---

# 56. Templates

Templates are first-class.

### Engineering

- Technical Design
- System Design
- ADR
- RFC
- Runbook
- Incident Report
- Postmortem
- API Documentation
- Service Documentation
- Deployment Guide
- Troubleshooting Guide
- Security Review
- Threat Model

### Business

- SOP
- Policy
- Process
- Strategy
- Business Case

### Product

- PRD
- Feature Specification
- Experiment Report
- Release Notes

### Support

- FAQ
- Troubleshooting
- Escalation Guide

### Other industries

Consider templates for:

- Healthcare
- Legal
- Education
- Finance
- Manufacturing
- IT
- Operations
- Compliance

---

# 57. Template Architecture

Templates can define:

- Front matter schema
- Recommended structure
- Placeholder content
- Suggested headings
- Checklists
- Metadata fields
- Required sections
- Interactive capabilities

Example workflow:

````text
Create
 ↓
Runbook
 ↓
Schema selected
 ↓
Metadata form
 ↓
Markdown scaffold
 ↓
Interactive capabilities available
````

The resulting document remains Markdown.

---

# 58. Documentation Quality

Provide gentle, actionable quality signals.

Potential checks:

````text
Stale
No owner
Broken links
Orphaned
Missing alt text
Incomplete metadata
Poor heading hierarchy
Duplicate content
````

Encourage good habits through:

- Ownership
- Review intervals
- Templates
- Related documents
- Suggestions
- Lightweight health indicators

Avoid turning documentation maintenance into bureaucracy.

---

# 59. Search

Initial search should be excellent lexical search.

Support:

- Global search
- Workspace search
- Full text
- Fuzzy matching
- Typo tolerance
- Highlighting
- Snippets
- Filters

Ranking should understand:

````text
Title
 ↓
Heading
 ↓
Body
````

Search must be permission-aware.

---

# 60. Cross-References

Support:

- Internal document links
- Backlinks
- Heading anchors
- Related documents
- Mentions
- References

Links should survive document rename and move operations.

Use stable internal IDs.

---

# 61. Versioning

Maintain revision history.

Users should be able to:

- View revisions
- Compare
- Preview
- Restore
- See author
- See timestamps

For Markdown:

- Provide readable diffs.
- Avoid noise from formatting-only changes.
- Preserve meaningful source history.

Transient interactive progress should not create document revisions.

---

# 62. Workspaces

Support multiple independent workspaces.

Each workspace can control:

- Members
- Roles
- Permissions
- Branding
- Templates
- Integrations
- Document hierarchy
- Settings

Users may belong to multiple workspaces.

---

# 63. Permissions

Workspace roles:

````text
Owner
Admin
Editor
Contributor
Viewer
````

Support:

- User permissions
- Group permissions
- Document overrides
- Inheritance
- Private documents

Permission logic belongs in domain/application layers, not scattered across UI components.

---

# 64. Authentication

Standard:

- Email/password
- Magic links
- Password reset
- Email verification

Enterprise:

- OIDC
- SAML
- MFA
- SCIM

Authentication should remain independent of domain/business logic.

---

# 65. Export

Support:

- Markdown
- HTML
- PDF
- DOCX
- JSON
- ZIP including assets and source files

Exports must remain useful.

PDF should look professionally designed.

Markdown should remain portable.

ZIP should preserve relevant source artifacts.

---

# 66. Reading Experience

Rendered documents should have:

- Excellent typography
- Comfortable line length
- Clear hierarchy
- Table of contents
- Breadcrumbs
- Heading anchors
- Code blocks
- Tables
- Callouts
- Responsive media

Optional modes:

- Standard
- Focus
- Full width
- Print

---

# 67. Authoring Experience

Support:

- Slash commands
- Keyboard shortcuts
- Drag/drop
- Paste Markdown
- Paste URLs
- Rich editing
- Source editing where useful
- Autosave
- Draft recovery
- Unsaved-change protection
- Command palette

Advanced controls should be discoverable without cluttering the primary editing experience.

---

# 68. Quality-of-Life Features

Consider:

- Recent documents
- Starred documents
- Favorites
- Recently edited
- Recently viewed
- Quick create
- Copy link
- Copy heading link
- Duplicate
- Move
- Archive
- Search shortcuts
- Focus writing mode
- Reading progress
- Estimated reading time
- Sticky TOC

Features should be prioritised based on real user value.

---

# 69. Performance

Performance is a core product requirement.

Optimise:

- Initial load
- Navigation
- Editor response
- Large documents
- Large workspaces
- Large document trees
- Search
- Media

Use where appropriate:

- Code splitting
- Route-level lazy loading
- Query caching
- Lazy media
- Virtualisation
- Efficient rendering
- Background processing

Do not cargo-cult memoisation.

Measure before optimising.

---

# 70. Storage Architecture

Investigate and decide between:

````text
Database-backed Markdown
````

and/or:

````text
Content-addressed storage
````

Potential model:

````text
Document
 ↓
Revision
 ↓
Content blob
````

Attachments and source artifacts should have independent storage semantics.

Avoid storing large binaries directly in ordinary document rows.

Deliverable:

````text
ADR-014 — Storage Architecture
````

---

# 71. API Architecture

Provide a clean application API around:

- Documents
- Workspaces
- Users
- Permissions
- Search
- Revisions
- Templates
- Attachments
- Source references
- Integrations
- Exports

API operations must go through application/domain logic.

---

# 72. Events and Webhooks

Eventually support:

````text
DocumentCreated
DocumentUpdated
DocumentPublished
DocumentArchived
RevisionCreated
UserAdded
PermissionChanged
````

Potential uses:

- Webhooks
- Integrations
- Auditing
- Background processing

Do not introduce event sourcing unless actual requirements justify it.

---

# 73. Enterprise and Provider Architecture

Provider-neutral design should also be applied to:

````text
Source control
Identity
Storage
Search
Embeds
Notifications
````

Prefer capability-specific interfaces.

Avoid giant universal abstractions.

---

# 74. Open Source

Repository should contain:

````text
README.md
CONTRIBUTING.md
CODE_OF_CONDUCT.md
SECURITY.md
LICENSE
ARCHITECTURE.md
AGENTS.md
````

Provide:

- One-command local setup
- Seed data
- Database migrations
- Developer documentation
- Architecture documentation
- Examples
- Contribution guidelines

---

# 75. CI and Quality Gates

CI should run the same core quality commands used locally.

At minimum:

````text
format check
lint
typecheck
unit tests
integration tests
coverage
E2E
build
````

Pull requests should not merge with failing gates.

Keep CI fast through:

- Caching
- Parallelisation
- Clear test boundaries
- Efficient build steps

---

# 76. Definition of Done

A feature is complete only when it has:

- Correct architecture
- TDD-backed tests
- Required meaningful coverage
- Type safety
- Accessibility
- Responsive behaviour
- Browser compatibility
- Loading state
- Empty state
- Error state
- Performance considered
- Consistent visual treatment
- Documentation where necessary

---

# 77. P0 — Core Release

Build a smaller, exceptionally polished core.

## Workspace

- Multiple workspaces
- Members
- Roles
- Basic branding

## Authentication

- Email/password
- Magic links
- OIDC foundation

## Documents

- Hierarchy
- Nested pages
- Navigation
- Metadata
- Tags
- Owners
- Status
- Draft/published

## Editor

- Markdown
- Rich formatting
- Tables
- Code
- Images
- Attachments
- Links
- Callouts

## Markdown

- YAML front matter
- Schema validation
- Import
- Export
- Round-trip preservation

## Search

- Full text
- Titles
- Headings
- Basic filtering

## Versioning

- Revisions
- Diffs
- Restore

## Permissions

- Workspace permissions
- Document permissions
- Inheritance

## UX

- Light mode
- Dark mode
- Responsive
- Accessible
- Fast
- Keyboard-friendly

---

# 78. P1 — Differentiation

Add:

## Templates

Runbooks, ADRs, technical designs, postmortems, SOPs, PRDs, etc.

## Interactive documentation

Decision trees, troubleshooting, checklists, guided procedures.

## Git

GitHub, Bitbucket, GitLab, exact revision links, snippets, line ranges.

## Source artifacts

Mermaid, Draw.io, SQL, generated tables/charts.

## Rich embeds

Open Graph, video, Figma, Git providers and extensible provider support.

## Documentation quality

Review reminders, staleness, links, orphans, backlinks, related content.

---

# 79. P2 — Enterprise and Scale

Add:

- SAML
- SCIM
- MFA
- Groups
- Audit logs
- Enterprise Git
- Advanced permissions
- API
- Webhooks
- Advanced search
- Collaboration
- Larger-scale indexing and caching

---

# 80. Explicit Non-Goals

Do not build:

- Generic project management
- Slack-like messaging
- Spreadsheet functionality
- Full database builder
- Whiteboard
- Generic workflow platform
- Large low-code automation platform
- AI-first architecture

AI can later assist with:

- Summaries
- Search
- Related documents
- Writing
- Documentation quality
- Staleness detection

But AI must sit on top of a strong document model.

---

# 81. Engineering Principles

## DRY

Avoid duplicated domain behaviour.

Do not abstract prematurely.

## SOLID

Apply SOLID when it produces useful boundaries.

Do not introduce interfaces merely for theoretical purity.

## Idiomatic

Prefer clear, unsurprising code.

## Explicit

Prefer understandable control flow.

## Composable

Build systems from coherent, reusable parts.

## Testable

If something is difficult to test, question the architecture.

## Framework-independent

Keep domain and application logic independent of React.

## Provider-neutral

Keep vendor-specific concerns at integration boundaries.

## Portable

Keep Markdown useful outside Quill.

## Accessible

Treat accessibility as part of normal implementation.

## Performant

Treat performance as architectural.

## Simple

Prefer the simplest architecture that genuinely supports the requirements.

---

# 82. React Architectural Rules

1. Derive data instead of synchronising redundant state.
2. Handle user-driven actions in event handlers.
3. Use TanStack Query for server state.
4. Use TanStack Router for URL state.
5. Use TanStack Store for appropriate shared client state.
6. Use custom hooks for genuinely React-dependent logic.
7. Keep business/domain logic outside React.
8. Use `useEffect` primarily for external-system synchronisation.
9. Avoid effect chains.
10. Never use state as a covert command/event channel.

---

# 83. Markdown Architectural Rules

1. Standard Markdown first.
2. YAML front matter for metadata.
3. JSON Schema for metadata validation.
4. Preserve unknown metadata.
5. Prefer established Markdown extensions.
6. Use human-readable directives when necessary.
7. Every extension requires graceful degradation.
8. Maintain Git-friendly output.
9. Avoid proprietary opaque document formats as the durable source.
10. Preserve source artifacts and provenance.

---

# 84. Provider Architectural Rules

1. Core concepts are provider-neutral.
2. Providers are adapters.
3. Integrations represent configured provider instances.
4. Use capability-specific interfaces.
5. Do not leak external API types into the domain.
6. Adding a provider should have a small blast radius.
7. Do not build giant universal abstractions.
8. Do not generalise hypothetical requirements.

---

# 85. Component Architectural Rules

1. Components render and handle interaction.
2. Components should be lean.
3. Components should be composable.
4. Components should be accessible.
5. Components should be testable.
6. Do not put substantial business logic in components.
7. Do not make every function a hook.
8. Do not fragment components purely to reduce line count.
9. Prefer meaningful component boundaries.

---

# 86. Code Review Heuristics

Ask:

> What is this code responsible for?

> Does this belong in React?

> Can this logic be tested without rendering?

> Is this state actually state?

> Why does this Effect exist?

> Is this `useEffect` synchronising an external system?

> Could an event handler express this more clearly?

> Is this provider-specific logic leaking into the domain?

> Can this Markdown extension degrade cleanly?

> What happens to this feature during export?

> Does this abstraction genuinely reduce complexity?

> Does adding this feature make the codebase easier or harder to understand?

---

# 87. Repository Bootstrap / First Engineering PR

Before substantial product code, establish the project constitution.

The first engineering milestone should set up:

- Package management
- Workspace structure
- TypeScript strictness
- React + Vite
- Tailwind
- TanStack Router
- TanStack Query
- TanStack Store
- oxlint
- oxfmt
- Test runner
- Coverage enforcement
- E2E harness
- CI
- Local development environment
- Seed data
- Architectural dependency rules
- Basic documentation structure

This is deliberately early.

The aim is to prevent the codebase from learning its engineering standards after it has already grown around contradictory patterns.

---

# 88. Milestone Sequence

````text
INVESTIGATE
    ↓
Competitive analysis
    ↓
Markdown / AST
    ↓
Quill editor
    ↓
Front matter schema
    ↓
Interactive document representation
    ↓
Source artifact model
    ↓
Provider architecture
    ↓
Embed architecture
    ↓
Search architecture
    ↓
Frontend architecture
    ↓
Repository bootstrap
    ↓
────────────────────────
P0
────────────────────────
Workspace
Auth
Documents
Navigation
Editor
Markdown
Rendering
Search
Permissions
Revisions
    ↓
────────────────────────
P1
────────────────────────
Templates
Interactive docs
Git
Source artifacts
Embeds
Documentation quality
    ↓
────────────────────────
P2
────────────────────────
Enterprise
API
Webhooks
Scale
Advanced integrations
````

---

# 89. Seven Foundational Bets

Everything ultimately rests on these decisions.

## 1. Markdown remains first-class

Not just import/export.

## 2. AST is the internal representation

Editor, renderer, search, validation and exporters should share one structured model.

## 3. Interactivity is an enhancement

Documents remain documents.

## 4. Provenance is generic

Git, SQL, diagrams, embeds and generated content can share broader provenance concepts.

## 5. Providers are adapters

GitHub and Bitbucket should not infect the core domain.

## 6. React is not the architecture

It is a rendering and integration layer over application/domain logic.

## 7. Documentation quality is a product capability

Quill should actively encourage useful, maintainable documentation.

---

# 90. MVP Success Criteria

The first real release should make a small set of workflows feel exceptional.

## Write

````text
Create document
 ↓
Choose template or blank page
 ↓
Start writing
 ↓
Markdown remains underneath
````

## Organise

````text
Workspace
 ↓
Collections
 ↓
Nested documents
 ↓
Clear navigation
````

## Find

````text
Search
 ↓
Relevant result
 ↓
Relevant context
 ↓
Document
````

## Maintain

````text
Owner
Review date
Version history
Broken-link detection
````

## Trust

````text
Source reference
 ↓
Exact revision
 ↓
Verifiable source
````

## Operate

````text
Runbook
 ↓
Interactive troubleshooting
 ↓
Relevant next step
````

---

# 91. Final Product Test

The final system should pass these questions:

> Would someone choose to write documentation here instead of a Markdown file and Git?

> Would someone rather read a 30-page document here than in Confluence?

> Can an engineer trust a code snippet because it points to an exact revision?

> Can a support engineer follow a troubleshooting flow without reading a giant decision tree?

> Can a contributor export their knowledge without losing it?

> Can an organisation adopt GitHub today and Bitbucket tomorrow without redesigning the application?

> Can a new developer navigate the repository without needing an architecture lecture?

> Can business logic be tested without rendering React?

> Can we understand why every `useEffect` exists?

> Does adding a feature make the platform more coherent rather than merely larger?

If the answers are consistently yes, the architecture is doing its job.

---

# 92. Final Philosophy

Quill should feel like:

**Markdown underneath.**

**Beautiful on top.**

**Structured where useful.**

**Interactive when valuable.**

**Connected when appropriate.**

**Portable by design.**

**Provider-neutral at the core.**

**React at the rendering boundary.**

**Domain logic independent of frameworks.**

**Effects for synchronisation, not orchestration.**

**TDD for meaningful behaviour.**

**Full meaningful coverage.**

**Fast tooling.**

**Clean project structure from day one.**

**Easy local development by design.**

**Simple until complexity earns its place.**

**Good documentation should encourage good habits rather than enforce bureaucracy.**

---

# 93. Review Questions

Before implementation begins, review the following explicitly:

### Product

- Is the core target audience sufficiently defined?
- Are P0/P1/P2 priorities correct?
- Which differentiators are genuinely compelling?
- Are any features unnecessary for the initial release?

### Document architecture

- Is Markdown + AST definitely the correct foundation?
- What level of Markdown round-trip fidelity is required?
- Which extensions belong in the core format?
- What should interactive syntax look like?

### Editor

- Is Quill the correct long-term editor foundation?
- How cleanly can it integrate with the desired AST?
- Can custom blocks be represented without coupling the domain to editor internals?

### Interactive docs

- What is the minimum viable interactive model?
- Should the initial implementation be a state machine, graph, or another representation?
- How much persistence is required?

### Integrations

- What is the minimum common denominator for Git providers?
- What belongs in the provider layer versus the application layer?
- How should integration credentials and scopes work?

### Front matter

- What belongs in core metadata?
- How should workspace schemas be managed?
- How should schema evolution work?
- How do unknown fields survive round-trip processing?

### Storage/versioning

- Database-backed Markdown or content-addressed storage?
- How should revisions reference content?
- How are large source artifacts stored and versioned?

### Search

- PostgreSQL FTS initially?
- Separate search service?
- How much ranking sophistication is necessary for P0?

### React architecture

- Where is TanStack Store genuinely needed?
- Which logic can remain framework-independent?
- Which effects are legitimate external synchronisation?
- Are dependency boundaries enforceable mechanically?

### Engineering

- What does "100% coverage" mean for each package?
- What exclusions are permitted?
- What quality checks run pre-commit versus CI?
- How fast must local feedback be?
- How do we enforce architectural boundaries?

---

# 94. Proposed Initial ADR Set

The following decisions should exist as actual ADRs rather than remaining tribal knowledge:

````text
ADR-001  Product philosophy
ADR-002  Markdown as canonical document format
ADR-003  Quill editor architecture
ADR-004  Internal document AST
ADR-005  Front matter schema
ADR-006  Interactive document representation
ADR-007  Source artifact model
ADR-008  Provider / integration architecture
ADR-009  Rich embed architecture
ADR-010  Search architecture
ADR-011  Authentication architecture
ADR-012  Permission model
ADR-013  Frontend state architecture
ADR-014  Storage architecture
ADR-015  Versioning architecture
ADR-016  Export architecture
ADR-017  Testing and coverage policy
ADR-018  Local development architecture
ADR-019  Design system and component architecture
ADR-020  Browser support policy
````

The ADRs should record:

- Context
- Decision
- Alternatives considered
- Consequences
- Status

This keeps future contributors from having to rediscover historical reasoning.

---

# 95. Conclusion

Quill should not compete primarily on feature count.

It should compete on **quality of the entire documentation experience**.

A successful Quill implementation should make:

- Writing documentation pleasant.
- Reading documentation effortless.
- Finding information fast.
- Maintaining documentation natural.
- Interactive procedures useful.
- Source provenance trustworthy.
- Markdown portable.
- Integrations extensible.
- Permissions understandable.
- Development enjoyable.
- Local setup simple.
- The codebase easy to reason about.

The intended outcome is an open-source platform where **excellent documentation naturally happens because the product, document model, and engineering architecture all encourage it.**
