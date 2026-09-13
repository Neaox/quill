# Raw HTML

Source: written for this spike, in the shape of a project README that centres its header with raw HTML.

<div align="center">
  <img src="./docs/logo.svg" width="120" alt="Quill" />
  <h1>Quill</h1>
  <p>An open source documentation platform.</p>
</div>

<br />

A paragraph with inline HTML: press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save, and note
that <abbr title="Abstract Syntax Tree">AST</abbr> is used throughout.

A collapsible section, which is HTML because Markdown has no syntax for it:

<details>
<summary>Supported browsers</summary>

- Chrome
- Firefox
- Safari

</details>

An HTML comment, which carries no visible content:

<!-- TODO: replace with a directive once :::details exists -->

A self-closing tag in a paragraph: line one<br />line two.

<table>
  <tr><th>Raw HTML table</th></tr>
  <tr><td>Not a GFM table</td></tr>
</table>
