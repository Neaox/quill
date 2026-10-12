# Troubleshooting

:::details[Why does the build fail on Windows?]{type=question}
Long paths are turned off.

```powershell
git config --global core.longpaths true
```
:::

::::details{type=warning open}
This one is open.

:::details[Nested]{type=note}
Deeper still.
:::
::::

- A step:

    :::details[Hint]{type=tip}
    Indented with its list item.
    :::

```md
??? note "Inside a fence"
    left alone
```

??? note "Nothing in it"
