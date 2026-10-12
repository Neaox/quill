import type { Options as ToHastOptions } from 'remark-rehype'

/**
 * The handler map `remark-rehype` takes, and the state it passes each
 * handler: the types every module that renders part of the tree shares, kept
 * apart from `handlers.ts` so a part rendered elsewhere (`table-block.ts`)
 * depends on them and not on the handlers that call it.
 */
export type Handlers = NonNullable<ToHastOptions['handlers']>
type Handler = NonNullable<Handlers['heading']>
export type State = Parameters<Handler>[0]
