---
title: Reconciling a branch's catalogue
status: accepted
---

# Reconciling a branch's catalogue

Source: written for research 2026-10-11 (P0-7) in the house style of the
design notes Quill's first users keep in Git: GitHub alerts, tables written
`|---|`, emphasis written with underscores, lists straight after the sentence
that introduces them, and soft-wrapped prose. Opened and saved unchanged, it
must come back exactly as it is, but for its soft wraps.

> [!NOTE]
> A copy is _held_ by exactly one branch at a time.

> [!TIP]
> Read the table first.

> [!IMPORTANT]
> The fetcher has to stay up. Whenever it is down, a branch falls back to
> emailing the loan to its front desk, and we never hear about it.

> [!WARNING]
> A loan the branch shows and we do not is a lost book waiting to happen.

> [!CAUTION]
> Never renumber a loan.

## What is checked

The sweep compares three things:
- what each branch should hold, from the library's rules;
- what we last sent it, from the ledger (`loan_ledger`, `per_branch` rows);
- what we last saw there, from the read-back.

| Check | Cost | Share of a pass |
|---|---|---|
| `normalise(record)` | ~61,200 ns | ~88% |
| BLAKE2 via `hash.digest` | ~3,100 ns | ~4.5% |
| A B&B's catalogue | :badge[Built]{tone=success} | ~1% |

:::wide

| Branch | Reads back | Writes |
|:---|:---:|---:|
| Northgate | daily | within 15 minutes |
| Eastfield | every 12 hours | in batches |

:::

## How a difference is settled

1. **Prefer the holder.** The branch that holds a copy is right about it.
2. **Then the ledger.** What we sent last is what we meant.
4. **Then ask.** A difference neither settles opens a ticket, #253 for the
   first one.

- **A loan that disagrees.** It is kept as reported, and the difference is
  drift evidence for the fines slice.

  | Field | Kept as |
  |---|---|
  | Due date | reported |
  | Dates | reported |
- **A withdrawn copy that disagrees.** It is restored only by its holder.

- **A rule that disagrees.** It is skipped when we write.

The draw.io sources sit beside each diagram, and the rule list is in
`rules/*.json`.  
A hard break, written with two spaces, ends the line above.

## Sources

- [A1] <https://www.example.com/guide/lending/112>
- [A2] <https://www.example.com/guide/lending/87>
