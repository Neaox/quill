# Tables

Source: written for ADR-040, from the reading options a table wrapper takes.

A bare table is wide, scrolls sideways, sorts, and freezes what it needs.

| Region     | Owner    | Budget |
| ---------- | -------- | -----: |
| eu-west-1  | Platform |    120 |
| us-east-1  | Data     |     90 |
| ap-south-1 | Platform |    200 |

The wrapper sets the width, proportional columns, what is frozen, and how it responds on a phone.

:::table{width="70%" columns="2fr 3fr 1fr" freeze="header,first-column" responsive="stack" sort="off"}
| Service | What it does                       | Latency |
| :------ | ---------------------------------- | ------: |
| Gateway | Routes every request to its region |   12 ms |
| Ledger  | Records each booking once          |   40 ms |
:::

An attribute Quill does not know survives, and so does a value it cannot read.

:::table{width="huge" caption="Kept as written" future}
| A | B |
| - | - |
| 1 | 2 |
:::

A caption names the table; row headers head each row, and the last row is the footer.

:::table[Latency budgets by region]{headers=both footer=1 freeze=header,footer caption=bottom}
| Region    | Owner    | Budget |
| --------- | -------- | -----: |
| eu-west-1 | Platform |    120 |
| us-east-1 | Data     |     90 |
| Total     |          |    210 |
:::

A table headed by its rows alone: the header row GFM requires is read as the first row of data.

:::table[Specification]{headers=row}
| Runtime  | Node 24       |
| -------- | ------------- |
| Database | PostgreSQL 17 |
| Region   | eu-west-1     |
| Storage  | 2 TB          |
:::

Every attribute, one value at a time.

:::table[width=content]{width=content}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[width=wide]{width=wide}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[width=full]{width=full}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[width=35%]{width=35%}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[columns="1fr 2fr"]{columns="1fr 2fr"}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[columns="1 1.5"]{columns="1 1.5"}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[headers=column]{headers=column}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[headers=row]{headers=row}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[headers=both]{headers=both}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[footer=1]{footer=1}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[footer=2]{footer=2}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[freeze=header]{freeze=header}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[freeze=first-column]{freeze=first-column}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[freeze=footer]{freeze=footer}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[freeze=header,first-column,footer]{freeze=header,first-column,footer}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[freeze=none]{freeze=none}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[responsive=scroll]{responsive=scroll}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[responsive=stack]{responsive=stack}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[sort=on]{sort=on}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[sort=off]{sort=off}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[caption=top]{caption=top}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

:::table[caption=bottom]{caption=bottom}
| A | B |
| - | -: |
| x | 1 |
| y | 2 |
:::

A wrapper around anything but one table is shown as written.

:::table{width="full"}
A paragraph first.

| A |
| - |
| 1 |
:::
