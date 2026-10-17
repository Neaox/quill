# ADR-044: Deep links

**Status:** Accepted
**Date:** 2026-10-11
**Related:** ADR-011 (security baseline, amended by this ADR), ADR-031 (render caching), ADR-035 (human-readable URLs), ADR-039 (Markdown extensions), ADR-041 (code groups), ADR-042 (link previews), ADR-043 (Figma and draw.io), [connectors idea](../../ideas/work-tracker-and-code-host-connectors.md)

## Context

Documentation points deep into other **web applications** all the time:
- a Figma frame;
- a file at a line range in GitHub;
- a Jira issue;
- a Grafana or Datadog dashboard at a time range;
- a heading in a Google Doc;
- a Slack thread.

The owner asked that Quill support deep linking into external applications where appropriate. That means two things:
1. Links into web apps should land on exactly the right place, survive being pasted, edited and previewed, and stay correct.
2. Organisations using Quill, enterprises especially, should be able to allow the custom protocols their own tools register (internal tools, IDE launchers, softphones).

Today the sanitiser admits `href` schemes `http`, `https` and `mailto` only (`sanitize-schema.ts`, ADR-011). Any other scheme is stripped, so a `tel:` or an internal `acme-tool://` link silently becomes text, and the author is not told.

Custom schemes are also a real risk:
- `javascript:`, `data:`, `vbscript:` and `file:` must never be links;
- an unknown scheme can launch arbitrary local software.

## Decision

### Deep links into web applications are first class

A deep link is an ordinary `https` URL that encodes a location inside a web app. Quill's job is to keep that location intact and make it useful:

**Preserved exactly.**
- The `href` is never rewritten. Query strings, fragments and the parameters that carry the location are kept: `node-id`, `#L10-L42`, `from=…&to=…`, `?heading=…`.
- Only the preview cache key strips tracking parameters (ADR-042), never the link.

**Understood by provider.** The provider registry (ADR-042) parses known web apps' deep-link shapes into structured targets. For example:
- **GitHub:** blob at ref, path and line range.
- **Figma:** file plus node.
- **Jira:** issue.
- **Grafana:** dashboard, panel and time range.

A chip or card can then say precisely what the link points at ("payments/src/config.ts, lines 42–71 at a1b2c3d", "Frame: Checkout / Mobile"), not just the site name.

**Made durable where the app allows it.** Pasting a link that floats offers to pin it where a stable form exists. For example, a GitHub link to a branch offers "Link to this commit instead", as GitHub's `y` shortcut does. The choice is the author's; nothing is pinned silently.

**Offered as the right web view.** A chip can offer the same location in a sibling web app: "Open in github.dev" for a GitHub file, or the Figma prototype view for a frame. These are actions beside the link, never replacements.

### Prefer web links that open the app

Most modern apps register **universal or app links** on their ordinary `https` addresses, and the operating system opens the app when it is installed. This holds for figma.com, slack.com, zoom.us, teams.microsoft.com, github.com, linear.app and others. These are already plain `https` links, and they fall back to the web when the app is missing. That makes them the default and recommended form, and Quill's own insert flows (link previews, connector chips) always write the `https` form.

### "Open in app" is an action, not the link

Where an app has a reliable scheme, the chip or card for its link (ADR-042) gets a secondary **"Open in <App>"** action beside the primary web link. The primary link always works, with or without the app. Examples:
- **Figma:** open in the desktop app.
- **GitHub file, line or PR:** open in github.dev, or in VS Code via `vscode.dev/github/…`. Opening a local clone is excluded, because Quill cannot know where it is.
- **Slack:** a `slack://channel?team=…&id=…` link derived from an `app.slack.com` URL.
- **Teams and Zoom:** a join link.
- **Jira:** the Jira Cloud mobile app, through its universal links.

**Where the mapping lives.** A provider registry maps a URL pattern to its app link. It is the same registry as ADR-042's providers, so it is data, reviewed, and extended by packaged extensions (ADR-039).

**When the action is shown.** It appears only where the platform can use it. Desktop schemes are not offered on mobile, and vice versa, decided by the user agent's platform hints. It never replaces the web link.

### Custom protocols: an enterprise allowlist

Organisations that run on Quill, enterprises in particular, often have their own protocol handlers on their people's machines: internal tools, IDE launchers, softphones, ticketing clients. Each organisation can therefore allow additional schemes for its own documents, in **Settings → Organisation → Links**. The list is per organisation, so one tenant's choice never affects another's. Nothing beyond the defaults is enabled unless an administrator chooses it, and every change is audited.

The setting lists the **app schemes** its documents may link to.
- **Built-in catalogue.** Each entry has a scheme, a display name and an icon:
  - `tel` and `sms`, on by default;
  - `vscode`, `vscode-insiders`, `jetbrains`, `figma`, `slack`, `msteams`, `zoommtg`, `zoomus`, `obsidian` and `linear`, off until enabled.
- **Custom schemes.** An administrator may add any scheme their machines handle, such as `acme-ticket` or `corp-softphone`, with a display name and an optional icon. It must match `^[a-z][a-z0-9+.-]{1,31}$` and must not be on the deny list below. The settings screen says plainly that the scheme will launch whatever is registered for it on each reader's machine.
- **Never allowed**, enforced in code and not as a setting:
  - `javascript`, `data`, `vbscript` and `file`;
  - `blob`, `filesystem` and `about`;
  - `chrome` and `chrome-extension`;
  - `ms-msdt`, `search-ms` and the other OS protocol handlers with known exploits, from a maintained deny list.

**In the renderer.**
- The allowed schemes reach the renderer as part of its input, exactly as labels do (ADR-037). Their sorted list joins the render cache key.
- A link whose scheme is allowed renders as a link with an "opens <App>" indicator, an icon plus text that is part of its accessible name, so the reader knows it leaves the browser. No information is carried by colour alone.
- It has no `target`. App links do not open tabs.

