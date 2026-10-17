# Templates and edit permissions: what teams expect

**Question.** Two decisions hang on this:

- Who may make, share and change a template?
- By default, who may edit, rename, move or delete a document someone else created?

Templates make the second question sharper. A shared template is copied into every document made from it, so an edit to it reaches more people than an edit to a page.

**Method.** On 2026-10-17 we read the vendor documentation and the public issue trackers and forums for twelve products. Each finding below is backed by the source listed with it. Where a behaviour could not be confirmed from a source, it is marked *unconfirmed* rather than stated.

## What was examined

Products examined for templates:
- Confluence Cloud
- Notion
- Google Docs
- Outline
- Slab
- Linear
- ClickUp
- Coda
- SharePoint pages
- GitBook
- Microsoft Loop
- Jira's saved filters, as the reference for "personal first, then shared"

Products examined for default edit rights:
- Confluence
- Notion
- Google shared drives
- Outline
- Slab
- GitBook
- GitHub wikis
- Coda

## Findings: templates

| Product | Where templates live | Personal templates | Who shares to everyone | How template editing is marked | Do template edits reach existing documents | Variables, titles, defaults |
| --- | --- | --- | --- | --- | --- | --- |
| Confluence Cloud | Space templates in space settings; global templates in admin settings | No | Space admins (space); Confluence admins (global) | A separate template editor; placeholder text shows only while editing | No | `/variable` fields fill a form at creation. No title pattern; a paid add-on adds one |
| Notion | In each database, under the New button; template buttons on pages | No separate scope | Whoever can edit the database (*unconfirmed*) | A bar above the page names the database the template belongs to | No | Repeating templates; a default template per database or view (*unconfirmed*) |
| Google Docs | An organisation gallery by category | Your own files, used as starting points | Admin chooses Open, Moderated (approval) or Restricted | None; a template is a file | No | None |
| Outline | Workspace or collection, managed in settings | Not documented | Not documented | Not documented | Not documented | `{date}`, `{time}`, `{author}`; "Create template" from an existing document |
| Slab | A special kind of post, filtered as Mine, My topics, All topics | Yes: yours until assigned to a topic | Anyone who can assign the post to a topic | "Templatize" turns a post into a template, which then carries a banner | Not documented | Not documented |
| Linear | Workspace templates and team templates, inherited by sub-teams | Not documented | Not documented | Settings screens, not the editor | Not documented | A default template per team, set separately for members and non-members |
| ClickUp | Template centre | Yes, by "share with" | Anyone who can see a template can also edit it (an open complaint since 2020) | None; you save over the original | No | — |
| Coda | Pinned workspace templates and a public gallery | Yes | Admin pins | Doc locking and named doc admins | No | — |
| SharePoint | A Templates folder in the site's pages library, kept as drafts | No | Anyone who can edit pages on the site ("Save as template") | Template pages are never published; they stay drafts | No | Shown as "Saved on this site"; no sharing across sites |
| Jira saved filters | Saved filters | Private by default | The owner adds viewers and editors; needs a global permission | An edit-permissions screen | — | Only the owner or an admin can change who may edit |

What follows from the table:

