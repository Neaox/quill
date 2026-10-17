/**
 * The layout attributes a themed page carries on `<html>` (ADR-028).
 *
 * Most of a layout is component props — where comments sit, how history is
 * shown. Two axes are not: they are read by the stylesheet from an attribute
 * on an ancestor, so a page must carry them for a theme to look like itself.
 *
 * - `data-rules` — how sections are divided (`rules-*` variants in
 *   `tokens.css`, the `[data-rules]` rules in `prose.css`);
 * - `data-align` — where the reading column sits (`[data-align='start']` in
 *   `layout.css`).
 *
 * Each is resolved from the first source that states it: the organisation's
 * layout default (the owner of layout since ADR-028's amendment), then the
 * theme's own variants (which recommend one, and which is where a newer axis
 * such as `align` is stated before layout settings carry it). The sources are
 * read as plain records on purpose: an axis a newer schema adds flows through
 * here with no change, and a value is passed only when it is a bare lower-case
 * word, because it is about to become an attribute value on every page.
 */

/** The axes the stylesheet reads from `<html>`. Adding one is adding a name here. */
export const PAGE_LAYOUT_AXES = ['rules', 'align'] as const

const VALUE = /^[a-z][a-z-]{0,31}$/u

/** `{ 'data-rules': 'plain', 'data-align': 'start' }`, or fewer when no source states an axis. */
export function pageLayoutAttributes(
  sources: readonly (Readonly<Record<string, unknown>> | undefined)[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    PAGE_LAYOUT_AXES.flatMap((axis) => {
      const value = sources
        .map((source) => source?.[axis])
        .find(
          (candidate): candidate is string =>
            typeof candidate === 'string' && VALUE.test(candidate),
        )
      return value === undefined ? [] : [[`data-${axis}`, value]]
    }),
  )
}