**Only organisation administrators can change the list.** Authors, readers and workspace administrators cannot add a scheme: not in settings, not by writing one into a document, and not for themselves. An unapproved scheme launches software on other people's machines, which makes it an organisation-level security decision. A per-user allowlist was considered and rejected for that reason. A scheme added or removed is audited with who and when, and takes effect on the next render (the list is part of the render cache key).

**Disallowed schemes** are no longer dropped silently:
- The reader sees the link's text and its address as plain text, so a reader can still copy it.
- The editor marks the link with a warning: "Links to `foo:` aren't enabled for this organisation. Ask an administrator." An administrator sees a link to the setting instead.

**Public site.** The public site applies the same allowlist, minus anything the organisation marks "signed-in only".

### Deep links into Quill

Quill should be just as linkable from outside:
- **Headings.** Already permalinked (`#user-content-…`).
- **Blocks.** "Copy link to this block" on any block (paragraph, table, code block, diagram, callout) gives a stable `#b-<id>` anchor. Block ids are written to the Markdown only when such a link is first copied, as a `{#id}` attribute, which degrades as text. They are kept by the editor.
- **Text fragments.** `#:~:text=` links from browsers work, and the reader scrolls to and highlights the passage.
- **State in the address.** The selected code-group tab (`?tab=python`, ADR-041), an open diagram or table viewer (`#b-<id>&view`), and a sort order are all addressable. Opening a link restores them. Address changes from user actions use `replaceState`, so the history isn't flooded.
- **App URLs survive renames and moves** (ADR-035). Universal links into a future native app come later; the address shapes above are what it would claim.

### Section links that survive edits

A heading's anchor is derived from its text each time a page renders, GitHub-style (`createSlugger`, `packages/markdown/src/render/slug.ts`). Deleting a heading and re-adding it with the same text therefore restores the same anchor, and links work again. Case and punctuation don't matter. Three things still broke links silently, and these rules fix them.

**1. Quill knows which sections are linked to.**
- The link index already records links between documents (ADR-031's canonical links). It also records the **fragment** each internal link points at: a heading anchor or a block id.
- A document's incoming section links can then be counted per heading.
- The editor shows a small "Linked from 3 pages" marker on such a heading, with the list on hover or focus.

**2. A linked anchor is kept alive as an alias.**
- **What changes it.** Renaming, deleting and retyping, or moving a heading changes its derived anchor.
- **When the editor warns.** Only if the heading has incoming links: "3 pages link to 'Key rotation'". The default is **"Keep old links working"**.
- **What keeping does.** The old anchor is written onto the heading as an **alias**, an optional `{#key-rotation}` attribute. It renders as an extra anchor target (an empty element with that id before the heading), so `#key-rotation` and the new anchor both land on it.
  - Aliases are written only when there are incoming links, so most documents never carry one.
  - Outside Quill an alias reads as a short trailing attribute, so the document still degrades sensibly.
  - A heading may carry several aliases, accumulated over renames.
  - An alias whose links have all gone is dropped the next time the heading is edited.
- **Deleted headings.** If the heading is deleted outright, the warning offers to move its aliases to another heading ("Point links at…") or to let them go. The same picker as ADR-046's replacements is used.
- **Repeated headings.** Two headings with the same text are numbered by position (`#setup`, `#setup-1`). If either is linked, it gets a stable alias the moment the numbering would change, for example when one is moved or deleted. So a reorder can never send a link to the wrong section.
- **Collisions.** Aliases share the heading-id namespace and are deduplicated with the slugger. An alias never takes an anchor another heading currently derives; that heading keeps it, and the editor says so.

**3. Readers recover from anchors that no longer exist.** If a fragment matches nothing on the page, the reader's enhancer:
1. tries an alias, for links written before an alias existed, using the link index's record of what the fragment used to name;
2. otherwise finds the closest heading by text (the slug's words against each heading's words). If it is close enough, it scrolls there with a quiet note: "The section 'Key rotation' may have moved. Showing 'Key rotation schedule'".
3. Otherwise it stays at the top and says "The section 'Key rotation' isn't on this page any more", with the page's contents open.

Never a silent jump to the top.

**Links out of Quill keep working the same way.** The aliases are real ids in the HTML, so a link from Slack or a ticket benefits as much as a link from another page.

## Alternatives considered

- **Allow any scheme except a deny list.** Every new OS protocol-handler exploit becomes ours. An allowlist with a hard deny list is what GitHub and Slack effectively do.
- **Rewrite `https` links to app schemes automatically.** If the app isn't installed, the link is dead. A secondary action keeps the web link working.
- **Interstitial "Open external application?" pages.** Browsers already ask before launching an app for a custom scheme, so a second prompt is noise.

## Consequences

- Authors can link to phone numbers, meetings, design files and editors, and readers get the native app where they have it.
- A new renderer input and cache-key component, plus a sanitiser change that is security-relevant. The sanitiser keeps its own non-negotiable deny list whatever the settings say. ADR-011 is amended, and the security checklist gains a line.
- Block anchors add an optional, degradable attribute to the Markdown, written only on demand.

## Delivery

1. The scheme allowlist (setting, renderer input, sanitiser, editor warning), with `tel` and `sms` on by default.
2. Deep-link parsing in the provider registry, "Open in app" actions on link chips and cards, and pinning floating links, with ADR-042.
3. Block links, text fragments, and state in the address.
4. Section links that survive edits: fragments in the link index, the "Linked from" marker, aliases written on rename or delete, stable aliases for repeated headings, and the reader's recovery for dead anchors.
