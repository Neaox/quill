---
title: Block layout widths
layout: content
---

# Block layout widths

Source: written for this spike, from the examples in ADR-027.

Normal prose sits at the reading measure.

:::wide
| Region | Endpoint | Latency budget | Owner |
| ------ | -------- | -------------- | ----- |
| eu-west-1 | `https://eu.example.com` | 120 ms | Platform |
| us-east-1 | `https://us.example.com` | 90 ms | Platform |
| ap-south-1 | `https://ap.example.com` | 200 ms | Platform |
:::

More prose at the reading measure.

:::full
![System landscape](landscape.svg)
:::

A wide wrapper around several blocks at once:

:::wide
### A heading inside the wrapper

A paragraph inside the wrapper.

```ts
const wide = true;
```
:::

A full-width code block:

:::full
```sql
select document_id, count(*) from comments group by document_id order by 2 desc;
```
:::

Back to content width for the closing paragraph.
