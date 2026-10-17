/**
 * Tenant labels (ADR-037): a name and a colour, defined in the organisation's
 * theme. `:acme[Acme]` renders as a pill in the label's colour, and the
 * class `acme` colours a drawing's shapes and text the same way.
 *
 * The name is both a directive name and a class name, and it reaches CSS
 * unescaped, so its shape is fixed here and checked before a theme is
 * accepted: a lower-case letter, then up to 31 lower-case letters, digits and
 * hyphens.
 */

/** A label's name: the directive it is written as and the class a drawing uses. */
export const LABEL_NAME_PATTERN = '^[a-z][a-z0-9-]{0,31}$'

const LABEL_NAME = new RegExp(LABEL_NAME_PATTERN, 'u')

/**
 * A custom emoji's name (ADR-038): the label's shape with `_`, which GitHub's
 * own shortcodes use (`:globex_logo:`). Here because a label may name the
 * emoji its pill leads with; the emoji themselves are the organisation's
 * settings, not the theme's. Held to `@quill/markdown`'s `EMOJI_NAME` by a
 * test in the server.
 */
export const EMOJI_NAME_PATTERN = '^[a-z][a-z0-9_-]{0,31}$'

/** More labels than this is a palette nobody can tell apart. */
export const MAX_LABELS = 24

/**
 * The chroma a label takes when its seed states only a hue: the status set's,
 * so a label sits beside `:ok[Built]` at the same strength.
 */
export const DEFAULT_LABEL_CHROMA = 0.14

/**
 * The directive names `@quill/markdown` defines itself (`badge`, the badge
 * shorthands, the callout types, …). A label must not shadow one: the
 * built-in would win in the renderer and the label would silently never
 * show. Held to the Markdown package's own list by a test in the server,
 * which is the one package that depends on both.
 */
export const BUILT_IN_DIRECTIVE_NAMES = [
  'accent',
  'accordion',
  'bad',
  'badge',
  'callout',
  'cards',
  'caution',
  'children',
  'code-group',
  'details',
  'figure',
  'full',
  'guidance',
  'important',
  'info',
  'kbd',
  'link',
  'note',
  'notes',
  'ok',
  'optional',
  'placeholder',
  'plan',
  'repeat',
  'small',
  'table',
  'tip',
  'toc',
  'warn',
  'warning',
  'when',
  'wide',
] as const

/**
 * The drawing vocabulary (`packages/design-css/src/prose.css`, "Drawings"):
 * classes a diagram already means something by. A label named `send` would
 * recolour every outgoing arrow in every drawing.
 */
export const DRAWING_CLASS_NAMES = [
  'arrow-check',
  'arrow-planned',
  'arrow-receive',
  'arrow-send',
  'box',
  'check',
  'focus',
  'group',
  'heading',
  'inner',
  'key',
  'label',
  'label-warn',
  'label-zone',
  'large',
  'lifeline',
  'planned',
  'receive',
  'send',
  'step',
  'step-text',
  'strong',
  'sub',
  'title',
  'zone',
] as const

const RESERVED = new Set<string>([...BUILT_IN_DIRECTIVE_NAMES, ...DRAWING_CLASS_NAMES])

/** Whether a name is already taken by a built-in directive or drawing class. */
export const isReservedLabelName = (name: string): boolean => RESERVED.has(name)

/** Whether a name has the shape a label's name must have. */
export const isLabelName = (name: string): boolean => LABEL_NAME.test(name)

/** What is wrong with a label name, in words a settings form can show; undefined when nothing. */
export const labelNameProblem = (
  name: string,
  others: readonly string[] = [],
): string | undefined => {
  if (!isLabelName(name)) {
    return 'Use a lower-case letter, then letters, digits or hyphens (up to 32 characters).'
  }
  if (isReservedLabelName(name)) return `“${name}” is already a built-in name.`
  if (others.includes(name)) return `There is already a label called “${name}”.`
  return undefined
}
