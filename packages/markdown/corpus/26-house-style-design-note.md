---
title: Reconciling a channel's calendar
status: accepted
---

# Reconciling a channel's calendar

Source: written for research 2026-10-11 (P0-7) in the house style of the
design notes Quill's first users keep in Git: GitHub alerts, tables written
`|---|`, emphasis written with underscores, lists straight after the sentence
that introduces them, and soft-wrapped prose. Opened and saved unchanged, it
must come back exactly as it is, but for its soft wraps.

> [!NOTE]
> A night is _held_ by exactly one site at a time.

> [!TIP]
> Read the table first.

> [!IMPORTANT]
> The puller is the one part that must keep running. When it stops, a channel
> emails the booking to the property instead, and it never reaches us.

> [!WARNING]
> A booking the channel shows and we do not is an overbooking waiting to happen.

> [!CAUTION]
> Never reprice a booking.

## What is checked

The sweep compares three things:
- what each channel should hold, from the tenant's rules;
- what we last sent it, from the ledger (`sync_ledger`, `per_tenant` rows);
- what we last saw there, from the read-back.

| Check | Cost | Share of a pass |
|---|---|---|
| `canonicalise(slice)` | ~79,400 ns | ~93% |
| SHA-256 via `crypto.hash` | ~2,400 ns | ~2.8% |
| A B&B's calendar | :badge[Built]{tone=success} | ~1% |

:::wide

| Site | Reads back | Writes |
|:---|:---:|---:|
| Airbnb | daily | within 15 minutes |
| Booking.com | every 12 hours | in batches |

:::

## How a difference is settled

1. **Prefer the holder.** The site that holds a night is right about it.
2. **Then the ledger.** What we sent last is what we meant.
4. **Then ask.** A difference neither settles opens a ticket, #253 for the
   first one.

- **A booking that disagrees.** It is kept as reported, and the difference is
  drift evidence for the rates slice.

  | Field | Kept as |
  |---|---|
  | Price | reported |
  | Dates | reported |
- **A closed night that disagrees.** It is reopened only by its holder.

- **A rule that disagrees.** It is left out of the write.

The draw.io sources sit beside each diagram, and the rule list is in
`rules/*.json`.  
A hard break, written with two spaces, ends the line above.

## Sources

- [A1] <https://www.example.com/help/article/2350>
- [A2] <https://www.example.com/help/article/990>
