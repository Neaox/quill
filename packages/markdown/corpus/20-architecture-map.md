Architecture

# Rookwood Catalogue Map

How copies, shelf status, holds and loan periods travel between the Rookwood library service, the Northgate and Eastfield lending networks, school reading lists and a branch's own catalogue. Which arrows exist depends on who is in charge of each value.

:small[Drawn from the code on 11 October 2026. Heavy lines leave Rookwood, light lines arrive, dashed lines confirm a write, and grey dotted lines are planned rather than running.]

## The cycle

Every arrival is written to the library database first. A planner then decides what each network ought to show, sets that beside what it last wrote and last read, and writes only what differs. Flags speed it up; the nightly pass keeps it honest.

::::wide
:::figure

```mermaid
flowchart TB
  accTitle: The cycle
  accDescr: Arrivals from the networks and the import jobs land in the library database; the planner works out each network's view and the courier writes it to Northgate and Eastfield, confirming afterwards.

  subgraph branch [The branch]
    direction LR
    staff["Librarians<br>desk and API"]
    planner["Loan planner<br>via our API"]
    ils["Branch catalogue<br>Z39.50"]:::planned
  end

  subgraph rookwood [Rookwood]
    db[("Library database<br>titles, copies, loan rules,<br>owners of each value, flags")]
    journal["Arrival journal<br>outside the database"]
    planner2["Planner<br>want, diff, order, nightly pass"]
    desk["Front desk<br>stateless"]
    courier["Courier<br>throttled, retried, logged"]
    imports["Import jobs<br>Eastfield feed, Northgate crawl,<br>reading lists"]
  end

  subgraph outside [Lending networks]
    direction LR
    northgate["Northgate<br>quota per branch"]
    eastfield["Eastfield<br>one quota for Rookwood"]
    lists["Reading lists<br>schools and clubs"]
  end

  staff --> db
  planner --> db
  ils -.- db
  northgate -->|callbacks| desk
  desk -->|journalled, then 200| journal
  journal -->|applied| db
  db <-->|flags, state| planner2
  planner2 ==>|shelf snapshot every 5 s| desk
  desk ==>|on the shelf? replies| northgate
  planner2 ==>|per queue| courier
  courier ==>|copies, loan periods| northgate
  courier ==>|a month at a time| eastfield
  northgate -.->|confirmed daily| courier
  eastfield -.->|confirmed twice a day| courier
  eastfield -->|polled every 20 s| imports
  lists -->|fetched| imports
  imports -->|stored, then acknowledged| db

  classDef planned stroke-dasharray: 4 4
  linkStyle 2 stroke-dasharray: 2 4
```

Northgate's callbacks reach the front desk, which also answers its "is a copy on the shelf?" question from a snapshot refreshed every five seconds; once that snapshot is half a minute stale, the desk says no (ADR 0026). The import jobs make their own calls through the courier, drawn separately here only to keep the picture tidy. Throw away every flag and queue and the nightly pass would still find all the work.

:::
::::

## One hold, followed through

A hold placed through Northgate, in order. No step waits on a push. Eastfield is updated before anything else, since the planner's record shows it still lending a copy that has just gone (ADR 0042). Had the flag been lost, the nightly pass would reach the same conclusion.

::::wide
:::figure

```mermaid
sequenceDiagram
  accTitle: One hold, followed through
  accDescr: Northgate reports a hold by callback; it is journalled, applied and flagged, and the planner pulls the copy from Eastfield first, confirms it, then refreshes the shelf snapshot for the front desk.
  autonumber
  participant northgate as Northgate
  participant desk as Front desk
  participant journal as Arrival journal
  participant db as Library database
  participant planner as Planner
  participant eastfield as Eastfield
  participant lists as Reading lists

  northgate->>desk: Is copy 12 of 15 on the shelf?
  desk-->>northgate: Yes, per a snapshot under 30 s old
  northgate->>desk: Hold placed: callback
  desk->>journal: Journalled, then 200
  journal->>db: Applied
  Note over journal,db: A clash goes to the waiting-list workflow
  db->>planner: Flag, in the same transaction
  Note over planner,eastfield: Eastfield still lends that copy,<br>so it is updated first, whatever the date
  planner->>eastfield: Pull the copy, a month at a time
  eastfield-->>planner: Confirmed: pulled
  planner->>desk: Fresh shelf snapshot, within 5 s
  lists->>planner: Next fetch of our feed lists the copy as out
```

