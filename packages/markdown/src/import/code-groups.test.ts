import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { isCodeGroup } from '../code-group/code-group.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import {
  importCodeGroups,
  importGitBookTabs,
  importMdxTabs,
  importMkDocsTabs,
} from './code-groups.ts'

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)), 'utf8')

/** A Docusaurus tab set of one fence, with the given attributes on `<Tabs>`. */
const tabs = (attributes: string): string =>
  `<Tabs ${attributes}>\n<TabItem label="A">\n\`\`\`sh\na\n\`\`\`\n</TabItem>\n</Tabs>`

describe('importing tabbed code from other platforms', () => {
  it.each([
    ['Material for MkDocs', importMkDocsTabs, 'mkdocs.md', 'mkdocs.expected.md'],
    ['GitBook', importGitBookTabs, 'gitbook.md', 'gitbook.expected.md'],
    ['Docusaurus', importMdxTabs, 'docusaurus.md', 'docusaurus.expected.md'],
    ['Starlight', importMdxTabs, 'starlight.md', 'starlight.expected.md'],
    ['Mintlify', importMdxTabs, 'mintlify.md', 'mintlify.expected.md'],
  ])('converts %s into a canonical code group', (_platform, convert, input, expected) => {
    expect(convert(fixture(input))).toBe(fixture(expected))
    expect(importCodeGroups(fixture(input))).toBe(fixture(expected))
  })

  it('writes groups Quill reads live', () => {
    const tree = parseMarkdown(importCodeGroups(fixture('docusaurus.md')))
    expect(tree.children.filter((node) => isCodeGroup(node))).toHaveLength(1)
  })

  it('leaves tabs it cannot make a group of exactly as written', () => {
    for (const source of [
      '{% tabs %}\n{% tab title="A" %}\nProse.\n{% endtab %}\n{% endtabs %}\n',
      '{% tabs %}\nStray.\n{% tab title="A" %}\n```sh\na\n```\n{% endtab %}\n{% endtabs %}\n',
      '{% tabs %}\n{% tab title="A" %}\n```sh\na\n```\n{% endtab %}\n',
      '<Tabs>\n<TabItem label="A">\nProse.\n</TabItem>\n</Tabs>\n',
      '<Tabs>\n</Tabs>\n',
      '<Tabs>\nStray\n<TabItem label="A">\n```sh\na\n```\n</TabItem>\n</Tabs>\n',
      '<CodeGroup>\n```sh a\nunclosed\n</CodeGroup>\n',
      '<CodeGroup>\nProse.\n</CodeGroup>\n',
      '=== "A"\n\n    ```sh\n    a\n    ```\n    More prose.\n',
      '=== "A"\n\n    ```sh\n    a\n    ```\n    ```sh\n    b\n    ```\n',
      '=== "A"\n',
    ]) {
      expect(importCodeGroups(source)).toBe(source)
    }
  })

  it('keeps an indented group indented, and names an unnamed fence as text', () => {
    expect(
      importMkDocsTabs('- Step:\n\n    === "A"\n\n        ```\n        a\n        ```\n'),
    ).toBe('- Step:\n\n    :::code-group\n    ```text [A]\n    a\n    ```\n    :::\n')
  })

  it('keeps a sync key only in a key’s shape', () => {
    expect(importMdxTabs(tabs('groupId={"os choice"}'))).toContain(':::code-group{sync=os-choice}')
    expect(importMdxTabs(tabs("syncKey='--'"))).toContain(':::code-group\n')
    expect(importMdxTabs(tabs('queryString'))).toContain(':::code-group\n')
  })

  it('keeps an empty block, and a tab without a label', () => {
    expect(importMdxTabs('<Tabs>\n<TabItem>\n```sh\n```\n</TabItem>\n</Tabs>')).toBe(
      ':::code-group\n```sh\n```\n:::',
    )
  })
})
