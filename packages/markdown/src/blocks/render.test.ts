import { describe, expect, it } from 'vitest'

import { createMarkdownRegistry } from '../extensions/registry.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { renderDocument, renderHtml } from '../render/html.ts'
import type { AnyBlock } from './define.ts'
import { BlockRenderError, defineBlock, h } from './define.ts'
import { endpointBlock } from './endpoint.ts'
import { p } from './props.ts'
import { LOCKSTAY_SHAPED } from './test-support.ts'

const registry = createMarkdownRegistry([], [endpointBlock, ...LOCKSTAY_SHAPED])

const rendered = (markdown: string, blocks = registry) =>
  renderDocument(parseMarkdown(markdown), { extensions: blocks })

const html = (markdown: string): string => rendered(markdown).html

const issues = (markdown: string) => rendered(markdown).blockIssues

describe('a registered block', () => {
  it('is drawn by its own render, stamped as its block, with its content', () => {
    expect(
      html(
        ':::endpoint{method=POST path=/v1/documents auth=token deprecated}\nCreates one.\n:::\n',
      ),
    ).toBe(
      [
        '<article><section class="qb qb-endpoint" aria-label="POST /v1/documents">',
        '<header class="qb-endpoint-head"><span class="qb-endpoint-method" data-qb-method="post">POST</span>',
        ' <code class="qb-endpoint-path">/v1/documents</code>',
        '<span class="qb-endpoint-auth">API token</span>',
        '<span class="badge" data-tone="warning">Deprecated</span></header>\n',
        '<p>Creates one.</p>\n</section></article>',
      ].join(''),
    )
  })

  it('reads its props’ defaults, and reports nothing when nothing is wrong', () => {
    const result = rendered(':::endpoint{path=/health}\n:::\n')
    expect(result.html).toContain('data-qb-method="get">GET</span>')
    expect(result.html).not.toContain('qb-endpoint-auth')
    expect(result.blockIssues).toEqual([])
  })

  it('is drawn by Quill’s own blocks when a render is given no registry', () => {
    expect(renderHtml(parseMarkdown(':::endpoint{path=/x}\n:::\n'))).toContain(
      'class="qb qb-endpoint"',
    )
  })

  it('keeps the classes its render gives its root after the stamp', () => {
    expect(html(':::cast{narrow}\n- A\n:::\n')).toContain(
      '<section class="qb qb-cast qb-cast-narrow" aria-label="Cast" data-qb-outside="">',
    )
  })

  it('draws its label as inline Markdown', () => {
    expect(
      html(':::cast[Who **sends**]{outside="Airbnb, Booking.com" columns=2}\n- A\n:::\n'),
    ).toBe(
      [
        '<article><section class="qb qb-cast" aria-label="Who sends"',
        ' data-qb-outside="Airbnb,Booking.com" data-qb-columns="2">',
        '<p class="qb-cast-title">Who <strong>sends</strong></p>\n<ul>\n<li>A</li>\n</ul>\n</section></article>',
      ].join(''),
    )
  })
})

describe('nesting', () => {
  const timeline = [
    '::::timeline',
    ':::step{icon=mail tone=net}',
    'First.',
    ':::',
    '',
    ':::step{icon=lockstay}',
    'Second.',
    ':::',
    '::::',
    '',
  ].join('\n')

  it('draws an outer container, written with more colons, around its items', () => {
    expect(html(timeline)).toBe(
      [
        '<article><ol class="qb qb-timeline">',
        '<li class="qb qb-step"><span class="qb-step-node" data-qb-icon="mail" data-qb-tone="net"></span>\n',
        '<p>First.</p>\n</li>',
        '<li class="qb qb-step"><span class="qb-step-node" data-qb-icon="lockstay"></span>\n',
        '<p>Second.</p>\n</li>',
        '</ol></article>',
      ].join(''),
    )
    expect(issues(timeline)).toEqual([])
  })

  it('draws an item outside the block it belongs in as a frame, and says why', () => {
    const markdown = 'Before.\n\n:::step{icon=mail}\nAlone.\n:::\n'
    expect(html(markdown)).toContain(
      '<div class="block-fallback" role="group" aria-label="step belongs inside timeline: step">',
    )
    expect(html(markdown)).toContain('<p>Alone.</p>')
    expect(issues(markdown)).toEqual([
      { block: 'step', message: 'step belongs inside timeline', line: 3 },
    ])
  })

  it('draws Markdown an items block does not take before it, with a note', () => {
    const markdown = '::::timeline\nA stray line.\n\n:::step\nOne.\n:::\n::::\n'
    expect(html(markdown)).toBe(
      [
        '<article><p class="block-issues"><span class="block-issues-label">Check this block</span>',
        ' timeline holds only step blocks; the rest is shown first.</p>\n',
        '<p>A stray line.</p>\n<ol class="qb qb-timeline"><li class="qb qb-step"><span class="qb-step-node"></span>\n',
        '<p>One.</p>\n</li></ol></article>',
      ].join(''),
    )
  })
})

