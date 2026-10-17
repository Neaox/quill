# Details and accordions

Source: written for ADR-048, with every syntax Quill reads live for a section a reader opens.

Quill's own container directive, closed, with inline Markdown in its summary:

:::details[Why is `pnpm check` **slow** the first time?]
It builds every package's type declarations once, then reuses them.

```sh
pnpm check
```
:::

Open by default, and folded as a callout:

:::details[Before you upgrade]{open type=warning}
Back up the database first.
:::

GitHub's raw HTML, exactly as a README writes it:

<details>
<summary>Supported browsers</summary>

| Browser | Since |
| ------- | ----- |
| Chrome  | 120   |
| Firefox | 121   |

</details>

<details open>
<summary>Already open</summary>

Nested, and closed on one line:

<details>
<summary>Deeper</summary>

Inside.

</details>
</details>

An Obsidian foldable callout, closed and then open:

> [!tip]- Keyboard shortcuts
> Press <kbd>?</kbd> anywhere to see them.

> [!FAQ]+ Can I nest them?
>
> Yes: a details holds any block, another details included.

An accordion, where opening one closes the others:

::::accordion{name=faq}
:::details[How do I invite someone?]
From the workspace's settings.
:::

:::details[How do I leave?]
From your profile.
:::
::::

A details with no summary of its own:

:::details
Its summary says what it is.
:::
