---
title: Overdue notices
---

# Overdue notices

A page written the way a developer guide is: component blocks in the directives dialect (ADR-060), Quill's own details (ADR-048) and badges, and blocks this instance may not have installed yet.

:::cast{outside="The mail relay"}

- :rookwood: **Rookwood** · API, gateway and worker
- :mail: **The mail relay** · Delivers Rookwood's notices
- :person: **A person** · Receives the notice

:::

## Notices out

:ok[Built] :plan[Designed] :accent[:clock: 5 s]

::::timeline

:::step{icon=rookwood}

**Before sending** · :route[:rookwood: API]

### The API skips a reader who opted out

After a reader opts out, Rookwood stops sending to that address.

:ok[Holds] The address receives notices again only after the reader opts back in.

:::

:::step{icon=shield tone=net}

:loop: **Every 5 min** · :route[:rookwood: Worker → :mail: Relay]

### The worker checks back on a timer

A second job polls the relay for opt-outs it missed.

:::

::::

## Checks

:::checks

1. The address is confirmed.
2. The template renders in the reader's language.

:::

:::details[:server: `api`: the public API]{open}

The details keep their summary's emoji and code.

:::

## The endpoint

:::endpoint{method=POST path=/webhooks/relay auth=token}

Saves the report, then replies `200`.

:::

:::endpoint{method=FETCH path=/webhooks/relay}

A method the block does not know is drawn as `GET`, and said.

:::