Eastfield's holds arrive another way: Rookwood polls its feed every twenty seconds, stores what it finds and only afterwards acknowledges it (ADR 0040). Left unacknowledged for half an hour, Eastfield falls back to emailing the branch. From step 5 onward the path is shared by every source. Reading lists fetch on a timetable of their own and so trail every other network.

:::
::::

## Loan periods stay rules until asked for

Nothing stores a table of finished loan periods. The rules are stored and worked through when a network needs an answer. Each slice carries a fingerprint of its inputs, so an untouched rule, hold or setting means no work and no write.

::::wide
:::figure

```mermaid
flowchart LR
  accTitle: Loan periods stay rules until asked for
  accDescr: Librarians and the loan planner record loan rules; the period pipeline works them through and, where Rookwood is in charge, formats the result for Northgate and Eastfield.

  staff["Librarian<br>desk"] --> rules
  tool["Loan planner<br>via our API"] --> rules
  rules["Loan rules<br>standard period, terms, item type,<br>reader group, fines, renewals"] --> pipeline
  pipeline["Period pipeline<br>side-effect free, fixed order,<br>each answer traced"] --> held{"Rookwood<br>in charge?"}
  held ==>|yes| northgate["Northgate<br>a period per copy in days,<br>fines and renewals as options"]
  held ==>|yes| eastfield["Eastfield<br>a period per item type and reader group,<br>a month at a time"]
  held -.->|no| none["Written nowhere"]
```

Where a network or nobody is in charge of a loan period, Rookwood writes it nowhere for now: periods are not yet read back from the networks, and writing ours would leave two answers to one question (ADR 0075). Eastfield could derive periods on its side; the option is declared but switched off.

:::
::::

## The owner of a value decides the arrows

Every field names who is in charge of it: Rookwood, a network, both, or the branch's own catalogue. The choice sits on the most specific level that needs one and flows down from the library. The four patterns below cover shelf status, lending rules, loan periods and catalogue records equally. Holds are always read from every network, whatever the owner.

::::wide
:::cards

### Rookwood is in charge

```mermaid
flowchart LR
  rookwood ==> northgate[Northgate]
  rookwood ==> eastfield[Eastfield]
  northgate -.->|confirm| rookwood
```

Written to each network. An edit made inside a network is spotted on the next confirmation and reverted.

### A network is in charge

```mermaid
flowchart LR
  northgate[Northgate] -.->|read| rookwood
  rookwood -.->|forward| eastfield[Eastfield]
```

For now nothing is written and each network keeps its own. Planned: read from the owner and forwarded to the rest.

### Both are in charge

```mermaid
flowchart LR
  rookwood ==>|when ours changes| northgate[Northgate]
  rookwood ==>|when ours changes| eastfield[Eastfield]
```

Written only after our own value moves, so a librarian's edit inside a network survives until then. Reconciling edits made on both sides is planned (plan section 6).

### The branch catalogue is in charge

```mermaid
flowchart LR
  ils[Catalogue] -.-> rookwood
  rookwood ==> northgate[Northgate]
  rookwood ==> eastfield[Eastfield]
  rookwood -.->|holds returned| ils
```

Planned (ADR 0035): the branch catalogue reports shelf status and loan periods over Z39.50, Rookwood forwards them, and holds flow back.

:::
::::

## An owner for each kind of record

