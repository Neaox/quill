---
title: Email in and out
---

# Email in and out

A page written the way rookwood's request guide is: component blocks in the directives dialect (ADR-060), Quill's own details (ADR-048) and badges, and blocks this instance may not have installed yet.

:::cast{outside="Postmark or SES"}

- :rookwood: **rookwood** · API, gateway and worker
- :mail: **Postmark or SES** · Delivers rookwood's email
- :person: **A person** · Receives the email

:::

## Email out

:ok[Built] :plan[Designed] :accent[:clock: 5 s]

::::timeline

:::step{icon=rookwood}

**Before sending** · :route[:rookwood: API]

### The API skips an address that bounced

After a hard bounce, rookwood stops sending to that address.

:ok[Holds] The address receives email again only after the person confirms it.

:::

:::step{icon=shield tone=net}

:loop: **Every 5 min** · :route[:rookwood: Worker → :mail: Postmark]

### The worker asks again, without any report

Another job asks Postmark about new bounces.

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

:::endpoint{method=POST path=/webhooks/postmark auth=token}

Saves the report, then replies `200`.

:::

:::endpoint{method=FETCH path=/webhooks/postmark}

A method the block does not know is drawn as `GET`, and said.

:::