1. **Templates start personal and are shared when ready.** Slab's "Mine", Jira's private filters and Google's own files all work this way. Admin-only templates are a known complaint: [CONFCLOUD-78582](https://jira.atlassian.com/browse/CONFCLOUD-78582) asks that anyone who can add pages can also make templates.
2. **"Anyone who can see it can change it" is the opposite complaint.** ClickUp's [request to restrict template editing](https://feedback.clickup.com/feature-requests/p/restrict-template-edit-access) is years old. Coda's forum has [gallery templates damaged by students](https://connect.superhuman.com/t/once-again-negligent-coda-default-settings-students-destroy-coda-maker-doc-templates-in-the-galerie/48161). Who may *use* a shared template and who may *change* it are separate questions.
3. **Making a template from a page is the favoured way to make one.** Slab's Templatize, Outline's "Create template", SharePoint's "Save as template".
4. **Template edits never reach existing documents.** Every product copies the template once. None offers "this template has changed, take the new sections"; that is open ground.
5. **Title patterns and sequence numbers are mostly missing.** Confluence's come from [a paid add-on](https://marketplace.atlassian.com/apps/1226632). An ADR, an RFC or a postmortem wants a number.
6. **Template editing is marked in the content area, not by a colour scheme.** Notion and Slab use a banner. SharePoint keeps a template a permanent draft. No product has a colour convention that a person would learn.

## Findings: editing other people's documents

| Product | Where the default is set | Can an editor edit others' documents | What the creator or owner gets | A role that edits but cannot delete |
| --- | --- | --- | --- | --- |
| Confluence | Space permissions; page restrictions can only narrow | Yes: pages are open to every space editor by default | Page owner (transferable since 2024); can restrict their own page | Partly: "Add" and "Delete" are separate space permissions |
| Notion | Teamspace default for new pages; children inherit | Yes, when the teamspace default is "Can edit" | "Full access" (edit and share) above "Can edit" | "Can edit content" on databases |
| Google shared drives | Drive role | Yes, including Contributor | Nothing; the role decides | Contributor edits but cannot delete or move; Content manager can |
| Outline | Collection: view, view and edit, admin | Yes, with view and edit | Not documented | — |
| Slab | Topic: members can edit all, posts, or none | Yes, when set to all or posts | Post owner has full rights | — |
| GitBook | Space roles | Yes when live editing is on; otherwise by change request | — | Editor proposes, Reviewer merges |
| GitHub wiki | Repository | All collaborators by default | — | — |
| Coda | Per document | Yes; locking is advisory | — | Doc admins |

What follows from the table:

1. **In a wiki, an editor edits everything in the space.** That is the point of a wiki: people fix each other's pages. "Only your own" is asked for in forums and answered with per-page restrictions ([Atlassian Community](https://community.atlassian.com/forums/Confluence-questions/Confluence-restrictions-not-working-as-expected/qaq-p/850718)), never offered as a default.
2. **An owner is the accountable person, not the only editor.** Confluence's [page owner](https://support.atlassian.com/confluence-cloud/docs/transfer-content-item-ownership-from-one-user-to-another/) and Slab's [post owner](https://help.slab.com/en/articles/6390693-post-permissions) can manage restrictions and are who to ask, but others still edit.
3. **Deleting, moving and sharing are guarded harder than editing.** Google's [Contributor](https://developers.google.com/workspace/drive/api/guides/ref-roles) edits but cannot delete or move, and Confluence separates Delete from Add. An edit is undone from history; a delete or a move hurts people who did not make it.
4. **Complaints run both ways, so the default should be open and the narrowing easy.** "Too open": Coda's sharing defaults, ClickUp's templates. "Too closed": Confluence's admin-only templates, Jira filters stuck private ([support article](https://support.atlassian.com/jira/kb/how-to-share-a-dashboard-or-filter-ie-make-it-public-change-its-viewers-and-editor-permissions/)).

## How Quill stands today

- **Documents.**
  - Anyone with `edit` in scope edits any document's draft, and an `editor` publishes it; a contributor asks for a review (ADR-052). That matches the wiki default.
  - Rename, move and delete need `manage`, so a writer cannot delete the empty draft they made a minute ago.
  - `documents.created_by` records who created a document (ADR-053), but it grants nothing and nobody is named as accountable.
  - Front matter `owners` is descriptive and grants nothing.
- **Templates.**
  - A template is a document in a collection with the slug `templates`.
  - It shows in the tree, in search and possibly on the public site.
  - Any editor can change a template everyone uses.

## Options

| Option | Strengths | Weaknesses | Rewrite risk if wrong |
| --- | --- | --- | --- |
| **Documents: editors edit everything; the owner also renames, moves, deletes and shares their own** | Matches every wiki studied; fixes the "can't delete my own draft" gap; owner is an accountable name | Owner must be stored and kept out of front matter | Low: owner rights are one step in the authorizer |
| Documents: editors edit only their own unless granted | Protects pages from casual edits | Fights the wiki's purpose; no product defaults to it | High: every shared document needs grants |
| Documents: unchanged (manage for rename, move, delete) | No work | A writer cannot tidy their own mistakes | — |
| **Templates: personal, then shared to a workspace or unit by choice; shared ones edited by owner, maintainers and workspace managers** | Matches Slab and Jira; meets both complaint sets | Two verbs to explain: publish a version, and share | Low |
| Templates: workspace admins only | Simple, safe | The Confluence complaint; templates stop being made | Medium |
| Templates: any editor, as documents | Simple | The ClickUp and Coda complaints; a typo reaches every new document | Medium |

## Recommendation

- **Keep the wiki default for documents.** Add an owner, recorded in the database and defaulting to the creator. While you can edit a document you own (or publish it, once it is published), you can also rename, move, delete (to trash) and share it. Owning never grants access by itself, so a person removed from a workspace keeps nothing.
- **Templates are personal until their owner shares them.** "Only me" first, then the workspace, then a unit.
- **Who may change a shared template:** its owner, the maintainers the owner names, and the workspace's managers. Everyone else can duplicate it.
- **Templates live in a library, not the reading tree.**
- **Template editing is marked by a band in the content area and four other cues,** never by colour alone.
- **Fill the open ground:** title patterns with sequence numbers, a default template per collection, and an offer to adopt sections a template has gained since.

What would change this:
- Evidence from Quill's first teams that casual edits to others' documents are a real problem, not a feared one. That is answered by restrictions and the review workflow (M6), not by a closed default.

## Consequences

- An ownership step joins the authorizer.
- `documents` gains `owner_id`, alongside the existing `created_by`.
- Templates become a kind of their own, with their own routes, a library, an audience and a policy for who may change them.

## Resulting ADR

- [ADR-054: Template library and authoring](../architecture/decisions/0054-template-library-and-authoring.md)
- [ADR-055: Authorship and ownership](../architecture/decisions/0055-authorship-and-ownership.md)

## Sources

- **Confluence:**
  - [edit a template](https://support.atlassian.com/confluence-cloud/docs/edit-a-template/)
  - [create a template](https://support.atlassian.com/confluence-cloud/docs/create-a-template/)
  - [global templates](https://support.atlassian.com/confluence-cloud/docs/create-a-global-template)
  - [page restrictions](https://confluence.atlassian.com/confcloud/page-restrictions-724764891.html)
  - [transfer ownership](https://support.atlassian.com/confluence-cloud/docs/transfer-content-item-ownership-from-one-user-to-another/)
- **Notion:**
  - [database templates](https://www.notion.com/help/database-templates)
  - [sharing and permissions](https://www.notion.com/help/sharing-and-permissions)
  - [teamspace access](https://www.notion.com/help/guides/grant-access-teamspaces)
- **Google:**
  - [Drive roles](https://developers.google.com/workspace/drive/api/guides/ref-roles)
  - [custom templates in Docs](https://www.computerworld.com/article/3711702/make-custom-business-templates-google-docs.html)
- **Outline:**
  - [templates](https://docs.getoutline.com/s/guide/doc/templates-GP6DXgRtxl)
  - [collections](https://docs.getoutline.com/s/guide/doc/collections-l9o3LD22sV)
- **Slab:**
  - [post templates](https://help.slab.com/en/articles/4281672-post-templates)
  - [topic permissions](https://help.slab.com/en/articles/2677456-topic-permissions)
  - [post permissions](https://help.slab.com/en/articles/6390693-post-permissions)
- **Linear:** [issue templates](https://linear.app/docs/issue-templates)
- **ClickUp:**
  - [template permissions request](https://feedback.clickup.com/feature-requests/p/permissions-in-templates-who-can-create-edit-delete-templates)
  - [restrict template edit access](https://feedback.clickup.com/feature-requests/p/restrict-template-edit-access)
- **Coda:**
  - [doc locking](https://intercom.help/coda/en/articles/3388799-doc-locking)
  - [sharing defaults thread](https://connect.superhuman.com/t/negligent-default-settings-for-doc-sharing-why-is-nobody-bothered-by-this/45928)
- **SharePoint:** [page templates](https://support.microsoft.com/office/page-templates-in-sharepoint-faa92408-0c84-4e3d-8460-3c28065e7873)
- **GitBook:** [roles](https://gitbook.com/docs/collaborate/member-management/roles)
- **GitHub:** [wiki access](https://docs.github.com/en/communities/documenting-your-project-with-wikis/changing-access-permissions-for-wikis)
- **Jira:** [sharing a filter](https://support.atlassian.com/jira/kb/how-to-share-a-dashboard-or-filter-ie-make-it-public-change-its-viewers-and-editor-permissions/)
