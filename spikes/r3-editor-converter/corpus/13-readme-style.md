# quill

Source: written for this spike, in the shape of a typical build-tool README (esbuild, Vite).

> An open source documentation platform that keeps Markdown as the source of truth.

## Why

Documentation platforms tend to store content in a proprietary model and offer
Markdown as a lossy export. Quill stores Markdown and treats every other
representation as derived.

## Install

```bash
pnpm add @quill/markdown
```

## Usage

```ts
import { parse, serialise } from '@quill/markdown';

const tree = parse('# Hello');
console.log(serialise(tree));
```

## Features

- **Markdown first.** CommonMark plus GFM, with YAML front matter.
- **Lossless round trips.** Unknown front matter and directives survive.
- **Git sync.** Two-way, with a content store that speaks commits.
- **Comments** anchored to text, not to line numbers.

## Comparison

| | Quill | Confluence | Notion |
| --- | :-: | :-: | :-: |
| Markdown is canonical | yes | no | no |
| Git sync | yes | no | no |
| Self-hosted | yes | yes | no |

## Status

Quill is pre-release. The API will change.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). In short:

1. Open an issue before a large change.
2. Write the test first.
3. Run `pnpm check` before pushing.

## Licence

AGPL-3.0-or-later. See [LICENSE](./LICENSE).
