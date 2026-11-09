import { defineBlock, h } from './define.ts'
import { p } from './props.ts'

/**
 * Blocks shaped like the ones lockstay's documentation writes
 * (`docs/design/quill-docs.md` in that repository), registered only by
 * tests: they prove the contract carries a timeline of steps, a list with
 * typed props and an inline block before the real ones are built on it.
 */

export const timelineBlock = defineBlock({
  id: 'test.timeline',
  version: '1.0.0',
  name: 'timeline',
  title: 'Timeline',
  description: 'Steps on a rail, in order.',
  content: { items: 'step' },
  props: {},
  render: ({ items }) => h('ol', {}, items),
})

export const stepBlock = defineBlock({
  id: 'test.step',
  version: '1.0.0',
  name: 'step',
  title: 'Step',
  description: 'One moment of a timeline.',
  content: 'blocks',
  within: ['timeline'],
  props: {
    icon: p.string({ title: 'Icon' }),
    tone: p.enum(['outside', 'net'], { title: 'Tone' }),
  },
  data: ['data-qb-tone', 'data-qb-icon'],
  render: ({ props, content }) =>
    h(
      'li',
      {},
      h('span', {
        className: ['qb-step-node'],
        'data-qb-icon': props.icon,
        'data-qb-tone': props.tone,
      }),
      content,
    ),
})

export const castBlock = defineBlock({
  id: 'test.cast',
  version: '1.0.0',
  name: 'cast',
  title: 'Cast',
  description: 'Who a page is about.',
  content: 'blocks',
  label: 'optional',
  props: {
    outside: p.list({ title: 'Outside', default: [] }),
    narrow: p.boolean({ title: 'Narrow' }),
    columns: p.integer({ title: 'Columns', minimum: 1, maximum: 4 }),
  },
  data: ['data-qb-outside', 'data-qb-columns'],
  render: ({ props, label, labelText, content }) =>
    h(
      'section',
      {
        'aria-label': labelText === '' ? 'Cast' : labelText,
        className: props.narrow ? ['qb-cast-narrow'] : [],
        'data-qb-outside': props.outside.join(','),
        'data-qb-columns': props.columns === undefined ? undefined : String(props.columns),
      },
      label.length > 0 && h('p', { className: ['qb-cast-title'] }, label),
      content,
    ),
})

export const routeBlock = defineBlock({
  id: 'test.route',
  version: '1.0.0',
  name: 'route',
  title: 'Route',
  description: 'Parties joined by arrows.',
  content: 'inline',
  props: { way: p.enum(['one', 'both'], { title: 'Way', default: 'one' }) },
  render: ({ content }) => h('span', {}, content),
})

/** A leaf that must be labelled: `::term[Word]{ref=…}`. */
export const termBlock = defineBlock({
  id: 'test.term',
  version: '1.0.0',
  name: 'term',
  title: 'Term',
  description: 'A defined word.',
  content: 'none',
  label: 'required',
  props: { ref: p.string({ title: 'Reference', minLength: 2, maxLength: 8 }) },
  render: ({ label }) => h('dl', {}, h('dt', {}, label)),
})

/** A leaf with no label: `::divider`. */
export const dividerBlock = defineBlock({
  id: 'test.divider',
  version: '1.0.0',
  name: 'divider',
  title: 'Divider',
  description: 'A rule between sections.',
  content: 'none',
  props: {},
  render: () => h('div', { role: 'separator' }),
})

export const LOCKSTAY_SHAPED = [
  timelineBlock,
  stepBlock,
  castBlock,
  routeBlock,
  termBlock,
  dividerBlock,
]
