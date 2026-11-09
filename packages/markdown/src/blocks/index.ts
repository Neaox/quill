/**
 * Component blocks (ADR-060): the contract, the prop vocabulary, the
 * registry and how a block reaches the page. `docs/extending/component-blocks.md`
 * is the guide; `endpoint.ts` is the reference block.
 */
export type {
  AnyBlock,
  BlockContent,
  BlockDefinition,
  BlockLabel,
  BlockRenderInput,
} from './define.ts'
export { BlockRenderError, blockKind, blockProblems, defineBlock, h } from './define.ts'
export { castBlock } from './cast.ts'
export { checksBlock } from './checks.ts'
export { ENDPOINT_METHODS, endpointBlock } from './endpoint.ts'
export { isPhrasing } from './phrasing.ts'
export { routeBlock } from './route.ts'
export { STEP_TONES, stepBlock, timelineBlock } from './timeline.ts'
export type {
  BooleanProp,
  EnumProp,
  ListProp,
  NumberProp,
  PropIssue,
  PropSchema,
  PropSchemas,
  PropValues,
  ReadProps,
  StringProp,
} from './props.ts'
export { p, readProps } from './props.ts'
export type { BlockRegistry } from './registry.ts'
export {
  BUILT_IN_BLOCK_REGISTRY,
  BUILT_IN_BLOCKS,
  createBlockRegistry,
  isQuillDirective,
} from './registry.ts'
export type { BlockIssue } from './render.ts'
