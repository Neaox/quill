# Connectors for work trackers and code hosts (Jira, GitHub and others)

- **Status:** proposed
- **Recorded:** 2026-10-11
- **Trigger:** live blocks land (ADR-032, M5), or a team asks to see ticket and pull-request status in their documents. Public-source unfurling could come first: it needs no settings UI.

## Idea

Connect an organisation's Jira, GitHub, GitLab, Linear or similar once, and documents can refer to their work items by reference. A ticket key or a pull request link shows its title, status and assignee, and stays current.

Three shapes, all built on one connector:

- **Smart links.** A pasted URL for an issue, PR, commit or ticket becomes an inline chip with its title and status. The Markdown stays the URL.
- **References.** `:jira[PROJ-123]` or `:gh[org/repo#42]` are short forms that read sensibly anywhere. Outside Quill they are just the key.
- **Live blocks.** `::issues{connector=jira jql="project = PAY AND status != Done"}` or `::pulls{repo=org/payments state=open}` list matching work items. They are snapshotted and refreshed on a cadence, with an "as of" time.

## Who it serves

Teams whose documentation describes work tracked elsewhere: architecture decisions linked to their epics, runbooks linked to incidents, release notes linked to merged PRs. Today they paste links that say nothing and go stale. With connectors the document shows the current state and still reads as plain Markdown in Git.

## What it touches

- **Plan §19, ADR-008 (providers and integrations).** A connector is an integration of a capability-specific provider, such as `WorkItemProvider` (Jira, Linear, GitHub Issues) and `RepositoryProvider` / `RevisionProvider` (GitHub, GitLab, Bitbucket). Credentials are encrypted and scoped to the unit that created the integration, never sent to the browser.
- **ADR-032 (live blocks).** Live blocks are the delivery mechanism: a server-side fetcher with the integration's credentials, never the reader's; snapshots; cadences; static fallbacks; islands in the app.
- **ADR-039 (Markdown extensions).** Each shape is a packaged extension with a `live` binding. Smart links are an extension that claims a URL pattern rather than new syntax. The source island or a declared inline view covers the editor.
- **Permissions.** A snapshot is visible to everyone who can read the document. So a connector exposes only what its integration's account can see, and a workspace must be granted the integration explicitly. A per-reader view ("my open PRs") is viewer-scoped, rendered client-side only and never snapshotted (ADR-032).
- **Security.** The SSRF-safe outbound client, webhook signature verification for `push` cadences, rate limits per integration, and an audit of configuration changes.

## Public sources need no connector

A public GitHub or GitLab repository, a public issue, or a public Jira Cloud project can be resolved without any setup.
- Pasting its URL unfurls straight away, through an instance-wide **anonymous connector** that uses only unauthenticated public APIs.
- It runs on the server, through the SSRF-safe client, with conservative rate limits and shared snapshots.
- An administrator can turn it off, or limit it to allowlisted hosts.

A configured connector is needed only for private repositories and private Jira projects. When one is present it takes precedence for its host, so a repository that is private to one organisation is never fetched anonymously.

A link the instance cannot resolve stays a plain link. It is never an error and never a broken chip.

## How link details are fetched, resolved and cached

Decided in [ADR-042 (link previews)](../architecture/decisions/0042-link-previews.md); this is the summary.
- **Where:** on the server only, never in the browser.
- **Resolution:** layered, in this order:
  1. a connector's API (the only way to private content);
  2. oEmbed (the registry, then discovery);
  3. Open Graph, then Twitter Card tags;
  4. the page's own title, description, favicon and JSON-LD.
- **Fetching:** through an open-web mode of the SSRF-safe outbound client:
  - addresses are checked and the connection pinned on every hop;
  - limits on redirects, time and size;
  - reading stops at `</head>`;
  - an honest bot user agent, and rate limits per host.
- **Images:** never hotlinked. They are fetched, sniffed, re-encoded and stored as our own assets.
- **Caching:** snapshots in ADR-032's store, keyed by the normalised URL. Successes are refreshed in the background, failures have a short negative cache, and there is a manual refresh. Public results are shared; connector results are scoped to the integration.
- **Rendering never fetches.** Page assembly fills preview slots as it fills live blocks.

The connectors in this idea plug in as the first layer of that resolver.

## Shape and detail are the author's choice

As in Confluence's smart links, the author decides how each reference appears, in the writing surface:
- **Display.** One of:
  - **URL**: the plain link;
  - **inline**: a chip with an icon, key, title and status;
  - **card**: title, description, status, assignee and updated time;
  - **embed**: a richer preview where the provider has one, sandboxed.
- **Fields.** Which fields a chip or card shows, such as status, assignee, priority, labels or the PR's checks and reviewers. A sensible default comes from the provider. For lists, which columns are shown, how they are sorted, and how many.
- **The control.** A small floating toolbar on the chip or block (switch display, choose fields, refresh, open), with keyboard access and undo, like every other editor control.

**Persistence.** The choice is written in the Markdown as attributes, so it round trips and degrades:
- `:gh[org/repo#42]{display=card fields="status,assignee,checks"}` is a reference;
- `::issues{connector=jira jql="…" columns="key,summary,status,assignee" limit=10 sort=updated}` is a list;
- a plain URL with no attributes takes the instance default, and choosing a different display wraps it in the directive form.

Outside Quill each form reads as its key or URL.

**Organisation defaults.** An administrator can set each provider's default display and fields, as a declarative extension setting (ADR-039).

## How it could work

1. **Settings.** An administrator adds a connector (OAuth app or token), tests it, and grants it to workspaces.
2. **Unfurling.** A registry of URL patterns per provider turns a pasted link into a reference, with a chip in the editor and the reader. For each host it is resolved by that host's configured connector if there is one, otherwise by the anonymous public connector, otherwise left as a link. The public site shows the static snapshot of public sources, and of private ones only if a connector is marked public.
3. **References and lists.** Reference directives and list live blocks are added as extensions, with snapshots refreshed by the job runner, or by webhooks where the provider offers them.
4. **Write-back is out of scope.** Creating a ticket from a document needs plan §21's rules: explicit authorisation, confirmation and audit.

## Open questions

- **Grant scope:** per workspace or per collection. The current proposal is per workspace, like other integrations.
- **Public site:** do snapshots of private trackers ever appear there? The default should be no, with an explicit per-connector "public" flag.
- **Rate limits:** how to stay within provider limits at scale. Shared snapshots keyed by parameters (ADR-032) cover most of it; measure.
- **Lockstay first:** which provider? GitHub (PRs and issues) is the likely first, since the plan already has GitHub source references in M5.
