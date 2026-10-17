/**
 * The text in each named field of a form, as it stands now.
 *
 * Forms here are uncontrolled: the browser already holds what was typed, and
 * a `useState` per field to hold it a second time is the same value kept in
 * two places. Files are left out; they are not text, and no schema here takes
 * one.
 */
export function formValues(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [name, value] of new FormData(form)) {
    if (typeof value === 'string') values[name] = value
  }
  return values
}
