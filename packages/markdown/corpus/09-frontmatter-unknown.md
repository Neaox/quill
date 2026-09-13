---
title: Front matter with fields the schema does not know
id: 01J8Z0W5XK9Y3B6QN2D4V7H1TC
tags:
  - markdown
  - fidelity
layout: wide
schemaVersion: 2
# a comment inside the front matter
customer:
  name: Acme
  tier: enterprise
  contacts:
    - email: ops@acme.example
      role: owner
reviewCadenceDays: 90
weirdlyNested:
  ? complex key
  : complex value
emptyValue:
quotedString: "keep   my    spacing"
---

# Front matter fidelity

Source: written for this spike.

The document above declares `title`, `id`, `tags`, and `layout`, which the core
schema (ADR-005) knows about. Everything else — `customer`, `reviewCadenceDays`,
`weirdlyNested`, the YAML comment, and the exact quoting of `quotedString` — is
unknown to Quill and must survive the round trip byte for byte.

- The comment must still be there.
- The key order must not change.
- The YAML complex-key syntax must not be rewritten.
