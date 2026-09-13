# Ideas

Things worth doing that are not on the roadmap. Each idea is its own document
in this folder, as short or as long as it needs to be. An idea lives here until
it is promoted into `quill-plan.md` (a milestone and, where it changes
architecture, an ADR) or rejected, in which case its document stays with a
`Status: rejected` line and one sentence saying why, so the reasoning is not
lost and the idea is not raised again from scratch.

## Index

| Idea | Status | Pick up when |
| --- | --- | --- |
| [External Git repositories as read-only document sources](external-git-sources.md) | proposed | A team asks to index docs that live next to code, or remote sync (plan §9.6) is scheduled |

## Adding an idea

Copy [`0000-template.md`](0000-template.md) to a kebab-case file name, fill in
what you know, leave what you do not know as open questions, and add a row to
the index. The **Trigger** section matters most: it says what has to be true
for the idea to be worth picking up, so the list can be scanned when planning a
milestone rather than re-read in full.
