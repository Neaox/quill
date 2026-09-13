# Escaping hazards

Source: written for this spike. Each line here is a construct that a naive
serialiser turns into something it was not.

Two literal colons in prose: ::not-a-directive, because a directive name may not
be followed by a space.

A single literal colon at the start of a line:
:not-a-text-directive either.

An unquoted directive attribute whose value contains a colon and a slash is not
a directive at all; remark-directive stops at the colon:

::embed{src=https://example.com/a?b=1}

A line that looks like a setext underline:

Not a heading
and not underlined

A literal pipe outside a table: a | b | c.

A literal asterisk and underscore: 2 * 3 * 4 and snake_case_name.

A line beginning with a number and a dot that is not a list: 2026\. A good year.

A line beginning with a hash that is not a heading: \#hashtag.

Angle brackets that are not HTML: 3 < 4 and 5 > 4.

An ampersand that is not an entity: Tom & Jerry.

A URL in prose that GFM linkifies: see https://example.com/docs for details.

Text that looks like front matter but is not, because it is not at the start:

---

Trailing whitespace at the end of this line does not make a hard break.

Nested container directives written with equal fences do not nest; the outer
fence must be longer. remark parses the last line below as a paragraph:

:::wide
:::callout{type=warning}
Malformed nesting.
:::
:::