describe('a prop that does not fit', () => {
  it('is drawn as its default, and the block says so above its content', () => {
    const markdown = ':::endpoint{method=TRACE path=/x colour=red}\nText.\n:::\n'
    expect(html(markdown)).toContain(
      [
        '<section class="qb qb-endpoint" aria-label="GET /x"><p class="block-issues">',
        '<span class="block-issues-label">Check this block</span>',
        ' method: “TRACE” is not one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS; drawn as GET.',
        ' colour is not a prop of this block; it takes method, path, auth, deprecated.</p>',
      ].join(''),
    )
    expect(issues(markdown)).toEqual([
      {
        block: 'endpoint',
        message:
          'method: “TRACE” is not one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS; drawn as GET',
        line: 1,
      },
      {
        block: 'endpoint',
        message: 'colour is not a prop of this block; it takes method, path, auth, deprecated',
        line: 1,
      },
    ])
  })

  it('puts the note before a block whose root is a list', () => {
    expect(html('::term[Word]{ref=x}\n')).toBe(
      [
        '<article><p class="block-issues"><span class="block-issues-label">Check this block</span>',
        ' ref: needs at least 2 characters; left out.</p>\n',
        '<dl class="qb qb-term"><dt>Word</dt></dl></article>',
      ].join(''),
    )
  })

  it('in an inline block is said after it, in the line', () => {
    expect(html('Goes :route[A → B]{way=sideways} now.\n')).toBe(
      [
        '<article><p>Goes <span class="qb qb-route">A → B</span>',
        '<span class="block-issues"> (way: “sideways” is not one of one, both; drawn as one.)</span>',
        ' now.</p></article>',
      ].join(''),
    )
  })

  it('says so when a leaf is given a label it does not take', () => {
    expect(html('::divider[Words]\n')).toBe(
      [
        '<article><div class="qb qb-divider"><p class="block-issues">',
        '<span class="block-issues-label">Check this block</span>',
        ' divider takes no [label]; it is not shown.</p></div></article>',
      ].join(''),
    )
  })

  it('includes a label the block does not take', () => {
    expect(html(':::endpoint[Label]{path=/x}\n:::\n')).toContain(
      'endpoint takes no [label]; it is not shown.',
    )
  })
})

describe('a block that cannot be drawn', () => {
  it('is a frame with its reason and its content, when a required prop is missing', () => {
    const markdown = '# Title\n\n:::endpoint{method=GET}\nWhat it does.\n:::\n'
    expect(html(markdown)).toContain(
      [
        '<div class="block-fallback" role="group" aria-label="path is required: endpoint">\n',
        '<p class="block-fallback-head"><code>endpoint{method="GET"}</code>',
        ' <span class="block-fallback-reason">path is required</span></p>\n',
        '<p>What it does.</p>\n</div>',
      ].join(''),
    )
    expect(issues(markdown)).toEqual([{ block: 'endpoint', message: 'path is required', line: 3 }])
  })

  it('is a frame holding its source when a leaf needs a label', () => {
    expect(html('::term{ref=abc}\n')).toBe(
      [
        '<article><div class="block-fallback" role="group" aria-label="term needs a [label]: term">\n',
        '<p class="block-fallback-head"><code>term{ref="abc"}</code>',
        ' <span class="block-fallback-reason">term needs a [label]</span></p>\n',
        '<p>::term{ref="abc"}</p>\n</div></article>',
      ].join(''),
    )
  })

  it('is written in the wrong form: drawn as written, and said', () => {
    expect(html('::endpoint{path=/x}\n')).toContain(
      '<span class="block-fallback-reason">endpoint is written :::endpoint</span>',
    )
    expect(html(':::route\nx\n:::\n')).toContain('route is written :route[…]')
    expect(html('See :endpoint[x].\n')).toBe(
      '<article><p>See :endpoint[x]<span class="block-issues"> (endpoint is written :::endpoint.)</span>.</p></article>',
    )
    expect(issues('::term[x]{ref=abc}\n\n:::term\n:::\n')).toEqual([
      { block: 'term', message: 'term is written ::term', line: 3 },
    ])
  })

  it('is a frame when its render throws', () => {
    const broken = defineBlock({
      id: 'acme.broken',
      version: '1.0.0',
      name: 'broken',
      title: 'Broken',
      description: 'Throws.',
      content: 'blocks',
      props: {},
      render: () => {
        throw new Error('no')
      },
    })
    const result = rendered(':::broken\nKept.\n:::\n', createMarkdownRegistry([], [broken]))
    expect(result.html).toContain('aria-label="broken could not be drawn: broken"')
    expect(result.html).toContain('<p>Kept.</p>')
    expect(result.blockIssues).toEqual([
      { block: 'broken', message: 'broken could not be drawn', line: 1 },
    ])
  })

  it('is a frame with the render’s own reason when it throws a BlockRenderError', () => {
    const picky = defineBlock({
      id: 'acme.picky',
      version: '1.0.0',
      name: 'picky',
      title: 'Picky',
      description: 'Holds a list.',
      content: 'blocks',
      props: {},
      render: () => {
        throw new BlockRenderError('picky holds a list')
      },
    })
    const result = rendered(':::picky\nKept.\n:::\n', createMarkdownRegistry([], [picky]))
    expect(result.html).toContain('aria-label="picky holds a list: picky"')
    expect(result.blockIssues).toEqual([{ block: 'picky', message: 'picky holds a list', line: 1 }])
  })
})

