---
title: Unknown extensions
quillSchemaVersion: 99
futureFeature:
  enabled: true
  rolloutPercent: 5
---

# Unknown extensions must survive

Source: written for this spike. This is the AGENTS.md rule 7 test.

Quill does not know this directive, and must not eat it:

:::timeline{orientation=vertical density=compact}
### 2026-01

Project started.

### 2026-06

First release.
:::

Nor this one, which has an attribute value with spaces and punctuation:

:::experiment{name="A/B test: sidebar width" bucket=42 enabled}
Half of users see a 320px sidebar.
:::

Nor this leaf directive:

::future-embed{provider=unknown src="https://example.com/thing?a=1&b=2"}

Nor this text directive: the value is :unknown-inline[whatever]{k=v} here.

A future container with an id shorthand and a class shorthand:

:::panel{#main-panel .highlighted}
Shorthand attribute syntax.
:::
