/**
 * A CSS string: quoted, with every character that could end the string, the
 * line or an escape written as a hex escape.
 *
 * Two values in a generated stylesheet were chosen by nobody in this
 * codebase — an uploaded face's family name and its address — and either
 * could otherwise close the declaration it sits in and open a rule of its own
 * on every page the theme styles, the public site included.
 */
export const cssString = (value: string): string =>
  `'${value.replaceAll(/['"\\\n\r\f\0]/gu, (character) => `\\${character.charCodeAt(0).toString(16)} `)}'`

/**
 * A family name as a font stack writes it: bare when it is a single CSS
 * identifier (which is also how a generic family such as `system-ui` or
 * `-apple-system` has to be written, because quoting one makes it a family
 * called that), and a CSS string otherwise.
 */
export const fontFamilyName = (family: string): string =>
  /^-?[A-Za-z_][A-Za-z0-9_-]*$/u.test(family) ? family : cssString(family)