describe('what a render is given beside its props', () => {
  /** A block that reads its Markdown itself: the first paragraph's words, then the rest. */
  const reader = defineBlock({
    id: 'acme.reader',
    version: '1.0.0',
    name: 'reader',
    title: 'Reader',
    description: 'Reads its own Markdown.',
    content: 'blocks',
    props: { icon: p.string({ title: 'Icon' }) },
    render: ({ props, children, draw, emoji }) => {
      const [first, ...rest] = children
      return h(
        'section',
        {},
        props.icon === undefined ? undefined : emoji(props.icon, 'decoration'),
        h('p', { className: ['qb-reader-kinds'] }, children.map((child) => child.type).join(' ')),
        first?.type === 'paragraph'
          ? [h('p', { className: ['qb-reader-lead'] }, draw(first.children)), draw(rest)]
          : draw(children),
      )
    },
  })
  const readerRegistry = createMarkdownRegistry([], [reader])
  const emoji = new Map([
    ['clock', { src: '/api/emoji/clock.0123456789abcdef.svg', width: 16, height: 16 }],
  ])

  it('is the Markdown its content is drawn from, already read for emoji, and a way to draw it', () => {
    expect(
      renderDocument(
        parseMarkdown(':::reader{icon=clock}\nA :clock: lead.\n\n## Then\n\nMore.\n:::\n'),
        {
          extensions: readerRegistry,
          emoji,
        },
      ).html,
    ).toBe(
      [
        '<article><section class="qb qb-reader">',
        '<img class="emoji" src="/api/emoji/clock.0123456789abcdef.svg" alt="" width="20" height="20">',
        '<p class="qb-reader-kinds">paragraph heading paragraph</p>',
        '<p class="qb-reader-lead">A <img class="emoji" src="/api/emoji/clock.0123456789abcdef.svg" alt="clock" title=":clock:" width="20" height="20"> lead.</p>\n',
        '<h2 id="user-content-then" aria-labelledby="user-content-title.then"><span id="user-content-title.then">Then</span>',
        '<a class="heading-anchor" href="#user-content-then" aria-label="Link to this section: Then"><span aria-hidden="true">#</span></a></h2>\n',
        '<p>More.</p>\n',
        '</section></article>',
      ].join(''),
    )
  })

  it('draws the content only when the render reads it, so a heading takes its anchor once', () => {
    const result = renderDocument(parseMarkdown(':::reader\n## Once\n:::\n\n## Once\n'), {
      extensions: readerRegistry,
    })
    expect(result.outline.map((entry) => entry.id)).toEqual([
      'user-content-once',
      'user-content-once-1',
    ])
    expect(result.html).toContain('id="user-content-once"')
    expect(result.html).toContain('id="user-content-once-1"')
    expect(result.html).not.toContain('once-2')
  })

  it('has no emoji for a name nothing answers to', () => {
    expect(
      renderDocument(parseMarkdown(':::reader{icon=nothing}\nx\n:::\n'), {
        extensions: readerRegistry,
      }).html,
    ).toContain('<section class="qb qb-reader"><p class="qb-reader-kinds">paragraph</p>')
  })

  it('is an inline block’s phrasing', () => {
    const inline = defineBlock({
      id: 'acme.kinds',
      version: '1.0.0',
      name: 'kinds',
      title: 'Kinds',
      description: 'Names what it holds.',
      content: 'inline',
      props: {},
      render: ({ children, draw }) =>
        h('span', {}, children.map((child) => child.type).join(' '), ': ', draw(children)),
    })
    expect(
      renderHtml(parseMarkdown(':kinds[a **b**]\n'), {
        extensions: createMarkdownRegistry([], [inline]),
      }),
    ).toBe(
      '<article><p><span class="qb qb-kinds">text strong: a <strong>b</strong></span></p></article>',
    )
  })
})

