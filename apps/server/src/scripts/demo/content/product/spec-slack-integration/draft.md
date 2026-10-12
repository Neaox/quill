# Spec: Slack integration

> [!NOTE]
> Draft. Not yet reviewed by Marcus or Aisha. Conditional on clustering v2 staying on schedule; see the decision in [Product vision 2027](doc:Product vision 2027).

## Why

Northwind Retail and Lantern Logistics asked for this in the same week in September. Both teams live in Slack: Northwind's product lead wants a message when a theme passes 25 items, and Lantern's operations manager wants to send a customer comment from a channel to Tidepool without opening another tab. About a third of Team and Business workspaces already use a Slack webhook through Zapier, so the demand is real but the workaround is clumsy.

## Proposed scope for the first release

Two directions, and nothing else.

**Out of Tidepool:** a workspace admin connects a Slack channel to a theme filter. When a theme matches and crosses a threshold, or changes status to *planned* or *shipped*, a message is posted with the theme name, item count and a link.

**Into Tidepool:** the `/tidepool` slash command and a "Send to Tidepool" message action create a feedback item from a Slack message, with the author, channel and permalink as metadata.

## Out of scope

- Reading a whole channel automatically. Privacy and volume both argue against it.
- Direct messages and group DMs.
- Slack Enterprise Grid org-wide installs.

## Open questions

- **Who may connect a channel?** Workspace admins only, or any editor? Aisha will want the answer to be admins, with an audit log entry.
- **What happens to a message when the Slack author later leaves the company?** We keep the item and the name, and show "Former member".
- **Do we need the threshold at all in the first release?** Simple "theme shipped" posts might cover most of the value for 40% less work.
- **How do we avoid noise?** Rate-limit to one message per theme per day, or let the admin choose a digest?
- **Message language.** Slack workspaces for Northwind Retail span six countries; do we localise the bot?

## Work

- [x] Interview Northwind Retail and Lantern Logistics
- [ ] Review Slack's app directory requirements and timeline (currently six to eight weeks)
- [ ] Draft the OAuth scopes and agree them with Aisha
- [ ] Design the channel connection screen with Sofia
- [ ] Decide the notification rules above
- [ ] Estimate: Marcus's current figure is 12 engineer-weeks, low confidence
- [ ] Decide on 13 March whether this ships in Q1