One setting per kind of record decides it: `OwnerRule` in `@rookwood/policy`. Single fields may override it, and it flows library → region → branch, remembering at which level each answer was chosen. With nothing chosen, Rookwood is in charge. An edit to a value owned elsewhere is rejected by the API with `409` and an explanation. At present the planner consults the owner only for loan periods and lending rules.

:::wide

| Kind of record | Possible owners | Planner respects the owner |
| --- | --- | --- |
| Catalogue records | Rookwood, a network, both; field by field ("Northgate owns the summary") | :badge[Not yet] No writes yet, so nothing is replaced. |
| Cover images | Rookwood, a network, both | :badge[Not yet] No writes yet. |
| Shelf status | Rookwood; the branch catalogue (planned) | :badge[Not read]{tone=warning} Treated as Rookwood's in every case. A copy listed elsewhere stays off the other shelves. |
| Loan periods | Rookwood, a network, both, nobody | :badge[Yes]{tone=success} Owned elsewhere: written nowhere (ADR 0075). |
| Fine options | Late fees and renewal caps, each separately | :badge[Yes]{tone=success} Only the options Rookwood owns are written. |
| Lending rules | Rookwood, a network, both, nobody | :badge[Yes]{tone=success} A rule owned elsewhere is skipped (ADR 0041). |
| Holds | No owner: a hold is a fact, wherever it was placed | :badge[Always in]{tone=success} Read from every network, including paused and switched-off ones (ADR 0040). |

:::

## Each network in turn

What travels each way at present, how often it is confirmed, and what remains to be built.

:::wide

| Network | Records and covers | Shelf status | Holds | Loan periods and lending rules |
| --- | --- | --- | --- | --- |
| Northgate | :badge[Designed] `out` Summaries, subjects and notes; a cover per request. Confirmed weekly. | :badge[Built]{tone=success} `out` Shelf changes, which Northgate applies inside a quarter of an hour. Confirmed daily, which is how a librarian's own edit comes to light. | :badge[Built]{tone=success} `in` Callbacks to the front desk, a crawl of each title, and a full comparison four times a day. | :badge[Built]{tone=success} `out` Periods in whole days; late fees and renewal caps as title options; lending rules per copy. Confirmed daily. |
| Eastfield | :badge[Designed] `out` Structured JSON records. Covers are uploaded in batches that publish later, so they are checked before replacement. | :badge[Built]{tone=success} `out` A branch and a month per request. Confirmed twice a day, 31 copies per read. | :badge[Built]{tone=success} :badge[No reconciliation]{tone=warning} `in` Feed polled every 20 seconds, acknowledged once stored. There is no list of holds to compare with. | :badge[Built]{tone=success} `out` A table by item type and reader group; lending rules per copy. Confirmed daily. |
| Reading lists | Not exchanged. | :badge[Built]{tone=success} `out` Our feed, fetched on their timetable. The last to catch up. | :badge[Built]{tone=success} `in` Their lists count as holds: copies reserved, no reader details. | Not exchanged. |
| Branch catalogue | :badge[Designed] `in` When it owns them. | :badge[Designed] `in` Z39.50, each change as it happens and a full resend now and then. | :badge[Designed] `out` Every hold from every network, queued until the catalogue confirms it. | :badge[Designed] `in` Z39.50, then forwarded to the networks. |

:::

## Why it stays correct

::::wide
:::cards{variant=ruled}

### Acknowledged means kept

A callback gets its 200 only after the arrival journal has it; a polled Eastfield hold is acknowledged only after the database has it.

### Work is recomputed, not just queued

Pending work is any slice whose wanted state disagrees with what was last written or read. A lost queue delays the work but never drops it.

### No write without a change

Inputs are fingerprinted, so a slice nobody touched costs one comparison and no request.

### One slice, one request

Slices are sized to each network's limits, so no write can land halfway.

:::
::::
