import { describe, expect, it } from 'vitest'

import { p, readProps } from './props.ts'

const props = {
  tone: p.enum(['outside', 'net'], { title: 'Tone' }),
  method: p.enum(['GET', 'POST'], { title: 'Method', default: 'GET' }),
  path: p.string({ title: 'Path', pattern: '^/', required: true }),
  name: p.string({ title: 'Name', minLength: 2, maxLength: 4 }),
  narrow: p.boolean({ title: 'Narrow' }),
  open: p.boolean({ title: 'Open', default: true }),
  columns: p.integer({ title: 'Columns', minimum: 1, maximum: 4 }),
  ratio: p.number({ title: 'Ratio', default: 1.5 }),
  outside: p.list({ title: 'Outside' }),
}

describe('p', () => {
  it('declares plain JSON Schema, each with its title', () => {
    expect(props.tone).toEqual({ type: 'string', enum: ['outside', 'net'], title: 'Tone' })
    expect(props.columns).toEqual({ type: 'integer', title: 'Columns', minimum: 1, maximum: 4 })
    expect(props.outside).toEqual({ type: 'array', items: { type: 'string' }, title: 'Outside' })
    expect(JSON.parse(JSON.stringify(props.path))).toEqual(props.path)
  })
})

describe('readProps', () => {
  it('reads attributes as typed values, with defaults for what is not written', () => {
    expect(
      readProps(props, {
        tone: 'net',
        path: '/v1',
        name: 'abc',
        narrow: '',
        columns: '3',
        outside: 'Airbnb, Booking.com,, ',
      }),
    ).toEqual({
      values: {
        tone: 'net',
        method: 'GET',
        path: '/v1',
        name: 'abc',
        narrow: true,
        open: true,
        columns: 3,
        ratio: 1.5,
        outside: ['Airbnb', 'Booking.com'],
      },
      issues: [],
    })
  })

  it('reads a flag written out, and leaves an absent one false', () => {
    expect(readProps(props, { path: '/', narrow: 'true', open: 'false' }).values).toMatchObject({
      narrow: true,
      open: false,
    })
    expect(readProps(props, { path: '/' }).values).toMatchObject({ narrow: false })
    expect(readProps(props, { path: '/', ratio: '0.25' }).values).toMatchObject({ ratio: 0.25 })
  })

  it('reports a value that does not fit, drawing the default or leaving it out', () => {
    const read = readProps(props, {
      tone: 'purple',
      method: 'TRACE',
      path: '/x',
      name: 'a',
      narrow: 'yes',
      columns: '2.5',
      ratio: 'wide',
    })
    expect(read.values).toEqual({
      method: 'GET',
      path: '/x',
      narrow: false,
      open: true,
      ratio: 1.5,
    })
    expect(read.issues).toEqual([
      {
        prop: 'tone',
        message: 'tone: “purple” is not one of outside, net; left out',
        fatal: false,
      },
      {
        prop: 'method',
        message: 'method: “TRACE” is not one of GET, POST; drawn as GET',
        fatal: false,
      },
      { prop: 'name', message: 'name: needs at least 2 characters; left out', fatal: false },
      {
        prop: 'narrow',
        message: 'narrow: “yes” is not true or false; drawn as false',
        fatal: false,
      },
      { prop: 'columns', message: 'columns: “2.5” is not a whole number; left out', fatal: false },
      { prop: 'ratio', message: 'ratio: “wide” is not a number; drawn as 1.5', fatal: false },
    ])
  })

  it('reports numbers out of range, an empty number and a string too long', () => {
    expect(readProps(props, { path: '/', columns: '0' }).issues[0]?.message).toBe(
      'columns: 0 is below 1; left out',
    )
    expect(readProps(props, { path: '/', columns: '9' }).issues[0]?.message).toBe(
      'columns: 9 is above 4; left out',
    )
    expect(readProps(props, { path: '/', columns: ' ' }).issues[0]?.message).toBe(
      'columns: “ ” is not a number; left out',
    )
    expect(readProps(props, { path: '/', name: 'abcde' }).issues[0]?.message).toBe(
      'name: takes at most 4 characters; left out',
    )
  })

  it('says a list default as a list', () => {
    const listed = { outside: p.list({ title: 'Outside', default: ['A', 'B'] }) }
    expect(readProps(listed, {}).values).toEqual({ outside: ['A', 'B'] })
  })

  it('cannot draw a block whose required prop is missing or does not fit', () => {
    expect(readProps(props, {}).issues).toEqual([
      { prop: 'path', message: 'path is required', fatal: true },
    ])
    expect(readProps(props, { path: null }).issues[0]?.fatal).toBe(true)
    expect(readProps(props, { path: 'v1' }).issues).toEqual([
      { prop: 'path', message: 'path: “v1” is not in the form it needs; left out', fatal: true },
    ])
  })

  it('reports an attribute that is not one of its props, and ignores it', () => {
    expect(readProps(props, { path: '/', tonee: 'net' })).toEqual({
      values: expect.not.objectContaining({ tonee: 'net' }),
      issues: [
        {
          prop: 'tonee',
          message:
            'tonee is not a prop of this block; it takes tone, method, path, name, narrow, open, columns, ratio, outside',
          fatal: false,
        },
      ],
    })
    expect(readProps({}, { id: 'x' }).issues[0]?.message).toBe(
      'id is not a prop of this block; it takes none',
    )
  })

  it('reads no attributes at all', () => {
    expect(readProps({}, undefined)).toEqual({ values: {}, issues: [] })
    expect(readProps({}, null)).toEqual({ values: {}, issues: [] })
  })
})
