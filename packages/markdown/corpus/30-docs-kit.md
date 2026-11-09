---
title: A booking, start to finish
order: 5
---

# A booking, start to finish

Every construct a developer guide built on Quill's documentation kit writes (ADR-060): a cast, timelines of steps with when-lines, checks, routes in prose and tables, badges with emoji in them, and details.

:::cast{outside="Harbour Stays, Tidewater"}

- :person: **Mere Tane** · Owns a cottage by the sea
- :home: **Quill Lodge** · API, gateway, worker and engine
- :globe: **Harbour Stays** · Tells Quill Lodge about each booking
- :building: **Tidewater** · Waits to be asked

:::

:::cast{narrow}

- :inbox: **Gateway** · Receives
- :database: **Ledger** · Records
- :loop: **Engine** · Compares

:::

## At a glance

| Who                                                     | What                     | State              |
| ------------------------------------------------------- | ------------------------ | ------------------ |
| :route[:person: Owner, :key: API key → :home: API]      | Reads and writes         | :ok[Built]         |
| :route[:globe: Harbour Stays → :inbox: Gateway]         | Sends each booking       | :plan[Designed]    |
| :route[:building: Tidewater ⇄ :home: Quill Lodge]       | Rates, both ways         | :warn[Partial]     |
| :route[:building: Tidewater, :globe: Harbour Stays]     | Asked every so often     | :accent[:clock: 25 s] |

The gateway sends nothing back until it has saved what arrived :route[:globe: Harbour Stays → :inbox: Gateway ← :home: Worker].

## The owner changes a price

:::::timeline

::::step{icon=person}

:clock: **Start** · :person: Owner's browser → :home: API

### The owner raises Saturday's price

The API checks five things, in order:

:::checks

1. The request's format
2. The owner belongs to the account
3. Under the request limit
4. The owner's role may change prices
5. The API version exists

:::

:ok[Holds] The account comes from the sign-in, never from the request.

::::

::::step{icon=loop}

:clock: **Up to 2 s later** · :home: Engine → :globe: Harbour Stays, :building: Tidewater

### The new price goes to both sites

Only nights that differ are sent.

::::

:::::

## A guest books

::::timeline

:::step{icon=globe tone=outside}

:clock: **Any time later** · :globe: Harbour Stays → :inbox: Gateway

### Harbour Stays asks whether the nights are free

:ok[Holds] An answer comes even when the database is down.

:::

:::step{icon=shield tone=net}

:loop: **Every 5 s** · :home: Worker → :database: Ledger · :home: Engine → :building: Tidewater

### A net catches what was missed

:bad[Refused] A booking with no owner is kept aside, never applied.

:::

:::step{icon=inbox}

:home: Engine → :home: Channel

### No chip, routes alone

The first line holds only a route.

:::

:::step

**Check 1**

### A neutral chip

:::

::::

:::details[:send: See the requests and responses]

The details keep their summary's emoji and code: `200`.

:::
