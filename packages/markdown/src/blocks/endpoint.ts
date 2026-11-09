import { BRAND } from '@quill/brand'

import { defineBlock, h } from './define.ts'
import { p } from './props.ts'

export const ENDPOINT_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const

const AUTHENTICATIONS = ['none', 'session', 'token'] as const

/** How an endpoint's authentication is said: in words, as the reader would ask for it. */
const AUTHENTICATION: Readonly<Record<(typeof AUTHENTICATIONS)[number], string>> = {
  none: 'No authentication',
  session: 'Signed-in session',
  token: 'API token',
}

/**
 * An HTTP endpoint (ADR-060's reference block, and Quill's first built-in
 * one):
 *
 * ```markdown
 * :::endpoint{method=POST path=/v1/documents auth=token}
 * Creates a document from Markdown.
 * :::
 * ```
 *
 * It is drawn as a section named by its method and path, headed by the
 * method as a word (never a colour alone) and the path as code, followed by
 * whatever Markdown the author wrote about it. Outside Quill it reads as the
 * directive line and the Markdown under it.
 */
export const endpointBlock = defineBlock({
  id: `${BRAND.slug}.endpoint`,
  version: '1.0.0',
  name: 'endpoint',
  title: 'API endpoint',
  description: 'An HTTP endpoint: its method, path and authentication, then what it does.',
  content: 'blocks',
  props: {
    method: p.enum(ENDPOINT_METHODS, { title: 'Method', default: 'GET' }),
    path: p.string({
      title: 'Path',
      description:
        'Starts with a slash. Write parameters in braces, and quote a path that has them.',
      pattern: '^/\\S*$',
      required: true,
      examples: ['/v1/documents/{id}'],
    }),
    auth: p.enum(AUTHENTICATIONS, { title: 'Authentication' }),
    deprecated: p.boolean({ title: 'Deprecated' }),
  },
  data: ['data-qb-method'],
  render: ({ props, content }) =>
    h(
      'section',
      { 'aria-label': `${props.method} ${props.path}` },
      h(
        'header',
        { className: ['qb-endpoint-head'] },
        h(
          'span',
          { className: ['qb-endpoint-method'], 'data-qb-method': props.method.toLowerCase() },
          props.method,
        ),
        ' ',
        h('code', { className: ['qb-endpoint-path'] }, props.path),
        props.auth !== undefined &&
          h('span', { className: ['qb-endpoint-auth'] }, AUTHENTICATION[props.auth]),
        props.deprecated &&
          h('span', { className: ['badge'], 'data-tone': 'warning' }, 'Deprecated'),
      ),
      ...content,
    ),
})
