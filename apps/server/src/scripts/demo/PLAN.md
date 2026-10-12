# The demo's documents

Every document, by workspace. `Rev` is the number of published revisions (`N.md` files). `Status` is
`published`, `draft-ahead` (published, plus a `draft.md` of unpublished changes) or `draft` (never
published: only `draft.md`). `Size` is S (120 to 250 words), M (350 to 700) or L (900 to 1,600).
Titles are exact, and unique across the whole demo: they are what `doc:` links name.

The directory for a document is `content/<workspace>/<slug>/`, where the slug is the title in
lower-case kebab-case without punctuation (`Postmortem: 14 August webhook delays` is
`postmortem-14-august-webhook-delays`).

## product (Product): private to the product team

Collections: Strategy, Roadmap, Research, Specs, Templates

| Collection | Title | Type | Size | Rev | Status | Show |
| --- | --- | --- | --- | --- | --- | --- |
| Strategy | Product vision 2027 | design | L | 3 | published | cards, callouts, presenter notes |
| Strategy | Pricing principles | design | M | 2 | published | table, callout |
| Strategy | Competitive landscape | research | M | 2 | published | wide table, badges |
| Roadmap | 2027 roadmap overview | reference | M | 3 | published | wide table of status badges, labels |
| Roadmap | Q1 2027 themes and bets | design | M | 2 | draft-ahead | cards, table |
| Research | Onboarding friction: interview synthesis | research | L | 2 | published | quotes, accordion, table |
| Research | Interview notes: Harbourview Health | meeting | S | 1 | published | |
| Research | Interview notes: Northwind Retail | meeting | S | 1 | published | |
| Specs | Spec: Feedback clustering v2 | spec | L | 4 | published | task list, mermaid, table, code |
| Specs | Spec: Skiff voice notes | spec | M | 3 | draft-ahead | mermaid sequence, table |
| Specs | Spec: Slack integration | spec | M | 0 | draft | open questions, task list |
| Templates | Product requirements document | template | M | 1 | published | template with 4 questions |
| Templates | Customer interview notes | template | S | 1 | published | template with 2 questions |

## mobile-eng (Mobile engineering): editable by the engineering team

Collections: Architecture, Runbooks, RFCs, Releases, Templates

| Collection | Title | Type | Size | Rev | Status | Show |
| --- | --- | --- | --- | --- | --- | --- |
| Architecture | Skiff app architecture | design | L | 3 | published | mermaid, code group, table, callouts |
| Architecture | Offline sync design | design | L | 4 | published | mermaid sequence, details, code |
| Architecture | Voice capture pipeline | design | M | 2 | published | mermaid, table |
| Runbooks | Crash spike after a release | runbook | M | 2 | published | numbered steps, callouts |
| Runbooks | Mobile on-call guide | runbook | M | 1 | published | table, accordion |
| RFCs | RFC-012: Adopt the React Native new architecture | adr | M | 2 | published | accordion of alternatives |
| RFCs | RFC-015: Replace polling with push sync | adr | M | 2 | draft-ahead | table, open questions |
| RFCs | Decision: SQLite for the local store | adr | S | 1 | published | |
| Releases | Release process | guide | M | 2 | published | mermaid state diagram, steps |
| Releases | Release checklist | guide | S | 1 | published | task list |
| Releases | Setting up your mobile development environment | guide | S | 1 | published | code group |
| Templates | RFC | template | M | 1 | published | template with 3 questions |

## infra (Platform and infrastructure): editable by the platform team

Collections: Architecture, Runbooks, Standards, Incidents, Templates

| Collection | Title | Type | Size | Rev | Status | Show |
| --- | --- | --- | --- | --- | --- | --- |
| Architecture | Platform overview | design | L | 3 | published | wide mermaid, wide table |
| Architecture | Capacity planning | reference | M | 2 | published | numeric tables with footer |
| Runbooks | Multi-region failover | runbook | L | 3 | published | callouts, numbered steps, code |
| Runbooks | Secrets rotation | runbook | M | 1 | published | steps, warning |
| Standards | Database migrations policy | policy | M | 2 | published | diff blocks, expand and contract |
| Standards | Observability standards | policy | M | 1 | published | tables |
| Incidents | Incident response process | guide | M | 2 | published | mermaid flowchart |
| Incidents | Postmortem: 14 August webhook delays | postmortem | L | 2 | published | timeline table, details, task list |
| Incidents | Postmortem: 2 September login errors | postmortem | M | 1 | published | |
| Templates | Postmortem | template | M | 1 | published | template with 3 questions |

## developers (Developer docs): PUBLIC site

Collections: Guides, API reference, Changelog

| Collection | Title | Type | Size | Rev | Status | Show |
| --- | --- | --- | --- | --- | --- | --- |
| Guides | Getting started with the Tidepool API | guide | M | 3 | published | code group, steps |
| Guides | Authentication | guide | M | 2 | published | code group, callouts |
| Guides | Webhooks | guide | L | 3 | published | table of events, code, details |
| Guides | Idempotency | guide | S | 1 | published | code |
| Guides | Migrating from v1 to v2 | guide | M | 2 | published | diff blocks, details |
| API reference | Rate limits | reference | S | 2 | published | table |
| API reference | Pagination | reference | S | 1 | published | code group |
| API reference | Errors | reference | M | 1 | published | table, accordion |
| API reference | SDKs and libraries | reference | S | 1 | published | cards |
| Changelog | Release notes 2026.9 | article | M | 1 | published | badges |
| Changelog | Release notes 2026.10 | article | M | 2 | published | badges, details |

## help (Help centre): PUBLIC site

