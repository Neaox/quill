import {
  CommentIcon,
  HistoryIcon,
  OutlineIcon,
  SearchIcon,
  type DocumentComment,
  type DocumentStatus,
  type IconRailItem,
  type Revision,
  type TreeSection,
} from '@quill/ui'

/**
 * One worked example, shared by the shell around the showcase and by the
 * specimens inside it, so the same document is being described everywhere and
 * a variant can be compared against its alternative rather than against a
 * different set of words.
 */

export const RAIL_ITEMS: readonly IconRailItem[] = [
  { id: 'documents', label: 'Documents', icon: <OutlineIcon />, link: { to: '#foundations' } },
  { id: 'search', label: 'Search', icon: <SearchIcon />, link: { to: '#controls' } },
  { id: 'history', label: 'History', icon: <HistoryIcon />, link: { to: '#signature' } },
  { id: 'comments', label: 'Comments', icon: <CommentIcon />, link: { to: '#reading' } },
]

export const TREE_SECTIONS: readonly TreeSection[] = [
  {
    id: 'design-system',
    label: 'design system',
    nodes: [
      {
        id: 'foundations',
        label: 'foundations',
        link: { to: '#foundations' },
        children: [
          { id: 'type', label: 'type', link: { to: '#foundations' } },
          { id: 'colour', label: 'colour', link: { to: '#colour' } },
          { id: 'contrast', label: 'contrast', link: { to: '#contrast' } },
        ],
      },
      { id: 'controls', label: 'controls', link: { to: '#controls' } },
      { id: 'messaging', label: 'messaging', link: { to: '#messaging' } },
      { id: 'signature', label: 'signature', link: { to: '#signature' } },
      { id: 'layout', label: 'layout', link: { to: '#layout' } },
      { id: 'reading', label: 'reading', link: { to: '#reading' } },
    ],
  },
  {
    id: 'decisions',
    label: 'decisions',
    nodes: [
      { id: 'adr-019', label: 'adr-019-design-system', link: { to: '#signature' } },
      { id: 'adr-027', label: 'adr-027-block-widths', link: { to: '#layout' } },
      { id: 'adr-028', label: 'adr-028-theming', link: { to: '#colour' } },
    ],
  },
]

export const STATUS: DocumentStatus = {
  path: [
    { label: 'acme', link: { to: '#foundations' } },
    { label: 'engineering', link: { to: '#foundations' } },
    { label: 'design', link: { to: '#foundations' } },
    { label: 'design-system' },
  ],
  version: 'v12',
  updated: '2026-08-15',
  owner: 'platform',
  state: 'published',
}

export const REVISIONS: readonly Revision[] = [
  { id: 'v12', label: 'v12', at: '2026-08-15', link: { to: '#signature' } },
  { id: 'v11', label: 'v11', at: '2026-07-02', link: { to: '#signature' } },
  { id: 'v10', label: 'v10', at: '2026-06-19', link: { to: '#signature' } },
  { id: 'v9', label: 'v9', at: '2026-05-30', link: { to: '#signature' } },
  { id: 'v8', label: 'v8', at: '2026-04-11', link: { to: '#signature' } },
]

export const COMMENTS: readonly DocumentComment[] = [
  {
    id: 'c1',
    author: 'Sam',
    anchor: 'L18',
    body: 'Is the cache lifetime the same for both token kinds?',
    at: '2026-08-14',
    href: '#reading',
  },
  {
    id: 'c2',
    author: 'Ada',
    anchor: 'L42',
    body: 'Worth naming the gateway explicitly here.',
    at: '2026-08-15',
    href: '#reading',
  },
  {
    id: 'c3',
    author: 'Ravi',
    anchor: 'L91',
    body: 'This table should be wide, not full.',
    at: '2026-08-15',
    href: '#layout',
  },
]

export const SAMPLE_CODE = `export async function verify(token: string): Promise<Claims> {
  const result = await gateway.introspect({ token })
  if (!result.active) throw new TokenRevoked(result.reason)
  return result.claims
}`
