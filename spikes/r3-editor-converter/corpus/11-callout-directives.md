# Container directives

Source: written for this spike, from the directive examples in the plan and ADR-002.

:::callout{type=warning}
Rotating the signing key invalidates every existing share link.
:::

:::callout{type=info}
Drafts are stored as AST, not Markdown. See ADR-021.
:::

A callout with a label and several blocks:

:::callout[Before you begin]{type=note}
You need a running Postgres instance.

```bash
docker compose up -d postgres
```

The connection string goes in `.env`.
:::

A decision directive:

:::decision{id=D9 status=accepted}
The editor is ProseMirror through TipTap.
:::

Nested directives:

::::wide
:::callout{type=warning}
A wide callout.
:::
::::

A leaf directive:

::toc{depth=3}

A text directive inside a paragraph: the status is :badge[stable]{colour=green} today.

A directive with no attributes at all:

:::aside
Just an aside.
:::
