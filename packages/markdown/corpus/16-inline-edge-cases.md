# Inline edge cases

Source: written for this spike. Every line here is a known place where Markdown
formatting and mdast semantics disagree.

A hard break with a backslash:\
the next line.

A hard break with two trailing spaces:  
the next line.

A soft break, which is only a source wrap
and renders as a single space.

Autolink: <https://example.com/a/b?c=d#e>.

Autolink e-mail: <ops@example.com>.

A bare URL that GFM linkifies: https://example.com/bare.

Escapes: \*not emphasis\*, \_not emphasis\_, \`not code\`, a\\backslash, and 1\. not a list.

Character references: &copy; 2026, &amp; and &lt;tag&gt;.

Inline code with backticks inside: `` a ` b `` and ``` `` nested `` ```.

Inline code containing a pipe: `a | b`.

Emphasis nested in strong: **bold with *italic* inside**.

Strong nested in emphasis: *italic with **bold** inside*.

Strikethrough with code: ~~`removed()`~~.

A link whose text is code: [`parse()`](./api.md#parse).

A link with strong text: [**Important**](./important.md).

An image inside a link: [![badge](badge.svg)](https://ci.example.com).

Underscores inside_a_word do not create emphasis.

Footnote reference[^1] in a sentence.

[^1]: The footnote definition, with a [link](https://example.com) inside it.