describe('an unknown block', () => {
  it('is reported, whatever its form, and shown as written', () => {
    const markdown = ':::widget\nInside.\n:::\n\n::gadget{a=1}\n\nA :thing[label] here.\n'
    const result = rendered(markdown)
    expect(result.html).toContain('aria-label="Unknown block: widget"')
    expect(result.html).toContain('<p>Inside.</p>')
    expect(result.html).toContain('::gadget{a="1"}')
    expect(result.html).toContain('A :thing[label] here.')
    expect(result.blockIssues).toEqual([
      {
        block: 'widget',
        message: 'no block is called widget',
        line: 1,
      },
      { block: 'gadget', message: 'no block is called gadget', line: 5 },
      { block: 'thing', message: 'no block is called thing', line: 7 },
    ])
  })

  it('is not a word that holds a colon', () => {
    expect(issues('Ratio 3:2, at 10:30, status:ok, a:route.\n')).toEqual([])
  })

  it('leaves Quill’s own directives as they were', () => {
    expect(issues(':::when{audience=staff}\nText.\n:::\n\n::toc\n\n:kbd[K] :ok\n')).toEqual([])
    expect(html(':::when{audience=staff}\nText.\n:::\n')).toBe('<article><p>Text.</p></article>')
  })

  it('has no line when the tree no longer knows it', () => {
    const tree = parseMarkdown(':::widget\n:::\n')
    const [widget] = tree.children
    if (widget !== undefined) delete widget.position
    expect(renderDocument(tree).blockIssues).toEqual([
      { block: 'widget', message: 'no block is called widget' },
    ])
  })
})

const hostile = (render: AnyBlock['render']): AnyBlock =>
  defineBlock({
    id: 'acme.hostile',
    version: '1.0.0',
    name: 'hostile',
    title: 'Hostile',
    description: 'Tries everything.',
    content: 'inline',
    props: { note: p.string({ title: 'Note' }) },
    data: ['data-qb-ok'],
    render,
  })

const drawnWith = (block: AnyBlock, markdown: string): string =>
  renderHtml(parseMarkdown(markdown), { extensions: createMarkdownRegistry([], [block]) })

describe('sanitising', () => {
  it('admits qb classes, a name, declared data attributes and what the element already admits', () => {
    const block = hostile(() =>
      h(
        'span',
        {
          className: ['qb-hostile-ok', 'callout', 'evil'],
          'aria-label': 'Named',
          'data-qb-ok': 'yes',
          'data-qb-other': 'no',
          'data-tone': 'danger',
          style: 'color:red',
          onClick: 'alert(1)',
          id: 'main',
        },
        'x',
      ),
    )
    expect(drawnWith(block, ':hostile[x]')).toBe(
      '<article><p><span class="qb qb-hostile qb-hostile-ok" aria-label="Named" data-qb-ok="yes" data-tone="danger" id="user-content-main">x</span></p></article>',
    )
  })

  it('removes elements outside the allowlist, raw markup and unsafe links', () => {
    const block = hostile(() =>
      h(
        'span',
        {},
        h('script', {}, 'alert(1)'),
        h('iframe', { src: 'https://example.com' }),
        { type: 'raw', value: '<img src=x onerror=alert(1)>' },
        h('a', { href: 'javascript:alert(1)' }, 'link'),
        h('style', {}, 'body{}'),
      ),
    )
    const drawn = drawnWith(block, ':hostile[x]')
    // The raw node is text, the link has no address, and the rest is gone.
    expect(drawn).toBe(
      '<article><p><span class="qb qb-hostile">&#x3C;img src=x onerror=alert(1)><a>link</a>body{}</span></p></article>',
    )
  })

  it('draws a prop that holds markup as text, in an attribute or in content', () => {
    const block = hostile(({ props }) => {
      const note = String(props['note'])
      return h('span', { 'aria-label': note }, note)
    })
    expect(drawnWith(block, ':hostile[x]{note="<b onmouseover=alert(1)>hi</b>"}')).toBe(
      [
        '<article><p><span class="qb qb-hostile" aria-label="<b onmouseover=alert(1)>hi</b>">',
        '&#x3C;b onmouseover=alert(1)>hi&#x3C;/b></span></p></article>',
      ].join(''),
    )
  })

  it('gives an author no way to write a qb element: raw HTML is still text', () => {
    expect(renderHtml(parseMarkdown('<p class="qb-x">raw</p>'))).toBe(
      '<article>&#x3C;p class="qb-x">raw&#x3C;/p></article>',
    )
  })
})