Collections: Getting started, Feedback and themes, Roadmaps, Skiff mobile app, Account and billing, Troubleshooting

| Collection | Title | Type | Size | Rev | Status | Show |
| --- | --- | --- | --- | --- | --- | --- |
| Getting started | Create your first workspace | guide | S | 1 | published | steps |
| Getting started | Invite your team | guide | S | 2 | published | tip |
| Feedback and themes | Import feedback from a CSV file | guide | M | 2 | published | table of columns, callouts |
| Feedback and themes | Connect Zendesk | guide | M | 1 | published | steps, warning |
| Feedback and themes | Group feedback into themes | guide | M | 2 | published | accordion |
| Roadmaps | Publish a public roadmap | guide | M | 2 | published | steps, callout |
| Roadmaps | Embed the feedback widget | guide | M | 1 | published | code |
| Skiff mobile app | Install Skiff and sign in | guide | S | 1 | published | |
| Skiff mobile app | Record a voice note | guide | S | 1 | published | steps, keys |
| Skiff mobile app | Working offline | guide | S | 2 | published | callout |
| Account and billing | Change your plan | guide | S | 1 | published | table |
| Account and billing | Frequently asked questions about billing | article | M | 2 | published | accordion |
| Troubleshooting | Why isn't my feedback appearing? | article | M | 3 | published | details, steps |

## design (Design system): PUBLIC site

Collections: Foundations, Components, Patterns

| Collection | Title | Type | Size | Rev | Status | Show |
| --- | --- | --- | --- | --- | --- | --- |
| Foundations | Design principles | design | M | 2 | published | ruled cards |
| Foundations | Colour | reference | M | 2 | published | tables of hex values, callouts |
| Foundations | Typography | reference | M | 1 | published | table |
| Foundations | Spacing and layout | reference | M | 1 | published | wide table |
| Components | Buttons | reference | M | 2 | published | code group, table |
| Components | Form fields | reference | L | 2 | published | accordion, code |
| Components | Data tables | reference | M | 1 | published | a table with a caption, footer and options |
| Patterns | Empty states | design | S | 1 | published | |
| Patterns | Accessibility checklist | guide | M | 3 | published | task list |

## support (Support playbooks): private to the support team

Collections: Playbooks, Macros, Escalations, Templates

| Collection | Title | Type | Size | Rev | Status | Show |
| --- | --- | --- | --- | --- | --- | --- |
| Playbooks | Handling an angry customer | playbook | M | 2 | published | callouts |
| Playbooks | Refund and credit policy | policy | M | 2 | published | table |
| Playbooks | Data export and deletion requests | playbook | M | 1 | published | warnings, steps |
| Macros | Support macros library | reference | L | 2 | published | accordion of macros |
| Escalations | Escalation matrix | reference | S | 3 | published | wide table, badges |
| Escalations | Severity definitions | policy | S | 1 | published | |
| Templates | Support playbook | template | S | 1 | published | template with 2 questions |

## handbook (Company handbook): internal, readable by every employee

Collections: Culture, Working here, Policies

| Collection | Title | Type | Size | Rev | Status | Show |
| --- | --- | --- | --- | --- | --- | --- |
| Culture | Our values | article | S | 2 | published | ruled cards |
| Culture | How we make decisions | article | M | 2 | published | callout |
| Working here | Remote and hybrid work | policy | M | 2 | published | |
| Working here | Meeting norms | guide | S | 1 | published | |
| Working here | On-call compensation | policy | S | 1 | published | table |
| Policies | Expenses and travel | policy | M | 3 | published | table, details |
| Policies | Code of conduct | policy | M | 1 | published | |

## people (People operations): confidential, administrators only

Collections: Hiring, Onboarding, Compensation

| Collection | Title | Type | Size | Rev | Status | Show |
| --- | --- | --- | --- | --- | --- | --- |
| Hiring | Interview rubric for engineers | guide | M | 2 | published | table |
| Hiring | Engineering hiring plan 2027 | reference | M | 2 | draft-ahead | table |
| Onboarding | 30-60-90 day plan | guide | M | 2 | published | task list |
| Compensation | Engineering levels and bands | policy | M | 3 | published | numeric table |
| Compensation | Performance review cycle | guide | M | 1 | published | |

## security (Security and compliance): confidential, administrators only

Collections: Policies, Audits, Reports

| Collection | Title | Type | Size | Rev | Status | Show |
| --- | --- | --- | --- | --- | --- | --- |
| Policies | Information security policy | policy | L | 2 | published | |
| Policies | Access control standard | policy | M | 2 | published | table |
| Policies | Vendor risk assessment | guide | M | 1 | published | task list |
| Audits | SOC 2 Type II readiness | reference | M | 3 | published | table of controls, task list |
| Audits | Penetration test summary 2026 | reference | M | 1 | published | table of findings with severity badges |
| Reports | Quarterly access review: Q3 2026 | reference | S | 1 | published | table |

## marketing (Marketing): editable by the marketing team

Collections: Brand, Launch plans, Content

| Collection | Title | Type | Size | Rev | Status | Show |
| --- | --- | --- | --- | --- | --- | --- |
| Brand | Brand voice and tone | guide | M | 2 | published | do and don't table |
| Brand | Press kit | reference | S | 1 | published | |
| Launch plans | Skiff 2.0 launch plan | design | L | 3 | published | gantt, table, task list, presenter notes |
| Launch plans | Tidepool launch checklist | guide | S | 1 | published | task list |
| Content | Blog: how we cut feedback triage time by 60% | article | M | 1 | draft | |
| Content | Case study: Harbourview Health | article | M | 2 | published | quote, numbers |
| Content | Editorial calendar Q4 | reference | S | 2 | published | table |
