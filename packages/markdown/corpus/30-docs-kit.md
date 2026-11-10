---
title: A hold, start to finish
order: 5
---

# A hold, start to finish

Every construct a developer guide built on Quill's documentation kit writes (ADR-060): a cast, timelines of steps with when-lines, checks, routes in prose and tables, badges with emoji in them, and details.

:::cast{outside="Northgate, Eastfield"}

- :person: **Tomas Reed** · Runs the hill branch
- :home: **Rookwood** · API, gateway, worker and engine
- :globe: **Northgate** · Tells Rookwood about each hold
- :building: **Eastfield** · Waits to be asked

:::

:::cast{narrow}

- :inbox: **Gateway** · Receives
- :database: **Ledger** · Records
- :loop: **Engine** · Compares

:::

## At a glance

| Who                                                     | What                     | State              |
| ------------------------------------------------------- | ------------------------ | ------------------ |
| :route[:person: Librarian, :key: API key → :home: API]  | Reads and writes         | :ok[Built]         |
| :route[:globe: Northgate → :inbox: Gateway]             | Sends each hold          | :plan[Designed]    |
| :route[:building: Eastfield ⇄ :home: Rookwood]          | Rates, both ways         | :warn[Partial]     |
| :route[:building: Eastfield, :globe: Northgate]         | Asked every so often     | :accent[:clock: 25 s] |

The gateway sends nothing back until it has saved what arrived :route[:globe: Northgate → :inbox: Gateway ← :home: Worker].

## The librarian changes a loan period

:::::timeline

::::step{icon=person}

:clock: **Start** · :person: Librarian's browser → :home: API

### The librarian extends Saturday's loans

The API runs five checks, in order:

:::checks

1. The request is well formed
2. The librarian belongs to the branch
3. Within the rate limit
4. The librarian's role may change loan periods
5. The API version exists

:::

:ok[Holds] The branch comes from the sign-in, never from the request.

::::

::::step{icon=loop}

:clock: **Within 2 s** · :home: Engine → :globe: Northgate, :building: Eastfield

### The new period goes to both networks

Only copies that differ are sent.

::::

:::::

## A reader places a hold

::::timeline

:::step{icon=globe tone=outside}

:clock: **Any time later** · :globe: Northgate → :inbox: Gateway

### Northgate asks whether the book is on the shelf

:ok[Holds] An answer comes even when the database is down.

:::

:::step{icon=shield tone=net}

:loop: **Every 5 s** · :home: Worker → :database: Ledger · :home: Engine → :building: Eastfield

### A net catches what was missed

:bad[Refused] A hold with no reader is kept aside, never applied.

:::

:::step{icon=inbox}

:home: Engine → :home: Ledger

### No chip, routes alone

The first line holds only a route.

:::

:::step

**Check 1**

### A neutral chip

:::

::::

:::details[:send: Request and reply examples]

The details keep their summary's emoji and code: `200`.

:::
